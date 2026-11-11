/* Bracket del torneo de duelos 1 vs 1 (torneo.json).
   Cada tramo de nivel es una eliminación directa; los campeones de cada tramo juegan la Gran final por los 3 puestos.
   Cada jugador puede llevar su clase de WoW (icono oficial en icons/clases/ y nombre en el color de la clase).
   site.js llama a window.flTorneo({...}) con sus utilidades (GitHub, avisos, modo admin). Solo textContent: nada de HTML. */
(() => {
  'use strict';
  const BYE = { bye: true };            // hueco vacío: el rival pasa directo
  const MAX_JUG = 64, MAX_NOMBRE = 24, MAX_TRAMOS = 8;
  const FILE = 'torneo.json';
  // clases de WoW: id (archivo del icono y color) -> nombre visible y formas que se aceptan al escribirla
  const CLASES = {
    warrior: { es: 'Guerrero', alias: ['guerrero', 'guerrera', 'warrior', 'war'] },
    paladin: { es: 'Paladín', alias: ['paladin', 'pala'] },
    hunter: { es: 'Cazador', alias: ['cazador', 'cazadora', 'hunter', 'hunt'] },
    rogue: { es: 'Pícaro', alias: ['picaro', 'picara', 'rogue'] },
    priest: { es: 'Sacerdote', alias: ['sacerdote', 'sacerdotisa', 'priest', 'sacer'] },
    shaman: { es: 'Chamán', alias: ['chaman', 'shaman', 'shamy'] },
    mage: { es: 'Mago', alias: ['mago', 'maga', 'mage'] },
    warlock: { es: 'Brujo', alias: ['brujo', 'bruja', 'warlock', 'lock'] },
    druid: { es: 'Druida', alias: ['druida', 'druid', 'dudu'] },
  };
  const VACIO = () => ({
    visible: false, // oculto para los visitantes hasta que el admin lo active
    titulo: 'El llamado de los Condenados', subtitulo: 'Torneo PvP 1 vs 1 · Solo No Muertos',
    premios: ['25 USD', '15 USD', '10 USD'],
    tramos: [{ nombre: 'Nivel 10-19', jugadores: [], clases: {}, ganadores: {} }, { nombre: 'Nivel 20-29', jugadores: [], clases: {}, ganadores: {} }, { nombre: 'Nivel 30-39', jugadores: [], clases: {}, ganadores: {} }],
    final: { ganadores: {} },
  });

  // ---------- motor (funciones puras) ----------
  // orden de cabezas de serie: 1 contra el último, y los mejores se cruzan lo más tarde posible
  const seedOrder = (size) => { let o = [1]; while (o.length < size) { const n = o.length * 2; o = o.flatMap((s) => [s, n + 1 - s]); } return o; };
  const real = (x) => typeof x === 'string';
  // entradas: nombres (o null si aún no se sabe). ganadores: { clave: nombre }. Devuelve rondas, campeón y puestos.
  const bracket = (entradas, ganadores = {}, conTercero = false) => {
    const n = entradas.length;
    if (n === 0) return { rondas: [], campeon: null, segundo: null, tercero: null, p3: null };
    if (n === 1) return { rondas: [], campeon: entradas[0], segundo: null, tercero: null, p3: null };
    let size = 2; while (size < n) size *= 2;
    const seeds = seedOrder(size);
    let cur = seeds.map((s) => (s <= n ? entradas[s - 1] : BYE));
    const rondas = [];
    for (let r = 0; cur.length > 1; r++) {
      const ms = [], next = [];
      for (let i = 0; i < cur.length; i += 2) {
        const a = cur[i], b = cur[i + 1], key = `r${r}m${i / 2}`;
        let w = null;
        if (a === BYE && b === BYE) w = BYE;
        else if (b === BYE) w = a;
        else if (a === BYE) w = b;
        else if (real(a) && real(b) && (ganadores[key] === a || ganadores[key] === b)) w = ganadores[key];
        ms.push({ key, a, b, w, sa: r === 0 ? seeds[i] : 0, sb: r === 0 ? seeds[i + 1] : 0, bye: a === BYE || b === BYE });
        next.push(w);
      }
      rondas.push(ms); cur = next;
    }
    const fin = rondas[rondas.length - 1][0];
    const campeon = real(fin.w) ? fin.w : null;
    const segundo = campeon ? (fin.w === fin.a ? fin.b : fin.a) : null;
    let tercero = null, p3 = null;
    if (conTercero && rondas.length >= 2) {
      const perdedor = (m) => (m.bye ? BYE : real(m.w) ? (m.w === m.a ? m.b : m.a) : null);
      const [l0, l1] = rondas[rondas.length - 2].map(perdedor);
      if (l0 === BYE || l1 === BYE) tercero = l0 === BYE ? (real(l1) ? l1 : null) : (real(l0) ? l0 : null);
      else {
        const w = real(l0) && real(l1) && (ganadores.p3 === l0 || ganadores.p3 === l1) ? ganadores.p3 : null;
        p3 = { key: 'p3', a: l0, b: l1, w, sa: 0, sb: 0, bye: false };
        tercero = w;
      }
    }
    return { rondas, campeon, segundo: real(segundo) ? segundo : null, tercero, p3 };
  };
  const nombreRonda = (r, total) => (['Final', 'Semifinal', 'Cuartos de final', 'Octavos de final'][total - 1 - r] || `Ronda ${r + 1}`);
  const limpiarNombre = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOMBRE);
  const clave = (t) => String(t || '').normalize('NFKD').toLowerCase().replace(/[^a-z]/g, '');
  const claseDe = (t) => { const k = clave(t); if (!k) return null; for (const [id, c] of Object.entries(CLASES)) if (id === k || c.alias.includes(k)) return id; return null; };
  // una línea: «Nombre, Clase», «Nombre - Clase» o «Nombre (Clase)»; si la clase no se reconoce, toda la línea es el nombre
  const leerLinea = (linea) => {
    const m = String(linea || '').match(/^(.*?)\s*(?:,|;|\s[-–]\s|\()\s*([^,;()]+?)\)?\s*$/);
    if (m) { const c = claseDe(m[2]); const n = limpiarNombre(m[1]); if (c && n) return { nombre: n, clase: c }; }
    return { nombre: limpiarNombre(linea), clase: null };
  };
  const leerJugadores = (texto) => {
    const vistos = new Set(), jugadores = [], clases = {};
    for (const linea of String(texto || '').split('\n')) {
      const { nombre, clase } = leerLinea(linea); const k = nombre.toLowerCase();
      if (nombre && !vistos.has(k) && jugadores.length < MAX_JUG) { vistos.add(k); jugadores.push(nombre); if (clase) clases[nombre] = clase; }
    }
    return { jugadores, clases };
  };
  const leerLista = (texto) => leerJugadores(texto).jugadores;
  const normalizar = (d) => {
    const base = VACIO();
    if (!d || typeof d !== 'object') return base;
    const tramos = Array.isArray(d.tramos) ? d.tramos.slice(0, MAX_TRAMOS).map((t) => {
      const jugadores = leerLista((Array.isArray(t && t.jugadores) ? t.jugadores : []).join('\n'));
      const origen = t && t.clases && typeof t.clases === 'object' ? t.clases : {};
      const clases = {};
      for (const n of jugadores) if (Object.prototype.hasOwnProperty.call(CLASES, origen[n])) clases[n] = origen[n];
      return {
        nombre: limpiarNombre(t && t.nombre) || 'Tramo', jugadores, clases,
        ganadores: t && t.ganadores && typeof t.ganadores === 'object' ? { ...t.ganadores } : {},
      };
    }) : base.tramos;
    return {
      visible: d.visible === true,
      titulo: limpiarNombre(d.titulo) ? String(d.titulo).trim().slice(0, 80) : base.titulo,
      subtitulo: typeof d.subtitulo === 'string' ? d.subtitulo.trim().slice(0, 120) : base.subtitulo,
      premios: Array.isArray(d.premios) ? d.premios.slice(0, 3).map((p) => String(p).slice(0, 20)) : base.premios,
      tramos,
      final: { ganadores: d.final && d.final.ganadores && typeof d.final.ganadores === 'object' ? { ...d.final.ganadores } : {} },
    };
  };
  const calcular = (T) => {
    const tramos = T.tramos.map((t) => bracket(t.jugadores, t.ganadores));
    const final = bracket(tramos.map((b) => b.campeon), T.final.ganadores, true);
    return { tramos, final };
  };
  window.flTorneoMotor = { bracket, seedOrder, leerLista, leerJugadores, leerLinea, normalizar, calcular }; // para pruebas

  // ---------- interfaz ----------
  window.flTorneo = (api) => {
    const { el, gh, b64enc, b64dec, branch, toast, fail, canEdit } = api;
    const $ = (id) => document.getElementById(id);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = (d, cls) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 12 12'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls); const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); return s; };
    const btn = (cls, text, fn) => { const b = el('button', cls, text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; };

    const ov = $('bk'), panel = $('bk-panel'), abrir = $('bk-open'), interruptor = $('btn-bracket');
    if (!ov || !panel || !abrir) return null;
    let T = VACIO(), sha = null, tab = 0, ocupado = false, ultimoFoco = null, visibleWeb = false;
    // el botón flotante solo lo ven los visitantes si el bracket está visible; el admin lo ve siempre para editarlo
    const sync = () => {
      abrir.hidden = !(visibleWeb || canEdit());
      if (interruptor) {
        interruptor.textContent = visibleWeb ? 'Bracket: visible' : 'Bracket: oculto';
        interruptor.title = visibleWeb ? 'Los visitantes ven el bracket. Tocá para ocultarlo.' : 'Los visitantes no ven el bracket. Tocá para mostrarlo.';
        interruptor.setAttribute('aria-pressed', String(visibleWeb));
      }
    };
    // clase de un jugador en cualquier tramo (la Gran final usa los campeones de los tramos)
    const claseJugador = (nombre) => { for (const t of T.tramos) if (t.clases[nombre]) return t.clases[nombre]; return null; };

    const cargar = async () => {
      if (canEdit()) {
        try { const j = await gh(`/contents/${FILE}?ref=${branch}`); sha = j.sha; T = normalizar(JSON.parse(b64dec(j.content))); }
        catch (e) { if (e.status === 404) { sha = null; T = VACIO(); } else throw e; }
      } else {
        const r = await fetch(`${FILE}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('torneo ' + r.status);
        T = normalizar(await r.json());
      }
      visibleWeb = T.visible; sync();
    };
    const guardar = async (next, mensaje) => {
      if (ocupado) return false;
      ocupado = true;
      try {
        const body = { message: mensaje, content: b64enc(JSON.stringify(next, null, 2) + '\n'), branch };
        if (sha) body.sha = sha;
        const j = await gh(`/contents/${FILE}`, { method: 'PUT', body: JSON.stringify(body) });
        sha = j.content.sha; T = next; visibleWeb = T.visible; sync(); return true;
      } catch (e) {
        if (e.status === 409 || e.status === 422) { try { await cargar(); } catch { /* sin recarga: queda lo anterior */ } }
        fail(e); return false;
      } finally { ocupado = false; pintar(); }
    };

    // icono de la clase (o hueco vacío si no se sabe)
    const icono = (c) => {
      if (!c) { const v = el('span', 'bk-ic is-none'); v.setAttribute('aria-hidden', 'true'); return v; }
      const img = el('img', 'bk-ic'); img.src = `icons/clases/${c}.webp`; img.width = 22; img.height = 22; img.alt = CLASES[c].es; img.title = CLASES[c].es; img.loading = 'lazy'; img.decoding = 'async';
      return img;
    };
    // un duelo: dos filas; en admin se toca al ganador (otra vez para deshacer)
    const duelo = (m, etiqueta, guardarGanador) => {
      const box = el('div', 'bk-m' + (m.bye ? ' is-bye' : ''));
      const fila = (x, seed) => {
        const vacio = !real(x);
        const txt = x === BYE ? 'Pasa directo' : vacio ? (etiqueta(seed) || 'Por definir') : x;
        const r = el(canEdit() && !m.bye && real(m.a) && real(m.b) ? 'button' : 'div', 'bk-p', null);
        if (r.tagName === 'BUTTON') {
          r.type = 'button';
          r.title = m.w === x ? 'Tocá para deshacer' : 'Tocá si ganó este duelo';
          r.addEventListener('click', () => guardarGanador(m.key, m.w === x ? null : x));
        }
        const gana = real(x) && m.w === x, pierde = real(x) && real(m.w) && m.w !== x;
        r.classList.toggle('is-win', gana);
        r.classList.toggle('is-lose', pierde);
        r.classList.toggle('is-tbd', vacio);
        const c = real(x) ? claseJugador(x) : null;
        const n = el('span', 'bk-n' + (c ? ` cl-${c}` : ''), txt);
        r.append(icono(c), n);
        if (gana) { const s = svg('M2.5 6.4 5 8.8 9.6 3.6', 'bk-ok'); r.append(s); r.setAttribute('aria-label', `${x}, ganó`); }
        else if (pierde) { const s = svg('M3.5 3.5l5 5M8.5 3.5l-5 5', 'bk-ko'); r.append(s); r.setAttribute('aria-label', `${x}, perdió`); }
        return r;
      };
      box.append(fila(m.a, m.sa), fila(m.b, m.sb));
      return box;
    };
    // llave con líneas de unión: los duelos de cada ronda van de dos en dos hacia el siguiente
    const llave = (res, etiqueta, guardarGanador, extra) => {
      const wrap = el('div', 'bk-scroll');
      const grid = el('div', 'bk-grid');
      const total = res.rondas.length;
      res.rondas.forEach((ms, r) => {
        const col = el('div', 'bk-col' + (r === total - 1 ? ' is-last' : ''));
        col.append(el('div', 'bk-h', nombreRonda(r, total)));
        const lista = el('div', 'bk-list');
        if (r === total - 1) { const s = el('div', 'bk-slot'); s.append(duelo(ms[0], etiqueta, guardarGanador)); lista.append(s); }
        else for (let i = 0; i < ms.length; i += 2) {
          const par = el('div', 'bk-pair');
          for (const m of ms.slice(i, i + 2)) { const s = el('div', 'bk-slot'); s.append(duelo(m, etiqueta, guardarGanador)); par.append(s); }
          lista.append(par);
        }
        col.append(lista); grid.append(col);
      });
      if (extra) grid.append(extra);
      wrap.append(grid);
      return wrap;
    };

    const pintarTramo = (i, calc) => {
      const t = T.tramos[i], res = calc.tramos[i];
      const out = [];
      if (t.jugadores.length < 2) out.push(el('p', 'bk-empty', t.jugadores.length ? `Solo hay un jugador inscrito: ${t.jugadores[0]}.` : 'Todavía no hay jugadores inscritos en este tramo.'));
      else {
        const set = (key, nombre) => { const next = structuredClone(T); if (nombre) next.tramos[i].ganadores[key] = nombre; else delete next.tramos[i].ganadores[key]; guardar(next, `Torneo: resultado en ${t.nombre}`); };
        out.push(llave(res, () => '', set));
      }
      out.push(el('p', 'bk-note', res.campeon ? `Campeón del tramo: ${res.campeon}. Juega la Gran final.` : 'El ganador de este tramo juega la Gran final.'));
      if (canEdit()) out.push(editorTramo(i));
      return out;
    };
    const pintarFinal = (calc) => {
      const res = calc.final, out = [];
      const podio = el('ol', 'bk-podio');
      [res.campeon, res.segundo, res.tercero].forEach((n, k) => {
        const li = el('li', 'bk-pos p' + (k + 1));
        const c = n ? claseJugador(n) : null;
        const who = el('span', 'bk-pos-who'); who.append(icono(c), el('span', 'bk-n' + (n ? (c ? ` cl-${c}` : '') : ' is-tbd'), n || 'Por definir'));
        li.append(el('span', 'bk-pos-n', `${k + 1}.º`), who, el('span', 'bk-pos-prize', T.premios[k] || ''));
        podio.append(li);
      });
      out.push(podio);
      const etiqueta = (seed) => (seed && T.tramos[seed - 1] ? `Campeón ${T.tramos[seed - 1].nombre}` : '');
      const set = (key, nombre) => { const next = structuredClone(T); if (nombre) next.final.ganadores[key] = nombre; else delete next.final.ganadores[key]; guardar(next, 'Torneo: resultado en la Gran final'); };
      let extra = null;
      if (res.p3) {
        extra = el('div', 'bk-col is-last is-p3');
        extra.append(el('div', 'bk-h', 'Por el 3.er puesto'));
        const l = el('div', 'bk-list'); const s = el('div', 'bk-slot'); s.append(duelo(res.p3, () => 'Perdedor de semifinal', set)); l.append(s); extra.append(l);
      }
      if (res.rondas.length) out.push(llave(res, etiqueta, set, extra));
      else out.push(el('p', 'bk-empty', 'Hacen falta al menos dos tramos para la Gran final.'));
      return out;
    };

    // admin: nombre del tramo, lista de jugadores («Nombre, Clase», una por línea, en orden de cabeza de serie) y sorteo
    const editorTramo = (i) => {
      const t = T.tramos[i];
      const box = el('div', 'bk-edit');
      const nom = document.createElement('input'); nom.id = 'bk-nom'; nom.type = 'text'; nom.maxLength = MAX_NOMBRE; nom.value = t.nombre;
      const lab1 = el('label', null, 'Nombre del tramo'); lab1.htmlFor = 'bk-nom';
      const ta = document.createElement('textarea'); ta.id = 'bk-jug'; ta.rows = 7;
      ta.value = t.jugadores.map((n) => (t.clases[n] ? `${n}, ${CLASES[t.clases[n]].es}` : n)).join('\n');
      ta.placeholder = 'Mortisangre, Brujo\nHuesitos, Pícaro';
      const lab2 = el('label', null, `Jugadores: uno por línea con su clase después de una coma (máximo ${MAX_JUG}). El orden decide los cruces: el primero se enfrenta al último.`); lab2.htmlFor = 'bk-jug';
      const leyenda = el('p', 'bk-note', `Clases: ${Object.values(CLASES).map((c) => c.es).join(', ')}.`);
      const err = el('div', 'err');
      const guardarLista = () => {
        const { jugadores, clases } = leerJugadores(ta.value), nombre = limpiarNombre(nom.value);
        if (!nombre) { err.textContent = 'El tramo necesita un nombre.'; return; }
        const next = structuredClone(T);
        const cambia = jugadores.join('\n') !== t.jugadores.join('\n');
        next.tramos[i] = { nombre, jugadores, clases, ganadores: cambia ? {} : t.ganadores };
        if (cambia) next.final.ganadores = {};
        const sinClase = jugadores.filter((n) => !clases[n]).length;
        guardar(next, `Torneo: ${nombre} (${jugadores.length} jugadores)`).then((ok) => {
          if (!ok) return;
          const aviso = sinClase ? ` ${sinClase === 1 ? 'Un jugador no tiene' : `${sinClase} jugadores no tienen`} clase reconocida.` : '';
          toast((cambia ? 'Tramo guardado. Sus resultados y los de la Gran final empiezan de cero.' : 'Tramo guardado.') + aviso);
        });
      };
      const sortear = () => {
        const l = String(ta.value).split('\n').filter((x) => x.trim());
        for (let k = l.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [l[k], l[j]] = [l[j], l[k]]; }
        ta.value = l.join('\n');
      };
      const quitar = () => {
        if (T.tramos.length <= 1) { err.textContent = 'Tiene que quedar al menos un tramo.'; return; }
        if (!box.querySelector('.confirm')) {
          const cf = el('div', 'confirm'); cf.append(document.createTextNode(`¿Quitar el tramo «${t.nombre}» con sus jugadores y resultados?`));
          cf.append(btn('bk-btn is-danger', 'Sí, quitar', () => { const next = structuredClone(T); next.tramos.splice(i, 1); next.final.ganadores = {}; tab = 0; guardar(next, `Torneo: quitar ${t.nombre}`); }), btn('bk-btn', 'No', () => cf.remove()));
          box.append(cf);
        }
      };
      const fila = el('div', 'bk-edit-row');
      fila.append(btn('bk-btn', 'Sortear orden', sortear), btn('bk-btn is-danger', 'Quitar tramo', quitar), btn('bk-btn is-main', 'Guardar tramo', guardarLista));
      box.append(el('h4', null, 'Editar tramo'), lab1, nom, lab2, ta, leyenda, err, el('p', 'bk-note', 'Cambiar la lista de jugadores borra los resultados de este tramo y de la Gran final.'), fila);
      return box;
    };

    const pintar = () => {
      const calc = calcular(T);
      const head = el('div', 'bk-head');
      const tit = el('div', 'bk-tit'); tit.append(el('span', 'bk-kick', T.subtitulo), el('h2', null, T.titulo));
      const x = btn('bk-x', null, cerrar); x.setAttribute('aria-label', 'Cerrar el bracket');
      x.append(svg('M3 3l6 6M9 3l-6 6'));
      head.append(tit, x);
      const tabs = el('div', 'bk-tabs'); tabs.setAttribute('role', 'tablist');
      const nTabs = T.tramos.length + 1;
      if (tab >= nTabs) tab = 0;
      T.tramos.forEach((t, i) => {
        const b = btn('bk-tab', t.nombre, () => { tab = i; pintar(); });
        const c = calc.tramos[i].campeon; if (c) b.title = `Campeón: ${c}`;
        b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab === i)); tabs.append(b);
      });
      const bf = btn('bk-tab is-final', 'Gran final', () => { tab = T.tramos.length; pintar(); });
      bf.setAttribute('role', 'tab'); bf.setAttribute('aria-selected', String(tab === T.tramos.length)); tabs.append(bf);
      if (canEdit() && T.tramos.length < MAX_TRAMOS) {
        tabs.append(btn('bk-tab is-add', '+ Tramo', () => { const next = structuredClone(T); next.tramos.push({ nombre: `Tramo ${next.tramos.length + 1}`, jugadores: [], clases: {}, ganadores: {} }); next.final.ganadores = {}; tab = next.tramos.length - 1; guardar(next, 'Torneo: añadir tramo'); }));
      }
      const body = el('div', 'bk-body');
      body.append(...(tab < T.tramos.length ? pintarTramo(tab, calc) : pintarFinal(calc)));
      if (canEdit()) body.append(el('p', 'bk-note', `Admin: tocá el nombre de quien ganó cada duelo. Los cambios se ven en la web en unos minutos. Ahora el bracket está ${T.visible ? 'visible para todos' : 'oculto para los visitantes'} (botón «Bracket» de la barra de arriba).`));
      panel.replaceChildren(head, tabs, body);
    };

    const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
    async function open() {
      ultimoFoco = document.activeElement;
      ov.hidden = false; document.addEventListener('keydown', onKey);
      panel.replaceChildren(el('p', 'bk-empty', 'Cargando el bracket…'));
      try { await cargar(); pintar(); } catch (e) { panel.replaceChildren(el('p', 'bk-empty', 'No se pudo cargar el bracket. Probá de nuevo en un rato.'), btn('bk-btn', 'Cerrar', cerrar)); return; }
      const f = panel.querySelector('.bk-tab[aria-selected="true"]') || panel.querySelector('.bk-x'); if (f) f.focus();
    }
    function cerrar() {
      ov.hidden = true; document.removeEventListener('keydown', onKey);
      if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
    }
    // admin: mostrar u ocultar el bracket a los visitantes (se guarda en torneo.json)
    const alternarVisible = async () => {
      if (!canEdit() || ocupado) return;
      try { await cargar(); } catch (e) { fail(e); return; }
      const next = { ...structuredClone(T), visible: !T.visible };
      const ok = await guardar(next, next.visible ? 'Torneo: mostrar el bracket a los visitantes' : 'Torneo: ocultar el bracket a los visitantes');
      if (ok) toast(next.visible ? 'Bracket visible para todos. Se verá en la web en unos minutos.' : 'Bracket oculto para los visitantes. Se quitará de la web en unos minutos.');
    };
    abrir.append(svg('M4.5 3 7.5 6 4.5 9'));
    abrir.addEventListener('click', open);
    ov.addEventListener('click', (e) => { if (e.target === ov) cerrar(); });
    if (interruptor) interruptor.addEventListener('click', alternarVisible);
    sync();
    // visitantes: el botón aparece solo si torneo.json dice visible
    fetch(`${FILE}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!sha) { visibleWeb = normalizar(d).visible; sync(); } })
      .catch(() => { /* sin torneo.json: queda oculto */ });
    return { sync, refrescar: () => cargar().catch(() => { /* sin datos: se queda como está */ }) };
  };
})();
