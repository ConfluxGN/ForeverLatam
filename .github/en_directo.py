"""Escribe live.json (quién está en directo) en este repo. Lo ejecuta .github/workflows/en-directo.yml.

Una sola ejecución dura casi 6 horas y mira Twitch cada 2 minutos: GitHub no lanza a su hora
los programados cada 5 minutos (llegaban cada ~5 horas), así que el bucle va dentro.
Usa la API oficial de Twitch con la aplicación de ConfluxGN (secreto TWITCH_CLIENT_SECRET).
"""
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
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
# frases del evento: quien lleva una en el título de su canal sale con el borde violeta animado en el mapa.
# Se eligen en el panel de admin (evento.json); da igual mayúsculas, acentos, la almohadilla o los espacios.
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


def solo_letras(texto):
    """Igual que evKey en site.js: sin acentos, en minúsculas y solo letras y números."""
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", texto or "").lower())


def frases_evento():
    """Frases de evento.json ya reducidas a letras y números; si falta o está mal, ninguna (nadie sale marcado)."""
    try:
        datos = json.loads((RAIZ / "evento.json").read_text(encoding="utf-8"))
        frases = datos.get("frases") if isinstance(datos, dict) else None
        if not isinstance(frases, list):
            return set()
        claves = {solo_letras(str(f)) for f in frases}
    except (OSError, ValueError, TypeError) as e:
        print("evento.json no se pudo leer:", e, flush=True)
        return set()
    return {c for c in claves if len(c) >= 3}


def es_evento(titulo, frases):
    t = solo_letras(titulo)
    return any(f in t for f in frases)


IDS = {}  # login -> id de Twitch (no cambia: se pide una vez por ejecución)


def quien_esta(token):
    """Devuelve (en_directo, evento): logins en directo y logins con la palabra del evento en el título del canal."""
    registros = json.loads((RAIZ / "streamers.json").read_text(encoding="utf-8"))
    logins = sorted({r["twitch"].lower() for r in registros
                     if r.get("twitch") and not r.get("deleted") and r.get("platform") != "kick"})
    cab = {"Client-Id": CLIENT_ID, "Authorization": "Bearer " + token}
    en_directo = []
    for i in range(0, len(logins), 100):
        q = "&".join("user_login=" + urllib.parse.quote(l) for l in logins[i:i + 100])
        for s in pedir("https://api.twitch.tv/helix/streams?first=100&" + q, cabeceras=cab).get("data", []):
            if s.get("type") == "live":
                en_directo.append(s["user_login"].lower())
    # el evento va aparte: si su parte de la API falla, el estado «en directo» se publica igual
    try:
        evento = buscar_evento(logins, cab)
    except Exception as e:  # noqa: BLE001
        print("Evento no disponible:", e, flush=True)
        evento = []
    return sorted(set(en_directo)), sorted(set(evento))


def buscar_evento(logins, cab):
    """Logins con una frase del evento en el título de su canal."""
    # el título del canal existe aunque no esté en directo (sirve para coordinadores que no emiten)
    faltan = [l for l in logins if l not in IDS]
    for i in range(0, len(faltan), 100):
        q = "&".join("login=" + urllib.parse.quote(l) for l in faltan[i:i + 100])
        for u in pedir("https://api.twitch.tv/helix/users?" + q, cabeceras=cab).get("data", []):
            IDS[u["login"].lower()] = u["id"]
    ids = [IDS[l] for l in logins if l in IDS]
    frases = frases_evento()
    evento = []
    for i in range(0, len(ids), 100):
        q = "&".join("broadcaster_id=" + i_d for i_d in ids[i:i + 100])
        for c in pedir("https://api.twitch.tv/helix/channels?" + q, cabeceras=cab).get("data", []):
            if frases and es_evento(c.get("title"), frases):
                evento.append(c["broadcaster_login"].lower())
    return evento


def subir(estado):
    en_directo, evento = estado
    destino = RAIZ / "live.json"
    antes = json.loads(destino.read_text(encoding="utf-8")) if destino.exists() else {}
    ahora = datetime.now(timezone.utc)
    try:
        edad = (ahora - datetime.fromisoformat(antes["t"])).total_seconds()
    except (KeyError, ValueError, TypeError):
        edad = 1e9
    if antes.get("live") == en_directo and antes.get("evento", []) == evento and edad < REFRESCO:
        print("Sin cambios:", en_directo, "evento:", evento, flush=True)
        return
    destino.write_text(json.dumps({"t": ahora.isoformat(timespec="seconds"), "live": en_directo, "evento": evento}), encoding="utf-8")
    git("add", "live.json")
    git("-c", "user.name=ConfluxGN", "-c", "user.email=noreply@github.com", "commit", "-q", "-m", "En directo: actualización automática")
    for intento in range(3):
        try:
            git("push", "-q", "origin", "HEAD:main")
            print("Publicado:", en_directo, "evento:", evento, flush=True)
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
