"""Escribe live.json (quién está en directo) en este repo. Lo ejecuta .github/workflows/en-directo.yml.

Una sola ejecución dura casi 6 horas y mira Twitch cada 2 minutos: GitHub no lanza a su hora
los programados cada 5 minutos (llegaban cada ~5 horas), así que el bucle va dentro.
Usa la API oficial de Twitch con la aplicación de ConfluxGN (secreto TWITCH_CLIENT_SECRET).
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CLIENT_ID = os.environ["TWITCH_CLIENT_ID"].strip()
CLIENT_SECRET = os.environ["TWITCH_CLIENT_SECRET"].strip()
CADA = 120                 # segundos entre consultas
DURACION = 5 * 3600 + 45 * 60  # la siguiente ejecución ya espera en cola
REFRESCO = 15 * 60         # se sube aunque no cambie si el archivo tiene más de 15 min (la web lo da por caducado a los 20)


def pedir(url, datos=None, cabeceras=None):
    req = urllib.request.Request(url, data=datos, headers=cabeceras or {})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def git(*args):
    r = subprocess.run(["git", *args], cwd=RAIZ, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout.strip()


def pedir_token():
    datos = urllib.parse.urlencode({"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "grant_type": "client_credentials"})
    return pedir("https://id.twitch.tv/oauth2/token", datos.encode())["access_token"]


def quien_esta(token):
    registros = json.loads((RAIZ / "streamers.json").read_text(encoding="utf-8"))
    logins = sorted({r["twitch"].lower() for r in registros if r.get("twitch") and not r.get("deleted")})
    cab = {"Client-Id": CLIENT_ID, "Authorization": "Bearer " + token}
    en_directo = []
    for i in range(0, len(logins), 100):
        q = "&".join("user_login=" + urllib.parse.quote(l) for l in logins[i:i + 100])
        for s in pedir("https://api.twitch.tv/helix/streams?first=100&" + q, cabeceras=cab).get("data", []):
            if s.get("type") == "live":
                en_directo.append(s["user_login"].lower())
    return sorted(en_directo)


def subir(en_directo):
    destino = RAIZ / "live.json"
    antes = json.loads(destino.read_text(encoding="utf-8")) if destino.exists() else {}
    ahora = datetime.now(timezone.utc)
    try:
        edad = (ahora - datetime.fromisoformat(antes["t"])).total_seconds()
    except (KeyError, ValueError, TypeError):
        edad = 1e9
    if antes.get("live") == en_directo and edad < REFRESCO:
        print("Sin cambios:", en_directo, flush=True)
        return
    destino.write_text(json.dumps({"t": ahora.isoformat(timespec="seconds"), "live": en_directo}), encoding="utf-8")
    git("add", "live.json")
    git("-c", "user.name=ConfluxGN", "-c", "user.email=noreply@github.com", "commit", "-q", "-m", "En directo: actualización automática")
    for intento in range(3):
        try:
            git("push", "-q", "origin", "HEAD:main")
            print("Publicado:", en_directo, flush=True)
            return
        except RuntimeError:
            if intento == 2:
                raise
            git("pull", "-q", "--rebase", "origin", "main")


def main():
    fin = time.monotonic() + DURACION
    token, fallos = None, 0
    while True:
        inicio = time.monotonic()
        try:
            git("pull", "-q", "--rebase", "origin", "main")  # streamers.json nuevos y lo que haya subido la web
            if token is None:
                token = pedir_token()
            subir(quien_esta(token))
            fallos = 0
        except urllib.error.HTTPError as e:
            fallos += 1
            if e.code == 401:
                token = None  # el token caduca: se pide otro
            print(f"ERROR {e.code} en Twitch: {e.read().decode('utf-8', 'replace')[:300]}", flush=True)
        except Exception as e:  # una consulta fallida no para el bucle; muchas seguidas sí
            fallos += 1
            print("ERROR:", e, flush=True)
        if fallos >= 5:
            sys.exit("ERROR: 5 fallos seguidos, se para.")
        if time.monotonic() + CADA > fin:
            return
        time.sleep(max(0, CADA - (time.monotonic() - inicio)))


if __name__ == "__main__":
    main()
