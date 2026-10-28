(async () => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const PROV_K = 3.2;
  const regionName = (() => { try { const dn = new Intl.DisplayNames(['es'], { type: 'region' }); return (c) => { try { return c ? dn.of(c) : ''; } catch { return c || ''; } }; } catch { return (c) => c || ''; } })();
  const flag = (c) => (c && /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0))) : '');
  // flags as their own element in a color-emoji font (Windows shows only letters otherwise)
  const withFlag = (code, text) => { const f = flag(code); if (!f) return [text]; const sp = document.createElement('span'); sp.className = 'flag'; sp.textContent = f; return [sp, ' ' + text]; };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const place = (...xs) => xs.filter((x, i, a) => x && a.findIndex((y) => norm(y) === norm(x)) === i).join(', ');
  // redes adicionales: se guardan como URL https completa y se vuelven a validar al mostrarlas
  const SOC_MONO = { instagram: 'IG', youtube: 'YT', tiktok: 'TT', facebook: 'FB', x: 'X', kick: 'K' };
  const SOCIALS = [['instagram', 'Instagram', ['instagram.com'], 'instagram.com/'], ['youtube', 'YouTube', ['youtube.com', 'youtu.be'], 'youtube.com/@'], ['tiktok', 'TikTok', ['tiktok.com'], 'tiktok.com/@'], ['facebook', 'Facebook', ['facebook.com', 'fb.com'], 'facebook.com/'], ['x', 'X', ['x.com', 'twitter.com'], 'x.com/'], ['kick', 'Kick', ['kick.com'], 'kick.com/']];
  const socialUrl = (key, raw) => {
    const def = SOCIALS.find((x) => x[0] === key); let v = String(raw || '').trim().split(/\s+/)[0];
    if (!def || !v) return '';
    if (!/^https?:\/\//i.test(v)) v = /^[\w.-]+\.[a-z]{2,}\//i.test(v) ? 'https://' + v : 'https://' + def[3] + v.replace(/^@/, '');
    try {
      const u = new URL(v); const h = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
      if (!def[2].includes(h)) return '';
      let path = u.pathname.replace(/\/+$/, '');
      if (key === 'tiktok' && /^\/[^/@][^/]*$/.test(path)) path = '/@' + path.slice(1);
      return 'https://' + (key === 'x' ? 'x.com' : key === 'kick' ? 'kick.com' : 'www.' + h) + path + (key === 'youtube' && u.searchParams.get('v') ? '?v=' + encodeURIComponent(u.searchParams.get('v')) : '');
    } catch { return ''; }
  };
  const twitchUrl = (login) => 'https://www.twitch.tv/' + encodeURIComponent(String(login).trim().toLowerCase());
  // quien solo emite en Kick lleva platform: 'kick' (su id sigue en el campo twitch); su canal y su botón van a Kick
  const isKick = (p) => p.platform === 'kick';
  const channelUrl = (p) => isKick(p) ? 'https://kick.com/' + encodeURIComponent(String(p.twitch).trim().toLowerCase()) : twitchUrl(p.twitch);
  const nowIso = () => new Date().toISOString();

  // ---------- state ----------
  const S = {
    db: null, user: null, downloads: null, canEdit: false, uid: null,
    all: new Map(), // login -> doc (incl. deleted)
    history: [], names: {},
    rot: [60, -18], k: 1, open: null, picking: null, q: '', loaded: false,
  };

  // ---------- geo ----------
  const decodeTopo = (topo) => {
    const t = topo.transform;
    const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map((p) => { if (!t) return p; x += p[0]; y += p[1]; return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]]; }); });
    const arc = (i) => (i < 0 ? arcs[~i].slice().reverse() : arcs[i]);
    const ring = (ids) => { const out = []; ids.forEach((i, n) => { const a = arc(i); out.push(...(n ? a.slice(1) : a)); }); return out; };
    const geom = (g) => g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.arcs.map(ring) } : g.type === 'MultiPolygon' ? { type: 'MultiPolygon', coordinates: g.arcs.map((p) => p.map(ring)) } : null;
    return Object.values(topo.objects)[0].geometries.map((g) => ({ type: 'Feature', properties: g.properties || {}, geometry: geom(g) })).filter((f) => f.geometry);
  };
  const fixWinding = (f) => {
    if (d3.geoArea(f) > 2 * Math.PI) {
      const rev = (r) => r.slice().reverse();
      f.geometry.coordinates = f.geometry.type === 'Polygon' ? f.geometry.coordinates.map(rev) : f.geometry.coordinates.map((p) => p.map(rev));
    }
    return f;
  };
  const prep = (f) => {
    fixWinding(f);
    const c = d3.geoCentroid(f);
    let rad = 0;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) { const r = p[0]; const step = Math.max(1, Math.floor(r.length / 40)); for (let i = 0; i < r.length; i += step) rad = Math.max(rad, d3.geoDistance(c, r[i])); }
    f.c = c; f.rad = rad;
    return f;
  };
  let G = null;
  // coastlines (arcs used by one country) and land borders (shared by two), each arc on its own for culling
  const meshArcs = (topo) => {
    const t = topo.transform;
    const dec = topo.arcs.map((a) => { let x = 0, y = 0; return a.map((p) => { if (!t) return p; x += p[0]; y += p[1]; return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]]; }); });
    const uses = new Uint8Array(dec.length);
    const walk = (a) => { if (typeof a === 'number') uses[a < 0 ? ~a : a]++; else a.forEach(walk); };
    Object.values(topo.objects)[0].geometries.forEach((g) => g.arcs && walk(g.arcs));
    const coast = [], border = [];
    dec.forEach((pts, i) => {
      if (!uses[i] || pts.length < 2) return;
      const f = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } };
      f.c = d3.geoCentroid(f); let rad = 0; const step = Math.max(1, Math.floor(pts.length / 30));
      for (let j = 0; j < pts.length; j += step) rad = Math.max(rad, d3.geoDistance(f.c, pts[j]));
      f.rad = Math.max(rad, d3.geoDistance(f.c, pts[pts.length - 1]));
      (uses[i] > 1 ? border : coast).push(f);
    });
    return { coast, border };
  };
  const buildSet = (ct, pt) => {
    const countries = decodeTopo(ct).map(prep);
    const provinces = decodeTopo(pt).map(prep);
    // each island/landmass on its own, so close-up drawing can skip what is off screen
    const parts = [];
    for (const f of countries) {
      if (f.geometry.type === 'Polygon') { parts.push(f); continue; }
      for (const poly of f.geometry.coordinates) parts.push(prep({ type: 'Feature', properties: f.properties, geometry: { type: 'Polygon', coordinates: poly } }));
    }
    const byCode = new Map(countries.map((f) => [f.properties.code, f]));
    const groups = [...d3.group(provinces, (f) => f.properties.adm0_a3)].map(([code, fs]) => {
      const c = d3.geoCentroid({ type: 'FeatureCollection', features: fs });
      return { code, fs, c, rad: d3.max(fs, (f) => d3.geoDistance(c, f.c) + f.rad) };
    });
    const provById = new Map(provinces.map((f) => [f.properties.pid, f]));
    // tramos de los límites de provincia, cada uno una vez (para el mapa en la tarjeta gráfica)
    const t = pt.transform, parcs = [];
    for (const a of pt.arcs) { let x = 0, y = 0; if (a.length > 1) parcs.push(a.map((q) => { if (!t) return q; x += q[0]; y += q[1]; return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]]; })); }
    return { countries, parts, provinces, byCode, groups, provById, parcs, ...meshArcs(ct) };
  };
  const ASSET_V = '20261025k';
  const getJson = (u) => fetch(u + '?v=' + ASSET_V).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
  // Two levels of detail: a light map for moving/far views, the detailed one once loaded and idle.
  const loadGeo = async () => {
    const [cl, pl] = await Promise.all([getJson('countries-lo.json'), getJson('provinces-lo.json')]);
    const lo = buildSet(cl, pl);
    G = { lo, hi: null, ...lo, provIndex: [] };
    // countries first (choosing only the country is enough), then provinces
    const mainland = (f) => {
      if (f.geometry.type !== 'MultiPolygon') return f.c;
      const best = d3.greatest(f.geometry.coordinates, (poly) => d3.geoArea({ type: 'Polygon', coordinates: poly }));
      return d3.geoCentroid({ type: 'Polygon', coordinates: best });
    };
    const index = (set) => [
      ...set.countries.filter((f) => f.properties.code).map((f) => {
        const iso2 = f.properties.iso2 || '';
        const cname = regionName(iso2) || f.properties.name;
        return { country: f, at: mainland(f), label: `${cname} · todo el país`, key: norm(cname + ' ' + f.properties.name) };
      }),
      ...set.provinces.map((f) => {
        const country = set.byCode.get(f.properties.adm0_a3);
        const iso2 = country ? country.properties.iso2 : '';
        const cname = regionName(iso2) || f.properties.admin;
        return { f, label: `${f.properties.name}, ${cname}`, key: norm(f.properties.name + ' ' + cname + ' ' + f.properties.admin) };
      }),
    ];
    G.provIndex = index(lo);
    Promise.all([getJson('countries.json'), getJson('provinces.json')]).then(([ch, ph]) => {
      const hi = buildSet(ch, ph);
      Object.assign(G, hi, { hi, provIndex: index(hi) });
      texDirty = true;
      schedule();
    }).catch(() => {});
  };

  // Find country + province for a point
  const locate = (ll) => {
    let country = G.countries.find((f) => d3.geoDistance(f.c, ll) <= f.rad + 0.05 && d3.geoContains(f, ll));
    let pool = G.provinces;
    if (country) pool = G.provinces.filter((f) => f.properties.adm0_a3 === country.properties.code);
    let prov = pool.find((f) => d3.geoDistance(f.c, ll) <= f.rad + 0.05 && d3.geoContains(f, ll));
    if (!prov) prov = d3.least(pool.length ? pool : G.provinces, (f) => d3.geoDistance(f.c, ll));
    if (!country && prov) country = G.byCode.get(prov.properties.adm0_a3);
    const iso2 = country ? country.properties.iso2 : '';
    return {
      lon: +ll[0].toFixed(4), lat: +ll[1].toFixed(4),
      province: prov ? prov.properties.name : '', province_id: prov ? prov.properties.pid : '',
      country_code: country ? country.properties.code : (prov ? prov.properties.adm0_a3 : ''),
      country_iso2: iso2, country: regionName(iso2) || (country ? country.properties.name : ''),
    };
  };

  // ---------- time zones ----------
  const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; } })();
  const guessTz = (iso2, lon, lat) => {
    const one = { AR: 'America/Argentina/Buenos_Aires', CO: 'America/Bogota', PE: 'America/Lima', VE: 'America/Caracas', UY: 'America/Montevideo', PY: 'America/Asuncion', BO: 'America/La_Paz', GT: 'America/Guatemala', SV: 'America/El_Salvador', HN: 'America/Tegucigalpa', NI: 'America/Managua', CR: 'America/Costa_Rica', PA: 'America/Panama', CU: 'America/Havana', DO: 'America/Santo_Domingo', PR: 'America/Puerto_Rico', GQ: 'Africa/Malabo', GB: 'Europe/London', IE: 'Europe/Dublin', FR: 'Europe/Paris', IT: 'Europe/Rome', DE: 'Europe/Berlin', AD: 'Europe/Andorra', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', CH: 'Europe/Zurich', JP: 'Asia/Tokyo', KR: 'Asia/Seoul' };
    if (one[iso2]) return one[iso2];
    if (iso2 === 'ES') return lon < -12 ? 'Atlantic/Canary' : 'Europe/Madrid';
    if (iso2 === 'PT') return lon < -20 ? 'Atlantic/Azores' : lon < -14 ? 'Atlantic/Madeira' : 'Europe/Lisbon';
    if (iso2 === 'CL') return lon < -100 ? 'Pacific/Easter' : 'America/Santiago';
    if (iso2 === 'EC') return lon < -85 ? 'Pacific/Galapagos' : 'America/Guayaquil';
    if (iso2 === 'MX') return lon < -114 ? 'America/Tijuana' : (lon < -108.5 && lat > 26) ? 'America/Hermosillo' : lon < -104.5 ? 'America/Mazatlan' : lon > -88.5 ? 'America/Cancun' : 'America/Mexico_City';
    if (iso2 === 'BR') return lon < -66 ? 'America/Rio_Branco' : lon < -54 ? 'America/Manaus' : 'America/Sao_Paulo';
    if (iso2 === 'US') {
      if (lat < 23 && lon < -154) return 'Pacific/Honolulu';
      if (lon < -141) return 'America/Anchorage';
      if (lon < -109 && lon > -114.8 && lat < 37 && lat > 31.3) return 'America/Phoenix';
      return lon > -87.5 ? 'America/New_York' : lon > -101 ? 'America/Chicago' : lon > -114 ? 'America/Denver' : 'America/Los_Angeles';
    }
    if (iso2 === 'CA') return lon > -64 ? 'America/Halifax' : lon > -90 ? 'America/Toronto' : lon > -102 ? 'America/Winnipeg' : lon > -120 ? 'America/Edmonton' : 'America/Vancouver';
    const h = Math.max(-12, Math.min(12, Math.round(lon / 15)));
    return h === 0 ? 'UTC' : `Etc/GMT${h < 0 ? '+' : '-'}${Math.abs(h)}`;
  };
  const fmtCache = new Map();
  const timeIn = (tz, withSec) => {
    const key = tz + withSec;
    try {
      if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('es', { timeZone: tz, hour: '2-digit', minute: '2-digit', ...(withSec ? { second: '2-digit' } : {}), hourCycle: 'h23' }));
      return fmtCache.get(key).format(new Date());
    } catch { return '—'; }
  };
  const offsetOf = (tz) => { try { return new Intl.DateTimeFormat('es', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName').value; } catch { return ''; } };
  const ageOf = (s) => {
    if (s.birthdate && /^\d{4}-\d{2}-\d{2}$/.test(s.birthdate)) {
      const [y, m, d] = s.birthdate.split('-').map(Number); const t = new Date();
      let a = t.getFullYear() - y; if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) a--;
      return a >= 0 && a < 130 ? a : null;
    }
    return Number.isFinite(+s.age) && s.age !== '' && s.age != null ? +s.age : null;
  };
  const fmtDate = (s) => { try { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { return s; } };

  // ---------- avatars ----------
  const initial = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
  const avatar = (s) => {
    if (s && typeof s.avatar === 'string' && (s.avatar.startsWith('data:image/') || /^https:\/\/static-cdn\.jtvnw\.net\//.test(s.avatar))) {
      const img = el('img', 'av'); img.alt = ''; img.src = s.avatar;
      img.addEventListener('error', () => img.replaceWith(el('span', 'av', initial(s.name || s.twitch))));
      return img;
    }
    return el('span', 'av', initial(s && (s.name || s.twitch)));
  };
  const fileToAvatar = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const N = 72, c = document.createElement('canvas'); c.width = c.height = N;
      const g = c.getContext('2d'); const m = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, N, N);
      URL.revokeObjectURL(url);
      let out = c.toDataURL('image/webp', 0.8); if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.82);
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });

  // ---------- globe ----------
  const stage = $('stage'), canvas = $('globe'), screenCtx = canvas.getContext('2d'), labels = $('labels'), stemsEl = $('stems');
  let ctx = screenCtx; // el mapa de cerca a veces se pinta en la foto de fuera de pantalla (ver snapshot)
  const glCanvas = $('globe-gl');
  const projection = d3.geoOrthographic().clipAngle(90).precision(0.6);
  const path = d3.geoPath(projection, ctx);
  const graticule = d3.geoGraticule10();
  let W = 0, H = 0, R = 0, raf = 0, colors = {};
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const readColors = () => {
    colors = { a: css('--ocean-a'), b: css('--ocean-b'), land: css('--land'), edge: css('--land-edge'), line: css('--coast'), border: css('--border-line'), prov: css('--prov-line'), hi: css('--hi'), grid: css('--grid'), ripple: css('--ripple') };
    texDirty = true;
  };
  // ---------- watermark: the project logo, large and faint over the two biggest oceans ----------
  const WM = { img: new Image(), ok: false, a: 0.2, spots: [{ lon: -145, lat: 4, s: 36 }, { lon: -42, lat: 27, s: 27.6 }] };
  WM.img.onload = () => { WM.ok = true; if (typeof schedule === 'function') schedule(); };
  WM.img.src = `watermark.webp?v=${ASSET_V}`;
  const wmSize = (sp) => { const k = WM.img.naturalHeight / WM.img.naturalWidth; return [sp.s / Math.cos(sp.lat * RAD), sp.s * k]; }; // width in degrees of longitude, height in degrees of latitude
  // flat map (the baked world texture)
  const wmFlat = (g, TW, TH) => {
    if (!WM.ok) return;
    g.save(); g.globalAlpha = WM.a;
    for (const sp of WM.spots) { const [wl, hl] = wmSize(sp), w = wl / 360 * TW, h = hl / 180 * TH; g.drawImage(WM.img, (sp.lon + 180) / 360 * TW - w / 2, (90 - sp.lat) / 180 * TH - h / 2, w, h); }
    g.restore();
  };
  // close-up vector view: the image is laid on the sphere with the local affine of the projection
  const WMP = d3.geoOrthographic().clipAngle(null).precision(0.6);
  const wmView = (ctx, proj, c, disk) => {
    if (!WM.ok) return;
    const iw = WM.img.naturalWidth, ih = WM.img.naturalHeight;
    ctx.save(); ctx.clip(disk);
    WMP.translate(proj.translate()).scale(proj.scale()).rotate(proj.rotate()); const free = WMP;
    for (const sp of WM.spots) {
      const dist = d3.geoDistance([sp.lon, sp.lat], c) * 180 / Math.PI;
      const fade = Math.min(1, Math.max(0, (80 - dist) / 25)); // fades out toward the horizon
      if (fade <= 0) continue;
      const [wl, hl] = wmSize(sp), d = 0.5;
      const p0 = free([sp.lon, sp.lat]), pe = free([sp.lon + d, sp.lat]), pn = free([sp.lon, sp.lat + d]);
      if (!p0 || !pe || !pn) continue;
      const ex = (pe[0] - p0[0]) / d, ey = (pe[1] - p0[1]) / d, nx = (pn[0] - p0[0]) / d, ny = (pn[1] - p0[1]) / d;
      ctx.globalAlpha = WM.a * fade;
      ctx.transform(ex * wl / iw, ey * wl / iw, -nx * hl / ih, -ny * hl / ih, p0[0] - ex * wl / 2 + nx * hl / 2, p0[1] - ey * wl / 2 + ny * hl / 2);
      ctx.drawImage(WM.img, 0, 0);
    }
    ctx.restore();
  };

  // ---------- parchment ----------
  // A tile of stains and paper grain, generated once, reused for the world texture, the close-up map and the overlay.
  const stains = (() => {
    const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, N, N);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * N, y = rnd() * N, rr = 20 + rnd() * 120, a = 0.05 + rnd() * 0.12;
      for (const [dx, dy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rr);
        gr.addColorStop(0, `rgba(110,80,40,${a})`); gr.addColorStop(1, 'rgba(110,80,40,0)');
        g.fillStyle = gr; g.fillRect(x + dx - rr, y + dy - rr, rr * 2, rr * 2);
      }
    }
    const img = g.getImageData(0, 0, N, N), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    return cv;
  })();

  // tope 1,5: a 2x el mapa de cerca cuesta casi el doble de pintar y en pantallas con escala alta se notaban tirones; a 1,5 se ve igual de nítido
  const DPR = () => Math.min(1.5, window.devicePixelRatio || 1);
  const resize = () => {
    W = stage.clientWidth; H = stage.clientHeight; R = Math.min(W, H) / 2 * 0.9;
    const dpr = DPR();
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (glCanvas) { glCanvas.width = canvas.width; glCanvas.height = canvas.height; }
    schedule();
  };
  const live = () => [...S.all.values()].filter((s) => !s.deleted && Number.isFinite(+s.lat) && Number.isFinite(+s.lon));
  const center = () => [-S.rot[0], -S.rot[1]];
  const reach = () => Math.min(Math.PI / 2, Math.asin(Math.min(1, Math.hypot(W, H) / 2 / (R * S.k)))) + 0.08;
  // ---------- recorte por trozos + proyección rápida ----------
  // Cada anillo/línea se parte en trozos de 48 vértices con su círculo envolvente. En cada fotograma solo se proyectan los
  // trozos que caen dentro de la vista; los que quedan fuera se sustituyen por una cuerda (que, por estar dentro del círculo
  // envolvente, nunca entra en pantalla). Resultado idéntico, con un coste proporcional a lo que se ve y no al país entero.
  // Con la vista dentro del disco, la proyección ortográfica se hace a mano sobre vectores unitarios precalculados.
  const RAD = Math.PI / 180, CH = 48;
  const unit = (p) => { const l = p[0] * RAD, f = p[1] * RAD, cf = Math.cos(f); return [cf * Math.cos(l), cf * Math.sin(l), Math.sin(f)]; };
  const uOf = (pts) => {
    let U = pts._u; if (U) return U;
    const n = pts.length; U = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const l = pts[i][0] * RAD, f = pts[i][1] * RAD, cf = Math.cos(f); U[i * 3] = cf * Math.cos(l); U[i * 3 + 1] = cf * Math.sin(l); U[i * 3 + 2] = Math.sin(f); }
    pts._u = U; return U;
  };
  const chunksOf = (pts, lineCum) => {
    let ch = pts._ch; if (ch && (!lineCum || ch.cum)) return ch;
    const n = pts.length, nc = Math.max(1, Math.ceil((n - 1) / CH)), U = uOf(pts);
    ch = { n: nc, i0: new Int32Array(nc), i1: new Int32Array(nc), c: new Float32Array(nc * 3), cr: new Float32Array(nc), sr: new Float32Array(nc), big: new Uint8Array(nc), cum: null };
    for (let k = 0; k < nc; k++) {
      const a = k * CH, b = Math.min(n - 1, a + CH); ch.i0[k] = a; ch.i1[k] = b;
      let x = 0, y = 0, z = 0; for (let i = a; i <= b; i++) { x += U[i * 3]; y += U[i * 3 + 1]; z += U[i * 3 + 2]; }
      let m = Math.hypot(x, y, z); if (m < 1e-9) { x = U[a * 3]; y = U[a * 3 + 1]; z = U[a * 3 + 2]; m = 1; } x /= m; y /= m; z /= m;
      let mn = 1; for (let i = a; i <= b; i++) mn = Math.min(mn, x * U[i * 3] + y * U[i * 3 + 1] + z * U[i * 3 + 2]);
      const rad = Math.acos(Math.max(-1, Math.min(1, mn))) + 1e-4;
      ch.c[k * 3] = x; ch.c[k * 3 + 1] = y; ch.c[k * 3 + 2] = z; ch.cr[k] = Math.cos(rad); ch.sr[k] = Math.sin(rad); ch.big[k] = rad > 1.4 ? 1 : 0;
    }
    if (lineCum) { const cum = new Float32Array(n); for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.acos(Math.max(-1, Math.min(1, U[i * 3] * U[i * 3 - 3] + U[i * 3 + 1] * U[i * 3 - 2] + U[i * 3 + 2] * U[i * 3 - 1]))); ch.cum = cum; }
    pts._ch = ch; return ch;
  };
  // ¿el trozo k se ve? (ángulo al centro de la vista < alcance + radio del trozo)
  const seen = (ch, k, V, cr, sr) => ch.big[k] === 1 || V[0] * ch.c[k * 3] + V[1] * ch.c[k * 3 + 1] + V[2] * ch.c[k * 3 + 2] > cr * ch.cr[k] - sr * ch.sr[k];
  // índices de los vértices que hay que dibujar en un anillo (null = todos)
  const cullIdx = (pts, V, cr, sr) => {
    if (pts.length <= CH + 1) return null;
    const ch = chunksOf(pts), out = []; let prev = false;
    for (let k = 0; k < ch.n; k++) {
      const i0 = ch.i0[k], i1 = ch.i1[k], v = seen(ch, k, V, cr, sr);
      if (v) { for (let i = prev ? i0 + 1 : i0; i <= i1; i++) out.push(i); }
      else if (!prev) out.push(i0);
      prev = v;
    }
    if (!prev) out.push(pts.length - 1);
    return out;
  };
  const cullPoly = (g, V, cr, sr) => {
    const ring = (r) => ({ pts: r, idx: cullIdx(r, V, cr, sr) });
    return g.type === 'Polygon' ? [g.coordinates.map(ring)] : g.coordinates.map((pl) => pl.map(ring));
  };
  const polyGeom = (polys) => ({ type: 'MultiPolygon', coordinates: polys.map((pl) => pl.map((sg) => sg.idx ? sg.idx.map((i) => sg.pts[i]) : sg.pts)) });
  // tramos visibles de una línea (cada uno con su distancia acumulada, para que los guiones no "corran" al mover)
  const cullLine = (pts, V, cr, sr, out) => {
    const ch = chunksOf(pts, true); let cur = null;
    for (let k = 0; k < ch.n; k++) {
      const i0 = ch.i0[k], i1 = ch.i1[k];
      if (seen(ch, k, V, cr, sr)) {
        if (!cur) { cur = { pts, idx: [], d: ch.cum[i0] }; out.push(cur); for (let i = i0; i <= i1; i++) cur.idx.push(i); }
        else for (let i = i0 + 1; i <= i1; i++) cur.idx.push(i);
      } else cur = null;
    }
    return out;
  };
  const lineGeom = (q) => ({ type: 'LineString', coordinates: q.idx.map((i) => q.pts[i]) });
  // proyección ortográfica a mano → Path2D/contexto. Devuelve false si no se puede (arista enorme o salto por detrás).
  // los vértices de detrás (los de relleno de los trozos que no se ven) se llevan fuera del disco, en su misma dirección:
  // así no se doblan sobre la cara visible y el relleno sigue bien sin pasar por d3 (que es diez veces más lento)
  const emitSeg = (p2, seg, M, close) => {
    const U = uOf(seg.pts), idx = seg.idx, n = idx ? idx.length : seg.pts.length;
    const { cl, sl, cf, sf, s, cx, cy } = M;
    let have = false, pu0 = 0, pu1 = 0, pu2 = 0, bx = 0, by = 0, back = false, lx = 0, ly = 0;
    // los vértices a menos de medio píxel del anterior no se ven y solo encarecen el dibujo: se saltan (salvo el último)
    const tol = 0.5 / s;
    const put = (x0, y0, z0, last) => {
      const d = x0 * cf - z0 * sf, yy = z0 * cf + x0 * sf;
      let X = y0, Y = yy;
      if (d < 0) {
        const len = Math.hypot(y0, yy); if (len < 1e-3) return true; // justo en la antípoda: se salta
        const nx = y0 / len, ny = yy / len;
        if (back && have && nx * bx + ny * by < 0.5) {
          // salto grande por detrás: se rodea por un arco lejos del disco, para no cruzar la cara visible
          const a0 = Math.atan2(-by, bx), a1 = Math.atan2(-ny, nx);
          let da = a1 - a0; if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
          p2.lineTo(cx + 2.2 * s * bx, cy - 2.2 * s * by); p2.arc(cx, cy, 2.2 * s, a0, a0 + da, da < 0);
        }
        const f = (1 - d) / len; X = y0 * f; Y = yy * f; back = true; bx = nx; by = ny;
      } else back = false;
      if (!have) p2.moveTo(cx + s * X, cy - s * Y);
      else if (last || Math.abs(X - lx) + Math.abs(Y - ly) > tol) p2.lineTo(cx + s * X, cy - s * Y);
      else return true;
      have = true; lx = X; ly = Y; return true;
    };
    for (let j = 0; j < n; j++) {
      const i = idx ? idx[j] : j, u0 = U[i * 3], u1 = U[i * 3 + 1], u2 = U[i * 3 + 2];
      if (have) {
        const dot = u0 * pu0 + u1 * pu1 + u2 * pu2;
        if (dot < 0.99998) { // arista larga: se subdivide por el gran círculo, como hace d3
          const w = Math.acos(Math.max(-1, dot)); if (w > 3) return false;
          const m = Math.ceil(w / 0.0063), sw = Math.sin(w);
          for (let t = 1; t < m; t++) {
            const f = t / m, a = Math.sin((1 - f) * w) / sw, b = Math.sin(f * w) / sw;
            const q0 = a * pu0 + b * u0, q1 = a * pu1 + b * u1, q2 = a * pu2 + b * u2;
            if (!put(q0 * cl - q1 * sl, q0 * sl + q1 * cl, q2)) return false;
          }
        }
      }
      if (!put(u0 * cl - u1 * sl, u0 * sl + u1 * cl, u2, j === n - 1)) return false;
      pu0 = u0; pu1 = u1; pu2 = u2;
    }
    if (close && have) p2.closePath();
    return true;
  };
  const visV = (f, V, r) => { const v = f.v || (f.v = unit(f.c)); return f.rad + r >= Math.PI || V[0] * v[0] + V[1] * v[1] + V[2] * v[2] > Math.cos(f.rad + r); };
  const vis = (f, c, r) => d3.geoDistance(f.c, c) - f.rad < r;

  // ---------- province vs locality ----------
  // Capital districts are a city that the map treats as a first-level unit: we treat them as the
  // locality and colour the province around them.
  const DISTRICTS = { p1745: 'p1725', p4211: 'p4199', p3781: 'p3785', p3216: 'p1898', p1811: 'p1810', p743: 'p742' };
  const locCache = new WeakMap();
  const hasLocality = (p) => !!(p.locality_geo && p.city && (!p.locality_for || norm(p.locality_for) === norm(p.city)));
  // what to paint for a streamer up close: the province (full, or soft when the locality is painted too) and the locality
  const regionsOf = (p, set) => {
    let prov = p.province_id, loc = null;
    if (hasLocality(p)) {
      loc = locCache.get(p);
      if (loc === undefined) { try { loc = prep({ type: 'Feature', properties: {}, geometry: JSON.parse(JSON.stringify(p.locality_geo)) }); } catch { loc = null; } locCache.set(p, loc); }
    }
    if (DISTRICTS[prov]) { if (!loc) loc = (set.provById && set.provById.get(prov)) || null; prov = DISTRICTS[prov]; }
    return { prov, loc };
  };
  const provinceLabel = (p) => {
    const parent = DISTRICTS[p.province_id];
    const f = parent && G && G.provById && G.provById.get(parent);
    return f ? f.properties.name : p.province;
  };

  // paint the flat world map (equirectangular) that gets wrapped on the sphere
  const paintBase = (set, TW) => {
      const TH = TW / 2;
      const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
      const g = cv.getContext('2d');
      const eq = d3.geoEquirectangular().scale(TW / (2 * Math.PI)).translate([TW / 2, TH / 2]).precision(0.3);
      const p = d3.geoPath(eq, g);
      const px = TW / 8192; // line widths scale with texture size
      const land = () => { g.beginPath(); for (const f of set.countries) p(f); };
      // low-resolution helper canvas: anything drawn there and scaled up comes out soft
      const SW = Math.round(TW / 8), SH = Math.round(TH / 8);
      const soft = document.createElement('canvas'); soft.width = SW; soft.height = SH;
      const sg = soft.getContext('2d');
      const sp = d3.geoPath(d3.geoEquirectangular().scale(SW / (2 * Math.PI)).translate([SW / 2, SH / 2]).precision(0.5), sg);
      const sland = () => { sg.beginPath(); for (const f of set.countries) sp(f); };
      // ocean: aged blue-green paper with stains
      g.fillStyle = colors.a; g.fillRect(0, 0, TW, TH);
      for (const [a, sc] of [[0.7, 4], [0.6, 11]]) { g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = a; g.fillStyle = g.createPattern(stains, 'repeat'); g.setTransform(px * sc, 0, 0, px * sc, 0, 0); g.fillRect(0, 0, TW / (px * sc), TH / (px * sc)); g.restore(); }
      // darker water toward the poles
      const pg = g.createLinearGradient(0, 0, 0, TH);
      pg.addColorStop(0, colors.b); pg.addColorStop(0.22, 'rgba(0,0,0,0)'); pg.addColorStop(0.78, 'rgba(0,0,0,0)'); pg.addColorStop(1, colors.b);
      g.fillStyle = pg; g.fillRect(0, 0, TW, TH);
      g.beginPath(); p(graticule); g.strokeStyle = colors.grid; g.globalAlpha = 0.14; g.lineWidth = 2 * px; g.setLineDash([14 * px, 10 * px]); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      // soft shadow of the coast in the water
      sg.clearRect(0, 0, SW, SH); sland(); sg.lineJoin = 'round'; sg.strokeStyle = colors.ripple; sg.lineWidth = 6; sg.stroke(); sg.fillStyle = colors.ripple; sg.fill();
      g.save(); g.globalAlpha = 0.28; g.imageSmoothingQuality = 'high'; g.drawImage(soft, 0, 0, TW, TH); g.restore();
      // ink ripple lines following the coast, out in the water (drawn on their own layer, then laid on top)
      const RW = Math.round(TW / 2), RH = Math.round(TH / 2), rs = RW / TW;
      const rip = document.createElement('canvas'); rip.width = RW; rip.height = RH;
      const rg = rip.getContext('2d');
      const rp = d3.geoPath(d3.geoEquirectangular().scale(RW / (2 * Math.PI)).translate([RW / 2, RH / 2]).precision(0.4), rg);
      const rland = () => { rg.beginPath(); for (const f of set.countries) rp(f); };
      for (const [w, a] of [[16, 0.85], [32, 0.6], [52, 0.35], [76, 0.18]]) {
        const ring = document.createElement('canvas'); ring.width = RW; ring.height = RH;
        const q = ring.getContext('2d'); const qp = d3.geoPath(d3.geoEquirectangular().scale(RW / (2 * Math.PI)).translate([RW / 2, RH / 2]).precision(0.4), q);
        q.beginPath(); for (const f of set.countries) qp(f);
        q.lineJoin = 'round'; q.strokeStyle = colors.ripple; q.lineWidth = w * px * rs * 2; q.stroke();
        q.globalCompositeOperation = 'destination-out'; q.lineWidth = Math.max(0, (w * px * 2 - 4.5 * px) * rs); q.stroke();
        rg.globalAlpha = a; rg.drawImage(ring, 0, 0); rg.globalAlpha = 1;
      }
      rland(); rg.globalCompositeOperation = 'destination-out'; rg.fill(); rg.globalCompositeOperation = 'source-over';
      g.imageSmoothingQuality = 'high'; g.drawImage(rip, 0, 0, TW, TH);
      wmFlat(g, TW, TH);
      // land: golden parchment, mottled
      land(); g.fillStyle = colors.land; g.fill();
      g.save(); land(); g.clip();
      g.globalCompositeOperation = 'multiply'; g.fillStyle = g.createPattern(stains, 'repeat');
      for (const [a, sc] of [[0.8, 3], [0.7, 9]]) { g.globalAlpha = a; g.setTransform(px * sc, 0, 0, px * sc, 0, 0); g.fillRect(0, 0, TW / (px * sc), TH / (px * sc)); }
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
      // burnt edges: darker toward the coast
      sg.clearRect(0, 0, SW, SH); sg.beginPath(); for (const f of set.coast) sp(f); sg.strokeStyle = colors.edge; sg.lineWidth = 4; sg.lineJoin = 'round'; sg.stroke();
      g.globalAlpha = 0.8; g.drawImage(soft, 0, 0, TW, TH); g.globalAlpha = 1;
      g.restore();
      // land borders: dashed ink; coastline: solid ink
      g.beginPath(); for (const f of set.border) p(f); g.strokeStyle = colors.border; g.lineWidth = 2.6 * px; g.setLineDash([10 * px, 7 * px]); g.lineJoin = 'round'; g.stroke(); g.setLineDash([]);
      g.beginPath(); for (const f of set.coast) p(f); g.strokeStyle = colors.line; g.lineWidth = 3.6 * px; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
      return cv;
  };

  // ---------- GPU globe ----------
  // Far away, the whole map is painted once into a world texture and the graphics card wraps it
  // around the sphere every frame (exact coastlines, no per-frame geometry). Up close we switch to
  // vector drawing, which is cheap there because only a small piece of the world is visible.
  const GL = (() => {
    if (!glCanvas) return null;
    const gl = glCanvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, premultipliedAlpha: true, alpha: true, powerPreference: 'high-performance' });
    if (!gl) return null;
    const vs = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
    const fs = `#version 300 es
precision highp float;
uniform sampler2D tex; uniform sampler2D mask; uniform sampler2D grain; uniform vec3 hi; uniform vec2 res; uniform vec3 view; uniform vec2 rot; uniform float dpr;
out vec4 o;
void main(){
  vec2 px = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) / dpr;
  float x = (px.x - view.x) / view.z, y = (view.y - px.y) / view.z;
  float r2 = x*x + y*y;
  float edge = 1.5 / view.z;
  if (r2 > (1.0 + edge) * (1.0 + edge)) discard;
  float z = sqrt(max(0.0, 1.0 - r2));
  float X = z, Y = x, Z = y;
  float cb = cos(rot.y), sb = sin(rot.y);
  float lon = atan(Y, X*cb + Z*sb) - rot.x;
  float lat = asin(clamp(Z*cb - X*sb, -1.0, 1.0));
  float u = lon / 6.283185307 + 0.5;
  float v = 0.5 - lat / 3.141592654;
  vec2 uv = vec2(fract(u), v), uv2 = vec2(fract(u + 0.5) - 0.5, v);
  vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (abs(dx.x) + abs(dy.x) > abs(dx2.x) + abs(dy2.x)) { dx = dx2; dy = dy2; }
  vec4 c = textureGrad(tex, uv, dx, dy);
  float m = textureGrad(mask, uv, dx, dy).a;
  c.rgb = mix(c.rgb, c.rgb * hi, m * 0.6);
  float shade = 0.82 + 0.18 * z;
  float a = clamp((1.0 - sqrt(r2)) / edge + 0.5, 0.0, 1.0);
  vec3 gr = texture(grain, px / 380.0).rgb;
  o = vec4(c.rgb * shade * (1.0 - 0.32 * (1.0 - gr)), 1.0) * a;
}`;
    const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    let prog;
    try { prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog)); }
    catch (e) { console.warn('WebGL off:', e); return null; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n);
    const u = { tex: U('tex'), mask: U('mask'), grain: U('grain'), hi: U('hi'), res: U('res'), view: U('view'), rot: U('rot'), dpr: U('dpr') };
    const tex = gl.createTexture();
    const maxT = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const small = Math.min(screen.width, screen.height) < 820 || (navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches);
    const TW = Math.min(small ? 4096 : 8192, maxT), TH = TW / 2;
    let ready = false;
    const upload = (cv) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      ready = true;
    };
    // the painted world (baked image, or painted here as a fallback) and a mask of highlighted countries
    const MW = 2048, MH = 1024;
    const mtex = gl.createTexture();
    const gtex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, gtex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stains);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const setTex = (t, src, mip) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext && mip) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    };
    let maskReady = false;
    const paintMask = (set, onCodes) => {
      const cv = document.createElement('canvas'); cv.width = MW; cv.height = MH;
      const g = cv.getContext('2d');
      const p = d3.geoPath(d3.geoEquirectangular().scale(MW / (2 * Math.PI)).translate([MW / 2, MH / 2]).precision(0.5), g);
      g.beginPath(); for (const f of set.countries) if (onCodes.has(f.properties.code)) p(f);
      g.fillStyle = '#fff'; g.fill();
      setTex(mtex, cv, false); maskReady = true;
    };
    let baseState = 'none'; // none → loading → ready | failed
    const loadBase = () => {
      if (baseState !== 'none') return;
      baseState = 'loading';
      const img = new Image();
      img.onload = () => { upload(img); baseState = 'ready'; schedule(); };
      img.onerror = () => { baseState = 'failed'; schedule(); };
      img.src = `map-${TW}.webp?v=${ASSET_V}`;
    };
    const paintFallback = (set) => { upload(paintBase(set, TW)); baseState = 'ready'; };
    const render = () => {
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!ready || !maskReady) return false;
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.tex, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mtex); gl.uniform1i(u.mask, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, gtex); gl.uniform1i(u.grain, 2);
      const hc = d3.color(colors.hi) || d3.rgb(138, 34, 50); gl.uniform3f(u.hi, hc.r / 255, hc.g / 255, hc.b / 255);
      gl.uniform2f(u.res, glCanvas.width, glCanvas.height);
      gl.uniform3f(u.view, W / 2, H / 2, R * S.k);
      gl.uniform2f(u.rot, S.rot[0] * Math.PI / 180, S.rot[1] * Math.PI / 180);
      gl.uniform1f(u.dpr, glCanvas.width / W);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    };
    const clear = () => { gl.viewport(0, 0, glCanvas.width, glCanvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); };
    // vista provincias en movimiento: la foto del mapa (pintada una vez, más grande que la pantalla) se recoloca sobre la esfera píxel a píxel con la rotación actual.
    // Es la proyección exacta (sin deformar), así que el mapa se ve igual pero sin repintar países, provincias y texturas en cada imagen
    const rfs = `#version 300 es
precision highp float;
uniform sampler2D snap; uniform vec2 res; uniform vec3 view; uniform vec2 rot; uniform float dpr;
uniform vec3 view0; uniform vec2 rot0; uniform vec2 size0;
out vec4 o;
void main(){
  vec2 px = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) / dpr;
  float x = (px.x - view.x) / view.z, y = (view.y - px.y) / view.z;
  float r2 = x*x + y*y;
  if (r2 > 1.0) discard;
  float X = sqrt(1.0 - r2), Y = x, Z = y;
  float cb = cos(rot.y), sb = sin(rot.y);
  float Xw = X*cb + Z*sb, Zw = Z*cb - X*sb;
  float lon = atan(Y, Xw) - rot.x;
  float l2 = lon + rot0.x, cl = sqrt(max(0.0, 1.0 - Zw*Zw));
  float Xa = cl * cos(l2), Ya = cl * sin(l2);
  float c0 = cos(rot0.y), s0 = sin(rot0.y);
  float X0 = Xa*c0 - Zw*s0, Z0 = Xa*s0 + Zw*c0;
  if (X0 < 0.0) discard;
  vec2 q = vec2(view0.x + Ya * view0.z, view0.y - Z0 * view0.z) / size0;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) discard;
  o = texture(snap, q);
}`;
    let rprog = null, ru = null;
    let stex = gl.createTexture(), stexB = gl.createTexture();
    try {
      rprog = gl.createProgram(); gl.attachShader(rprog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(rprog, sh(gl.FRAGMENT_SHADER, rfs)); gl.bindAttribLocation(rprog, loc, 'p'); gl.linkProgram(rprog);
      if (!gl.getProgramParameter(rprog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(rprog));
      const RU = (n) => gl.getUniformLocation(rprog, n);
      ru = { snap: RU('snap'), res: RU('res'), view: RU('view'), rot: RU('rot'), dpr: RU('dpr'), view0: RU('view0'), rot0: RU('rot0'), size0: RU('size0') };
    } catch (e) { console.warn('Reproyección off:', e); rprog = null; }
    let snapInfo = null;
    // la foto siguiente se prepara a trozos en una segunda textura (una franja por imagen) y se cambia por la actual cuando está completa: nunca un parón
    const snapBegin = (w, h) => {
      gl.bindTexture(gl.TEXTURE_2D, stexB);
      if (stexB._w !== w || stexB._h !== h) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        stexB._w = w; stexB._h = h;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    };
    const snapBand = (cv, y, h) => {
      gl.bindTexture(gl.TEXTURE_2D, stexB);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, cv.width, h, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    };
    const snapSwap = (info) => { const t = stex; stex = stexB; stexB = t; snapInfo = info; };
    const reproject = () => {
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(rprog);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, stex); gl.uniform1i(ru.snap, 3);
      gl.uniform2f(ru.res, glCanvas.width, glCanvas.height);
      gl.uniform3f(ru.view, W / 2, H / 2, R * S.k);
      gl.uniform2f(ru.rot, S.rot[0] * Math.PI / 180, S.rot[1] * Math.PI / 180);
      gl.uniform1f(ru.dpr, glCanvas.width / W);
      const i = snapInfo;
      gl.uniform3f(ru.view0, i.cx, i.cy, i.s);
      gl.uniform2f(ru.rot0, i.rot[0] * Math.PI / 180, i.rot[1] * Math.PI / 180);
      gl.uniform2f(ru.size0, i.tw, i.th);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(prog);
    };
    return { gl, sh, gtex, loadBase, paintFallback, paintMask, render, clear, canSnap: () => !!rprog, snapBegin, snapBand, snapSwap, snap: () => snapInfo, dropSnap: () => { snapInfo = null; }, reproject, maxT, base: () => baseState, ready: () => ready && maskReady, maxK: TW / (2 * Math.PI * 280) / 1.1 };
  })();
  // ---------- mapa de cerca en la tarjeta gráfica ----------
  // Como los mapas profesionales (Mapbox, Google Earth): la tierra se convierte una sola vez en triángulos sobre la esfera y
  // las costas, fronteras y provincias en tramos, y todo se guarda en la tarjeta gráfica. En cada imagen solo cambian el giro
  // y el zoom: el procesador no recalcula ni repinta nada, así que acercar, alejar y arrastrar cuestan lo mismo a cualquier zoom.
  const VG = (() => {
    if (!GL || typeof earcut !== 'function') return null;
    const gl = GL.gl, sh = GL.sh;
    const D2R = Math.PI / 180;
    const prog = (vsrc, fsrc) => {
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vsrc)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsrc)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    };
    const H = '#version 300 es\nprecision highp float;\n';
    // tramo de línea: un rectángulo alrededor del segmento proyectado; el píxel mide su distancia al segmento (bordes suaves y uniones redondas)
    const lineVS = H + `layout(location=0) in vec3 a; layout(location=1) in vec3 b; layout(location=2) in vec2 dd;
uniform mat3 M; uniform vec3 view; uniform vec2 res; uniform float hw;
out vec2 P; flat out vec2 A; flat out vec2 B; flat out vec2 D;
void main(){
  vec3 ra = M * a, rb = M * b;
  if (ra.x < 0.0 || rb.x < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 pa = view.xy + view.z * vec2(ra.y, -ra.z), pb = view.xy + view.z * vec2(rb.y, -rb.z);
  vec2 t = pb - pa; float L = length(t); vec2 dir = L > 1e-4 ? t / L : vec2(1.0, 0.0), nr = vec2(-dir.y, dir.x);
  float sx = (gl_VertexID & 1) == 0 ? -1.0 : 1.0, sy = gl_VertexID < 2 ? -1.0 : 1.0;
  vec2 p = (sx < 0.0 ? pa : pb) + dir * hw * sx + nr * hw * sy;
  P = p; A = pa; B = pb; D = dd;
  gl_Position = vec4(p.x / res.x * 2.0 - 1.0, 1.0 - p.y / res.y * 2.0, 0.0, 1.0);
}`;
    // cada canal guarda la cobertura de un grosor (o de una capa); al sumar tramos se queda el máximo, como un trazo de verdad
    const lineFS = H + `in vec2 P; flat in vec2 A; flat in vec2 B; flat in vec2 D;
uniform vec4 hw4; uniform vec3 dash;
out vec4 o;
void main(){
  vec2 ab = B - A; float l2 = dot(ab, ab);
  float t = l2 > 1e-8 ? clamp(dot(P - A, ab) / l2, 0.0, 1.0) : 0.0;
  float d = length(P - A - ab * t);
  vec4 c = clamp(hw4 + 0.5 - d, 0.0, 1.0) * min(vec4(1.0), 2.0 * hw4);
  if (dash.y > 0.0) { float u = mod(mix(D.x, D.y, t) * dash.z, dash.y); c *= clamp(min(u, dash.x - u) + 0.5, 0.0, 1.0); }
  o = c;
}`;
    const triVS = H + `layout(location=0) in vec3 a; layout(location=1) in float w;
uniform mat3 M; uniform vec3 view; uniform vec2 res;
out float z; out float wt;
void main(){
  vec3 r = M * a; z = r.x; wt = w;
  vec2 p = view.xy + view.z * vec2(r.y, -r.z);
  gl_Position = vec4(p.x / res.x * 2.0 - 1.0, 1.0 - p.y / res.y * 2.0, 0.0, 1.0);
}`;
    // tierra: color, manchas del pergamino y su borde interior más oscuro (solo encima de la tierra)
    const landFS = H + `in float z; in float wt;
uniform sampler2D grain; uniform sampler2D L1; uniform vec2 res; uniform float dpr; uniform vec2 anc; uniform vec3 land; uniform vec4 edge;
out vec4 o;
void main(){
  if (z < 0.0) discard;
  vec2 px = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) / dpr;
  vec3 c = land * mix(vec3(1.0), texture(grain, (px - anc) / 512.0).rgb, 0.75);
  vec4 l = texelFetch(L1, ivec2(gl_FragCoord.xy), 0);
  c = mix(c, edge.rgb, edge.a * 0.22 * l.b); c = mix(c, edge.rgb, edge.a * 0.3 * l.g);
  o = vec4(c, 1.0);
}`;
    // lugares con streamers: se multiplica por el color vino (como 'multiply' del lienzo)
    const washFS = H + `in float z; in float wt;
uniform vec3 hi;
out vec4 o;
void main(){ if (z < 0.0) discard; o = vec4(mix(vec3(1.0), hi, wt), 1.0); }`;
    const fullVS = H + 'layout(location=0) in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
    // agua: degradado del disco (el mismo que createRadialGradient), manchas, cuadrícula y las ondas de la costa
    const waterFS = H + `uniform sampler2D grain; uniform sampler2D L1; uniform vec2 res; uniform float dpr; uniform vec3 view; uniform vec2 anc;
uniform vec3 ca; uniform vec3 cb; uniform vec4 grid; uniform vec4 ripple;
out vec4 o;
void main(){
  vec2 px = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) / dpr;
  float s = view.z, cov = clamp((s - length(px - view.xy)) * dpr + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  vec2 c0 = view.xy - vec2(0.35, 0.4) * s, dc = view.xy - c0, q = px - c0;
  float r0 = 0.1 * s, dr = 0.9 * s;
  float A = dot(dc, dc) - dr * dr, Bq = dot(q, dc) + r0 * dr, C = dot(q, q) - r0 * r0;
  float t = clamp((Bq - sqrt(max(0.0, Bq * Bq - A * C))) / A, 0.0, 1.0);
  vec3 c = mix(ca, cb, t) * mix(vec3(1.0), texture(grain, (px - anc) / (1.2 * 512.0)).rgb, 0.5);
  vec4 l = texelFetch(L1, ivec2(gl_FragCoord.xy), 0);
  c = mix(c, grid.rgb, grid.a * 0.3 * l.a);
  c = mix(c, ripple.rgb, ripple.a * 0.16 * l.r); c = mix(c, ripple.rgb, ripple.a * 0.22 * l.g);
  o = vec4(c, 1.0) * cov;
}`;
    // tinta encima: provincias, localidades, fronteras y costa
    const inkFS = H + `uniform sampler2D L2; uniform vec4 cprov; uniform vec4 cloc; uniform vec4 cbord; uniform vec4 cline;
out vec4 o;
vec4 over(vec4 d, vec4 c, float k){ vec4 s = vec4(c.rgb, 1.0) * (c.a * k); return s + d * (1.0 - s.a); }
void main(){
  vec4 l = texelFetch(L2, ivec2(gl_FragCoord.xy), 0);
  if (l.r + l.g + l.b + l.a <= 0.0) discard;
  vec4 c = vec4(0.0);
  c = over(c, cprov, l.g); c = over(c, cloc, l.b); c = over(c, cbord, l.r); c = over(c, cline, l.a);
  o = c;
}`;
    // grano del papel sobre todo el disco
    const grainFS = H + `uniform sampler2D grain; uniform vec2 res; uniform float dpr; uniform vec3 view; uniform vec2 anc;
out vec4 o;
void main(){
  vec2 px = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) / dpr;
  float cov = clamp((view.z - length(px - view.xy)) * dpr + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  o = vec4(mix(vec3(1.0), texture(grain, (px - anc) / 380.0).rgb, 0.32 * cov), 1.0);
}`;
    let P;
    try { P = { line: prog(lineVS, lineFS), land: prog(triVS, landFS), wash: prog(triVS, washFS), water: prog(fullVS, waterFS), ink: prog(fullVS, inkFS), grain: prog(fullVS, grainFS) }; }
    catch (e) { console.warn('Mapa en la tarjeta gráfica off:', e); return null; }
    const fullVao = gl.createVertexArray(); gl.bindVertexArray(fullVao);
    const fb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, fb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // ---- geometría (una vez por mapa) ----
    const u3 = (lon, lat, o) => { const l = lon * D2R, f = lat * D2R, c = Math.cos(f); o.push(c * Math.cos(l), c * Math.sin(l), Math.sin(f)); };
    const elen = (a0, a1, b0, b1) => Math.hypot((b0 - a0) * Math.cos((a1 + b1) * D2R / 2), b1 - a1);
    const TRI_MAX = 1.5, SEG_MAX = 1;
    // triángulo en lon/lat → triángulos pequeños sobre la esfera; cada arista se parte siempre por el mismo sitio, así no quedan grietas entre vecinos
    const subTri = (ax, ay, bx, by, cx, cy, out, depth) => {
      const sab = elen(ax, ay, bx, by) > TRI_MAX, sbc = elen(bx, by, cx, cy) > TRI_MAX, sca = elen(cx, cy, ax, ay) > TRI_MAX;
      if (depth > 10 || !(sab || sbc || sca)) { u3(ax, ay, out); u3(bx, by, out); u3(cx, cy, out); return; }
      const d = depth + 1, mx = (ax + bx) / 2, my = (ay + by) / 2, nx = (bx + cx) / 2, ny = (by + cy) / 2, kx = (cx + ax) / 2, ky = (cy + ay) / 2;
      if (sab && sbc && sca) { subTri(ax, ay, mx, my, kx, ky, out, d); subTri(mx, my, bx, by, nx, ny, out, d); subTri(kx, ky, nx, ny, cx, cy, out, d); subTri(mx, my, nx, ny, kx, ky, out, d); }
      else if (sab && sbc) { subTri(mx, my, bx, by, nx, ny, out, d); subTri(ax, ay, mx, my, nx, ny, out, d); subTri(ax, ay, nx, ny, cx, cy, out, d); }
      else if (sab && sca) { subTri(ax, ay, mx, my, kx, ky, out, d); subTri(mx, my, bx, by, cx, cy, out, d); subTri(mx, my, cx, cy, kx, ky, out, d); }
      else if (sbc && sca) { subTri(cx, cy, kx, ky, nx, ny, out, d); subTri(kx, ky, ax, ay, bx, by, out, d); subTri(kx, ky, bx, by, nx, ny, out, d); }
      else if (sab) { subTri(ax, ay, mx, my, cx, cy, out, d); subTri(mx, my, bx, by, cx, cy, out, d); }
      else if (sbc) { subTri(ax, ay, bx, by, nx, ny, out, d); subTri(ax, ay, nx, ny, cx, cy, out, d); }
      else { subTri(ax, ay, bx, by, kx, ky, out, d); subTri(kx, ky, bx, by, cx, cy, out, d); }
    };
    // polígono (con huecos) → triángulos; las longitudes se desenrollan para que nada salte de -180 a 180, y un anillo que rodea un polo se cierra por el polo
    const triPoly = (rings, out) => {
      const flat = [], holes = []; let ref = null;
      rings.forEach((ring, ri) => {
        let n = ring.length;
        if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) n--;
        if (n < 3) return;
        if (ri) holes.push(flat.length / 2);
        const start = flat.length; let prev = null, sl = 0;
        for (let i = 0; i < n; i++) {
          let lon = ring[i][0]; const lat = ring[i][1], base = prev === null ? ref : prev;
          if (base !== null) { while (lon - base > 180) lon -= 360; while (lon - base < -180) lon += 360; }
          if (ref === null) ref = lon;
          prev = lon; sl += lat; flat.push(lon, lat);
        }
        const dl = flat[flat.length - 2] - flat[start];
        if (Math.abs(dl) > 180) { const pole = sl > 0 ? 90 : -90; flat.push(flat[flat.length - 2], pole, flat[start], pole); }
      });
      if (flat.length < 6) return;
      const idx = earcut(flat, holes.length ? holes : null, 2);
      for (let i = 0; i < idx.length; i += 3) { const a = idx[i] * 2, b = idx[i + 1] * 2, c = idx[i + 2] * 2; subTri(flat[a], flat[a + 1], flat[b], flat[b + 1], flat[c], flat[c + 1], out, 0); }
    };
    const triGeom = (g, out) => { if (!g) return; if (g.type === 'Polygon') triPoly(g.coordinates, out); else if (g.type === 'MultiPolygon') for (const pl of g.coordinates) triPoly(pl, out); };
    // línea → tramos cortos sobre la esfera, cada uno con la distancia recorrida (los guiones quedan fijos al mapa)
    const addLine = (pts, out) => {
      if (!pts || pts.length < 2) return;
      let px = pts[0][0], py = pts[0][1], d = 0, pu = []; u3(px, py, pu);
      for (let i = 1; i < pts.length; i++) {
        let x = pts[i][0]; const y = pts[i][1];
        while (x - px > 180) x -= 360; while (x - px < -180) x += 360;
        const m = Math.max(1, Math.ceil(elen(px, py, x, y) / SEG_MAX));
        for (let t = 1; t <= m; t++) {
          const q = []; u3(px + (x - px) * t / m, py + (y - py) * t / m, q);
          const w = 2 * Math.asin(Math.min(1, Math.hypot(q[0] - pu[0], q[1] - pu[1], q[2] - pu[2]) / 2));
          out.push(pu[0], pu[1], pu[2], q[0], q[1], q[2], d, d + w); d += w; pu = q;
        }
        px = x; py = y;
      }
    };
    const ringsOf = (g, fn) => { if (!g) return; if (g.type === 'Polygon') g.coordinates.forEach(fn); else if (g.type === 'MultiPolygon') for (const pl of g.coordinates) pl.forEach(fn); };
    const lineVao = (arr) => {
      const vao = gl.createVertexArray(), buf = gl.createBuffer();
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      for (const [i, n, off] of [[0, 3, 0], [1, 3, 12], [2, 2, 24]]) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, 32, off); gl.vertexAttribDivisor(i, 1); }
      gl.bindVertexArray(null);
      return { vao, buf, n: arr.length / 8 };
    };
    const triVao = (pos, wts) => {
      const vao = gl.createVertexArray(), buf = gl.createBuffer();
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      let wb = null;
      if (wts) { wb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, wb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wts), gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0); }
      gl.bindVertexArray(null);
      return { vao, buf, wb, n: pos.length / 3 };
    };
    const drop = (x) => { if (!x) return; gl.deleteVertexArray(x.vao); gl.deleteBuffer(x.buf); if (x.wb) gl.deleteBuffer(x.wb); };
    // cuadrícula cada 10° (como d3.geoGraticule10)
    const grat = (() => {
      const out = [];
      for (let lon = -180; lon < 180; lon += 10) { const ext = lon % 90 === 0 ? 90 : 80, pts = []; for (let lat = -ext; lat <= ext; lat += 1) pts.push([lon, lat]); addLine(pts, out); }
      for (let lat = -80; lat <= 80; lat += 10) { const pts = []; for (let lon = -180; lon <= 180; lon += 1) pts.push([lon, lat]); addLine(pts, out); }
      return lineVao(out);
    })();
    // se prepara a trozos (unos milisegundos por vez) para no frenar la página mientras carga
    const jobs = new WeakMap();
    const prepare = (set) => {
      if (!set || jobs.has(set)) return;
      const job = { ready: false }; jobs.set(set, job);
      const land = [], coast = [], border = [], prov = [], tasks = [];
      for (const f of set.parts) tasks.push(() => triGeom(f.geometry, land));
      for (const f of set.coast) tasks.push(() => addLine(f.geometry.coordinates, coast));
      for (const f of set.border) tasks.push(() => addLine(f.geometry.coordinates, border));
      for (const a of set.parcs || []) tasks.push(() => addLine(a, prov));
      let i = 0;
      const run = () => {
        const t0 = performance.now();
        while (i < tasks.length && performance.now() - t0 < 6) tasks[i++]();
        if (i < tasks.length) { setTimeout(run, 0); return; }
        Object.assign(job, { land: triVao(land, null), coast: lineVao(coast), border: lineVao(border), prov: lineVao(prov), ready: true });
        schedule();
      };
      setTimeout(run, 0);
    };
    // lugares pintados (cambian solo cuando cambian los streamers)
    let wash = null;
    const setWash = (set, people) => {
      const key = people.map((p) => p.country_code + '/' + p.province_id + '/' + (hasLocality(p) ? p.twitch : '')).join(',');
      if (wash && wash.set === set && wash.key === key) return;
      const full = new Set(), half = new Set(), locs = [], cFull = new Set(), cHalf = new Set();
      for (const p of people) {
        const g = regionsOf(p, set);
        if (g.loc) locs.push(g.loc);
        if (g.prov) (g.loc ? half : full).add(g.prov);
        else (g.loc ? cHalf : cFull).add(p.country_code);
      }
      for (const id of full) half.delete(id);
      for (const id of cFull) cHalf.delete(id);
      const A = 0.6, pos = [], wts = [], ln = [];
      const add = (f, a) => { if (!f) return; const n0 = pos.length; triGeom(f.geometry, pos); for (let i = n0; i < pos.length; i += 3) wts.push(a); };
      for (const c of cFull) add(set.byCode.get(c), A);
      for (const c of cHalf) add(set.byCode.get(c), A / 2);
      for (const id of full) add(set.provById.get(id), A);
      for (const id of half) add(set.provById.get(id), A / 2);
      for (const f of locs) { add(f, A); ringsOf(f.geometry, (r) => addLine(r, ln)); }
      if (wash) { drop(wash.tri); drop(wash.loc); }
      wash = { set, key, tri: triVao(pos, wts), loc: lineVao(ln) };
    };

    // ---- capas de trabajo del tamaño de la pantalla ----
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    let tw = 0, th = 0;
    const L = [0, 1].map(() => ({ t: gl.createTexture(), f: gl.createFramebuffer() }));
    const ms = { r: gl.createRenderbuffer(), f: gl.createFramebuffer() };
    const fit = (w, h) => {
      if (w === tw && h === th) return;
      tw = w; th = h;
      for (const x of L) {
        gl.bindTexture(gl.TEXTURE_2D, x.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, x.f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, x.t, 0);
      }
      gl.bindRenderbuffer(gl.RENDERBUFFER, ms.r);
      if (samples > 1) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h); else gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, ms.f); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, ms.r);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    const rgba = (c) => { const x = d3.color(c) || d3.rgb(0, 0, 0); const r = x.rgb(); return [r.r / 255, r.g / 255, r.b / 255, Number.isFinite(r.opacity) ? r.opacity : 1]; };
    let cc = null, ccKey = null;

    const render = (o) => {
      const job = jobs.get(o.set);
      if (!job || !job.ready) return false;
      setWash(o.set, o.people);
      const ck = Object.values(colors).join();
      if (ccKey !== ck) { ccKey = ck; cc = {}; for (const k of Object.keys(colors)) cc[k] = rgba(colors[k]); }
      const w = glCanvas.width, h = glCanvas.height, dpr = w / o.W, s = o.sphereR * dpr;
      fit(w, h);
      const l = o.rot[0] * D2R, f = o.rot[1] * D2R, cl = Math.cos(l), sl = Math.sin(l), cf = Math.cos(f), sf = Math.sin(f);
      // filas: profundidad, x y y de pantalla (la misma cuenta que la proyección ortográfica de d3)
      const M = new Float32Array([cf * cl, sl, sf * cl, -cf * sl, cl, -sf * sl, -sf, 0, cf]);
      const view = [w / 2, h / 2, s];
      gl.viewport(0, 0, w, h);
      gl.enable(gl.BLEND);
      // 1) coberturas de las líneas (máximo por píxel)
      const lp = P.line; gl.useProgram(lp.p);
      gl.uniformMatrix3fv(lp.u.M, false, M); gl.uniform3f(lp.u.view, ...view); gl.uniform2f(lp.u.res, w, h);
      gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
      const lines = (x, hw4, on, per) => {
        if (!x || !x.n) return;
        gl.uniform4f(lp.u.hw4, ...hw4.map((v) => v * dpr)); gl.uniform1f(lp.u.hw, Math.max(...hw4) * dpr + 1.5);
        gl.uniform3f(lp.u.dash, on * dpr, per * dpr, s);
        gl.bindVertexArray(x.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, x.n);
      };
      gl.bindFramebuffer(gl.FRAMEBUFFER, L[0].f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      lines(job.coast, [9, 4, 11, 0], 0, 0);
      if (o.k < 6) lines(grat, [0, 0, 0, 0.3], 5, 9);
      gl.bindFramebuffer(gl.FRAMEBUFFER, L[1].f); gl.clear(gl.COLOR_BUFFER_BIT);
      lines(job.prov, [0, 0.4, 0, 0], 2, 5);
      lines(wash.loc, [0, 0, 0.7, 0], 0, 0);
      lines(job.border, [0.7, 0, 0, 0], 6, 10);
      lines(job.coast, [0, 0, 0, 0.9], 0, 0);
      gl.blendEquation(gl.FUNC_ADD);
      // 2) el mapa, con bordes suavizados (multimuestreo)
      gl.bindFramebuffer(gl.FRAMEBUFFER, ms.f); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, GL.gtex);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, L[0].t);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, L[1].t);
      const css = [o.W / 2, o.H / 2, o.sphereR];
      gl.disable(gl.BLEND);
      const wp = P.water; gl.useProgram(wp.p);
      gl.uniform1i(wp.u.grain, 2); gl.uniform1i(wp.u.L1, 4); gl.uniform2f(wp.u.res, w, h); gl.uniform1f(wp.u.dpr, dpr); gl.uniform3f(wp.u.view, ...css); gl.uniform2f(wp.u.anc, ...o.anc);
      gl.uniform3f(wp.u.ca, ...cc.a.slice(0, 3)); gl.uniform3f(wp.u.cb, ...cc.b.slice(0, 3)); gl.uniform4f(wp.u.grid, ...cc.grid); gl.uniform4f(wp.u.ripple, ...cc.ripple);
      gl.bindVertexArray(fullVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const tp = P.land; gl.useProgram(tp.p);
      gl.uniformMatrix3fv(tp.u.M, false, M); gl.uniform3f(tp.u.view, ...view); gl.uniform2f(tp.u.res, w, h);
      gl.uniform1i(tp.u.grain, 2); gl.uniform1i(tp.u.L1, 4); gl.uniform1f(tp.u.dpr, dpr); gl.uniform2f(tp.u.anc, ...o.anc);
      gl.uniform3f(tp.u.land, ...cc.land.slice(0, 3)); gl.uniform4f(tp.u.edge, ...cc.edge);
      gl.bindVertexArray(job.land.vao); gl.vertexAttrib1f(1, 0); gl.drawArrays(gl.TRIANGLES, 0, job.land.n);
      if (wash.tri.n) {
        gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
        const ap = P.wash; gl.useProgram(ap.p);
        gl.uniformMatrix3fv(ap.u.M, false, M); gl.uniform3f(ap.u.view, ...view); gl.uniform2f(ap.u.res, w, h); gl.uniform3f(ap.u.hi, ...cc.hi.slice(0, 3));
        gl.bindVertexArray(wash.tri.vao); gl.drawArrays(gl.TRIANGLES, 0, wash.tri.n);
      }
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const ip = P.ink; gl.useProgram(ip.p);
      gl.uniform1i(ip.u.L2, 5); gl.uniform4f(ip.u.cprov, ...cc.prov); gl.uniform4f(ip.u.cloc, ...cc.hi); gl.uniform4f(ip.u.cbord, ...cc.border); gl.uniform4f(ip.u.cline, ...cc.line);
      gl.bindVertexArray(fullVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
      const gp = P.grain; gl.useProgram(gp.p);
      gl.uniform1i(gp.u.grain, 2); gl.uniform2f(gp.u.res, w, h); gl.uniform1f(gp.u.dpr, dpr); gl.uniform3f(gp.u.view, ...css); gl.uniform2f(gp.u.anc, ...o.anc);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 3) a la pantalla
      gl.disable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ZERO); gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.f); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
      return true;
    };
    return { prepare, ready: (set) => !!set && !!(jobs.get(set) || {}).ready, render };
  })();
  let texDirty = true, texKey = '';
  const ensureTexture = () => {
    if (!GL || !G) return;
    GL.loadBase();
    if (GL.base() === 'failed' && G.hi) GL.paintFallback(G.hi); // no baked image: paint it here once
    const set = G.hi || G.lo;
    const codes = [...new Set(live().map((p) => p.country_code))].sort();
    const key = (G.hi ? 'hi' : 'lo') + codes.join(',');
    if (!texDirty && key === texKey) return;
    texDirty = false; texKey = key;
    GL.paintMask(set, new Set(codes));
  };
  if (/[?&]bake\b/.test(location.search)) window.__bake = (tw) => paintBase(G.hi, tw).toDataURL('image/webp', 0.92);
  // zoom level from which the vector map takes over (texture would start to look soft)
  const vectorFrom = () => Math.min(PROV_K, GL ? Math.max(2, GL.maxK) : 0);

  let moving = false, settleTimer = 0;
  const markMoving = () => { moving = true; clearTimeout(settleTimer); settleTimer = setTimeout(() => { moving = false; schedule(); }, 180); };
  const chipEl = $('chip');
  // la foto del mapa de cerca: se pinta en un lienzo aparte, un 30 % más grande por cada lado, y la tarjeta gráfica la recoloca al arrastrar
  // se pinta a franjas (SNAP_BANDS, una por imagen) en un lienzo pequeño y cada franja sube a la textura de reserva
  const SNAP_BANDS = 4;
  const bandCanvas = document.createElement('canvas'), bandCtx = bandCanvas.getContext('2d');
  let buildOnly = false, buildTimer = 0, build = null, paper = null, paintMemo = null;
  const buildSoon = () => {
    clearTimeout(buildTimer);
    buildTimer = setTimeout(function tick() {
      if (moving) return;
      if (raf) { buildTimer = setTimeout(tick, 16); return; }
      buildOnly = true; try { draw(); } finally { buildOnly = false; }
      if (build) buildTimer = setTimeout(tick, 16);
    }, 60);
  };
  const draw = () => {
    raf = 0;
    if (!G || !W) return;
    const setProj = () => projection.translate([W / 2, H / 2]).scale(R * S.k).rotate([S.rot[0], S.rot[1], 0]).clipExtent([[-4, -4], [W + 4, H + 4]]);
    setProj();
    const dpr = DPR();
    const provMode = S.k >= PROV_K;
    const people = live();
    if (GL && S.k < vectorFrom()) ensureTexture();
    const useGL = GL && S.k < vectorFrom() && GL.ready();
    let sphereR = R * S.k;
    // las manchas y el grano del papel van pegados al mapa (no a la pantalla): así la foto recolocada y el repintado final coinciden.
    // El ancla es un punto del globo; si queda muy lejos se cambia por el centro sin mover la textura
    const pa0 = paper && projection(paper.g);
    if (!pa0 || Math.hypot(pa0[0] - W / 2, pa0[1] - H / 2) > Math.max(W, H)) {
      const g = center(), p0 = projection(g), old = pa0 ? [pa0[0] + paper.sx, pa0[1] + paper.sy] : [0, 0];
      paper = { g, sx: old[0] - p0[0], sy: old[1] - p0[1] };
    }
    const paintMap = (sc = dpr, oy = 0) => {
    setProj();
    ctx.setTransform(sc, 0, 0, sc, 0, -oy * sc); ctx.clearRect(0, 0, W, H);
    const c = center(), r = reach();
    // ¿toda la ventana cae dentro del disco? entonces la proyección a mano es exacta (sin horizonte que recortar)
    const inside = Math.hypot(W, H) / 2 + 40 < sphereR * 0.97 && r < 1.3;
    const vector = (fast) => {
      const set = G.hi || G.lo, cset = set;
      const V = unit(c), cr = Math.cos(r), sr = Math.sin(r);
      const M = { cl: Math.cos(S.rot[0] * RAD), sl: Math.sin(S.rot[0] * RAD), cf: Math.cos(S.rot[1] * RAD), sf: Math.sin(S.rot[1] * RAD), s: sphereR, cx: W / 2, cy: H / 2 };
      let bad = false;
      // la foto se pinta por bandas: los trazados se calculan en la primera y las demás los reutilizan
      const mm = fast && paintMemo;
      if (mm && mm.bad) return false;
      const keep = (k, fn) => !mm ? fn() : k in mm ? mm[k] : (mm[k] = fn());
      const disk = new Path2D(); disk.arc(W / 2, H / 2, sphereR, 0, 2 * Math.PI);
      const grad = ctx.createRadialGradient(W / 2 - sphereR * 0.35, H / 2 - sphereR * 0.4, sphereR * 0.1, W / 2, H / 2, sphereR);
      grad.addColorStop(0, colors.a); grad.addColorStop(1, colors.b);
      ctx.fillStyle = grad; ctx.fill(disk);
      // manchas del pergamino: multiplicar directamente sobre la forma (sin recortes de pantalla completa)
      const stainPat = ctx.createPattern(stains, 'repeat');
      const pa = projection(paper.g), ax = pa[0] + paper.sx, ay = pa[1] + paper.sy;
      const stain = (alpha, scale, p2, g = ctx) => { g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = alpha; stainPat.setTransform(new DOMMatrix([scale, 0, 0, scale, ax, ay])); g.fillStyle = stainPat; g.fill(p2); g.restore(); };
      stain(0.5, 1.2, disk);
      if (!provMode) wmView(ctx, projection, c, disk); // en vista provincias no: de tan cerca se ve arrastrándose
      projection.clipExtent([[-4, -4], [W + 4, H + 4]]);
      if (S.k < 6) { ctx.beginPath(); path(graticule); ctx.strokeStyle = colors.grid; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.3; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      const vc = cset.parts.filter((f) => visV(f, V, r));
      const vb = cset.border.filter((f) => visV(f, V, r)), vk = cset.coast.filter((f) => visV(f, V, r));
      const gp = d3.geoPath(projection);
      // Path2D de polígonos recortados / de tramos de línea (rápido o con d3 según corresponda)
      const polysPath = (list) => {
        const p2 = new Path2D();
        if (fast) { for (const polys of list) for (const pl of polys) for (const sg of pl) if (!emitSeg(p2, sg, M, true)) { bad = true; return p2; } }
        else { gp.context(p2); for (const polys of list) gp(polyGeom(polys)); }
        return p2;
      };
      const linesPath = (runs) => {
        const p2 = new Path2D();
        if (fast) { for (const q of runs) if (!emitSeg(p2, q, M, false)) { bad = true; return p2; } }
        else { gp.context(p2); for (const q of runs) gp(lineGeom(q)); }
        return p2;
      };
      const { lands, landP, coastP } = keep('base', () => {
        const lands = vc.map((f) => ({ f, p: cullPoly(f.geometry, V, cr, sr) }));
        const coastRuns = []; for (const f of vk) cullLine(f.geometry.coordinates, V, cr, sr, coastRuns);
        return { lands, landP: polysPath(lands.map((x) => x.p)), coastP: linesPath(coastRuns) };
      });
      if (bad) { if (mm) mm.bad = true; return false; }
      // coast shadow in the water
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colors.ripple; ctx.globalAlpha = 0.16; ctx.lineWidth = 18; ctx.stroke(coastP);
      ctx.globalAlpha = 0.22; ctx.lineWidth = 8; ctx.stroke(coastP); ctx.globalAlpha = 1;
      // land
      // la tierra con su borde interior va en una capa aparte: el borde se pinta con 'source-atop' (solo encima de la tierra),
      // que da lo mismo que recortar con clip() pero sin su coste (clip() con un trazado tan grande multiplica el tiempo de dibujo)
      // una capa por lienzo (pantalla y foto): compartida se rehacía a cada cambio entre los dos, y eso da parones
      const cv = ctx.canvas, land = cv._land || (cv._land = document.createElement('canvas')), lc = land.getContext('2d');
      if (land.width !== cv.width || land.height !== cv.height) { land.width = cv.width; land.height = cv.height; }
      lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, cv.width, cv.height); lc.setTransform(ctx.getTransform());
      lc.fillStyle = colors.land; lc.fill(landP);
      stain(0.75, 1, landP, lc);
      lc.globalCompositeOperation = 'source-atop'; lc.strokeStyle = colors.edge; lc.lineJoin = 'round';
      lc.globalAlpha = 0.22; lc.lineWidth = 22; lc.stroke(coastP); lc.globalAlpha = 0.3; lc.lineWidth = 8; lc.stroke(coastP);
      lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(land, 0, 0); ctx.restore();
      // wine wash for the places with streamers
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = colors.hi;
      const A = 0.6;
      ctx.globalAlpha = A;
      // trazos discontinuos: cada tramo lleva su fase, así los guiones quedan fijos al mover el mapa
      const dashed = (key, runsOf, dash, color, width) => {
        const per = dash[0] + dash[1];
        const items = keep(key, () => {
          const out = [];
          if (!fast) projection.clipExtent(null);
          for (const q of runsOf()) {
            const p2 = new Path2D();
            if (fast) { if (!emitSeg(p2, q, M, false)) { bad = true; break; } } else { gp.context(p2); gp(lineGeom(q)); }
            out.push([p2, q.d]);
          }
          projection.clipExtent([[-4, -4], [W + 4, H + 4]]);
          return out;
        });
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.lineJoin = 'round';
        for (const [p2, d] of items) { ctx.lineDashOffset = (d * sphereR) % per; ctx.stroke(p2); }
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
      };
      let locP = null, vl = [];
      const wash = (cond) => polysPath(lands.filter((x) => cond(x.f.properties.code)).map((x) => x.p));
      if (!provMode) {
        const on = new Set(people.map((p) => p.country_code));
        ctx.fill(keep('w', () => wash((code) => on.has(code))));
        ctx.restore();
      } else {
        // province fully coloured; at half strength when the streamer's locality is coloured on top
        const pv = keep('prov', () => {
          const full = new Set(), half = new Set(), locs = [], cFull = new Set(), cHalf = new Set();
          for (const p of people) {
            const g = regionsOf(p, set);
            if (g.loc) locs.push(g.loc);
            if (g.prov) (g.loc ? half : full).add(g.prov);
            else (g.loc ? cHalf : cFull).add(p.country_code); // only the country was chosen
          }
          for (const id of full) half.delete(id);
          for (const id of cFull) cHalf.delete(id);
          const vp = [];
          for (const g of set.groups) if (d3.geoDistance(g.c, c) - g.rad < r) for (const f of g.fs) if (visV(f, V, r)) vp.push({ f, p: cullPoly(f.geometry, V, cr, sr) });
          const vl = locs.filter((f) => visV(f, V, r));
          return {
            vp, vl, cFull: wash((code) => cFull.has(code)), cHalf: wash((code) => cHalf.has(code)),
            full: polysPath(vp.filter((x) => full.has(x.f.properties.pid)).map((x) => x.p)),
            half: polysPath(vp.filter((x) => half.has(x.f.properties.pid)).map((x) => x.p)),
            locP: polysPath(vl.map((f) => cullPoly(f.geometry, V, cr, sr))),
          };
        });
        ctx.fill(pv.cFull);
        ctx.globalAlpha = A * 0.5;
        ctx.fill(pv.cHalf);
        ctx.globalAlpha = A;
        ctx.fill(pv.full);
        ctx.globalAlpha = A * 0.5;
        ctx.fill(pv.half);
        ctx.globalAlpha = A;
        vl = pv.vl; locP = pv.locP; ctx.fill(locP);
        ctx.restore();
        dashed('pr', () => { const provRuns = []; for (const x of pv.vp) for (const pl of x.p) for (const sg of pl) cullLine(sg.pts, V, cr, sr, provRuns); return provRuns; }, [2, 3], colors.prov, 0.8);
        if (vl.length) { ctx.strokeStyle = colors.hi; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.stroke(locP); }
      }
      if (bad) { if (mm) mm.bad = true; return false; }
      // land borders dashed, coastline in ink
      dashed('bd', () => { const borderRuns = []; for (const f of vb) cullLine(f.geometry.coordinates, V, cr, sr, borderRuns); return borderRuns; }, [6, 4], colors.border, provMode ? 1.4 : 1);
      ctx.strokeStyle = colors.line; ctx.lineWidth = provMode ? 1.8 : 1.3; ctx.lineCap = 'round'; ctx.stroke(coastP);
      // grano del papel
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.32; stainPat.setTransform(new DOMMatrix([380 / 512, 0, 0, 380 / 512, ax, ay])); ctx.fillStyle = stainPat; ctx.fill(disk); ctx.restore();
      if (bad && mm) mm.bad = true;
      return !bad;
    };
    if (!vector(inside)) { ctx.setTransform(sc, 0, 0, sc, 0, -oy * sc); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([]); ctx.clearRect(0, 0, W, H); vector(false); }
    };
    // ¿sirve la foto para la vista actual? (mismos datos, zoom parecido y su centro aún lejos del borde de la foto)
    const sdx = (glCanvas && glCanvas.width / W) || dpr;
    // margen de la foto: un 30 % por cada lado, pero sin pasar del borde de la Tierra (cerca del borde el mapa se calcula por el camino lento y tarda muchísimo)
    const marginFor = (s) => {
      const L = 2 * Math.min(0.97 * s - 44, 0.935 * s), a = W + H, q = a * a - 2 * (W * W + H * H - L * L);
      const room = q > 0 ? (-a + Math.sqrt(q)) / 4 : 0;
      return Math.max(0, Math.min(Math.max(W, H) * 0.3, room));
    };
    const snapSig = (G.hi ? 'h' : 'l') + (provMode ? 'p' : 'c') + people.length + '|' + W + 'x' + H + '|' + dpr + '|' + colors.hi;
    const snapDist = (i) => { const p = i && projection(i.c); return p ? Math.hypot(p[0] - W / 2, p[1] - H / 2) : Infinity; };
    // sirve si su zoom no se aleja mucho del actual: reducida se ve nítida y ampliada como mucho un 50 % (solo unas imágenes en pleno zoom, mientras se rehace)
    const fresh = (i) => !!i && i.sig === snapSig && sphereR / i.s >= 0.5 && sphereR / i.s <= 1.5 && covers(i);
    // la pantalla entera cae dentro de la foto (con su zoom y lo que se ha desplazado)
    function covers(i) { const r = sphereR / i.s, d = snapDist(i); return (W / 2 + d) / r <= W / 2 + 0.9 * i.m + 0.5 && (H / 2 + d) / r <= H / 2 + 0.9 * i.m + 0.5; }
    const exact = (i) => !!i && Math.abs(sphereR / i.s - 1) < 1e-4;
    const still = (i) => exact(i) && i.rot[0] === S.rot[0] && i.rot[1] === S.rot[1];
    // al acercar, la foto siguiente se pinta ya más cerca (adelantada al zoom), así se ve reducida y nítida
    const prevR = S._prevR, prevRot = S._prevRot || S.rot;
    if (!buildOnly) { S._prevR = sphereR; S._prevRot = S.rot.slice(); }
    const zooming = moving && !buildOnly && prevR !== undefined && Math.abs(sphereR - prevR) > 1e-6;
    const dRot = [S.rot[0] - prevRot[0], S.rot[1] - prevRot[1]];
    // imágenes que le quedan a la foto actual al ritmo de ahora: la siguiente se empieza a tiempo para estar lista antes
    // cuánto le queda a la foto (en píxeles) antes de dejar de servir, por desplazamiento o por zoom, y a cuántas imágenes está
    const headroom = (i) => {
      const r = sphereR / i.s, d = snapDist(i);
      return Math.min(W / 2 + 0.9 * i.m - (W / 2 + d) / r, H / 2 + 0.9 * i.m - (H / 2 + d) / r, (1.25 - r) * W, (r - 0.65) * W);
    };
    const framesLeft = (i) => { const h = headroom(i), q = i.hp; i.hp = h; return q === undefined || q <= h ? Infinity : h / (q - h); };
    // pintar dentro de la foto: otro tamaño, otra rotación y el mismo papel durante todas sus franjas
    const inSnap = (b, fn) => {
      const W0 = W, H0 = H, r0 = S.rot, k0 = S.k, s0 = sphereR, p0 = paper;
      W = b.info.w; H = b.info.h; S.rot = b.info.rot; S.k = b.info.s / R; sphereR = b.info.s; paper = b.paper; ctx = bandCtx; path.context(ctx); setProj();
      try { return fn(); } finally { W = W0; H = H0; S.rot = r0; S.k = k0; sphereR = s0; paper = p0; ctx = screenCtx; path.context(ctx); setProj(); }
    };
    // una franja de la foto nueva; al arrastrar se adelanta en la dirección del movimiento para durar más
    // con tope de vueltas: si algo no cuadra, mejor pintar directo que colgar la página
    const buildAll = () => { build = null; let n = SNAP_BANDS + 1; do buildStep(); while (build && --n > 0); };
    const buildStep = () => {
      if (!build || build.info.sig !== snapSig || sphereR / build.info.s < 0.6 || sphereR / build.info.s > 1.25) {
        const g = zooming ? sphereR / prevR : 1, s1 = sphereR * (g > 1 ? Math.min(1.45, g ** SNAP_BANDS / 0.75) : Math.max(0.85, g ** SNAP_BANDS));
        const snapPx = Math.round(marginFor(s1) * sdx);
        let sd = sdx, cw = glCanvas.width + 2 * snapPx, ch = glCanvas.height + 2 * snapPx;
        if (cw > GL.maxT || ch > GL.maxT) { const f = GL.maxT / Math.max(cw, ch); sd *= f; cw = Math.floor(cw * f); ch = Math.floor(ch * f); }
        // la textura y el lienzo de franjas se reservan una vez al tamaño máximo: rehacerlos a cada foto (decenas de MB) da parones
        const mx = Math.round(Math.max(W, H) * 0.3 * sdx), tw = Math.max(cw, Math.min(GL.maxT, glCanvas.width + 2 * mx)), th = Math.max(ch, Math.min(GL.maxT, glCanvas.height + 2 * mx));
        const sw = cw / sd, sh = ch / sd, m = snapPx / sdx, v = Math.hypot(dRot[0], dRot[1]) * RAD * sphereR;
        let rot = S.rot.slice();
        if (moving && v > 0.5) { const f = Math.min(0.8 * m, 0.55 * m + SNAP_BANDS * v) / v; rot = [rot[0] + dRot[0] * f, Math.max(-89, Math.min(89, rot[1] + dRot[1] * f))]; }
        const bh = Math.ceil(ch / SNAP_BANDS);
        build = { i: 0, sd, ch, bh, paper, memo: {}, info: { tw: tw / sd, th: th / sd, cx: sw / 2, cy: sh / 2, m: (cw - glCanvas.width) / 2 / sd, s: s1, rot, w: sw, h: sh, sig: snapSig } };
        build.info.c = inSnap(build, center);
        const bt = Math.ceil(th / SNAP_BANDS);
        if (bandCanvas.width !== tw || bandCanvas.height !== bt) { bandCanvas.width = tw; bandCanvas.height = bt; }
        GL.snapBegin(tw, th);
      }
      const b = build, y = b.i * b.bh, h = Math.min(b.bh, b.ch - y);
      paintMemo = b.memo; try { inSnap(b, () => paintMap(b.sd, y / b.sd)); } finally { paintMemo = null; }
      GL.snapBand(bandCanvas, y, h);
      if (++b.i * b.bh >= b.ch) { GL.snapSwap(b.info); build = null; if (buildOnly) schedule(); }
    };
    // de cerca, el mapa entero lo dibuja la tarjeta gráfica (si ya está preparado; mientras tanto, el camino de siempre)
    if (VG) { VG.prepare(G.lo); VG.prepare(G.hi); }
    const vgSet = VG && provMode && !useGL ? (VG.ready(G.hi) ? G.hi : VG.ready(G.lo) ? G.lo : null) : null;
    const canSnap = GL && GL.canSnap() && !useGL && !vgSet && S.k >= vectorFrom();
    // en reposo la foto se rehace (a franjas, sin prisa) exactamente en la vista actual: entonces se ve igual que pintada directa
    if (buildOnly) {
      if (!canSnap || moving || still(GL.snap())) { build = null; return; }
      if (build && !(build.info.s === sphereR && build.info.rot[0] === S.rot[0] && build.info.rot[1] === S.rot[1])) build = null;
      buildStep();
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (useGL) {
      GL.render();
    } else if (vgSet) {
      if (GL.snap()) GL.dropSnap();
      build = null;
      const pa = projection(paper.g);
      VG.render({ set: vgSet, people, W, H, sphereR, rot: S.rot, k: S.k, anc: [pa[0] + paper.sx, pa[1] + paper.sy] });
    } else if (canSnap) {
      // de cerca la pantalla muestra la foto recolocada: pintar el mapa entero directo en pantalla es lo que más cuesta
      // si la foto ya no sirve (zoom brusco), se pinta la pantalla directamente y la nueva se prepara por franjas
      // cuando el zoom se calma: nunca entera de golpe, que congela la página
      // salto brusco de zoom (rueda de golpe): se pinta directo y la foto se rehace al calmarse; en zoom suave, foto entera
      if (!fresh(GL.snap()) && !(zooming && Math.abs(sphereR / prevR - 1) > 0.08)) buildAll();
      if (!fresh(GL.snap())) { GL.clear(); paintMap(); if (!moving) buildSoon(); }
      else {
      const i = GL.snap();
      GL.reproject();
      // en marcha solo se prepara otra foto cuando esta se va a acabar (o, quieto el zoom, para volver a la nitidez exacta)
      if (moving) { const fl = framesLeft(i); if (build || fl < SNAP_BANDS + 3 || (!zooming && !exact(i))) buildStep(); }
      else if (!still(i)) buildSoon();
      }
    } else {
      if (GL) GL.clear();
      paintMap();
    }
    ctx.beginPath(); ctx.arc(W / 2, H / 2, sphereR, 0, 2 * Math.PI); ctx.strokeStyle = colors.line; ctx.lineWidth = 1.5; ctx.stroke();

    // pastillas: se proyectan con la rotación calculada una sola vez y solo se toca el DOM cuando algo cambia de verdad
    const sph = R * S.k, dl = S.rot[0] * RAD, df = S.rot[1] * RAD;
    const cl = Math.cos(dl), sl = Math.sin(dl), cf = Math.cos(df), sf = Math.sin(df);
    const order = [];
    for (const p of people) {
      const pin = pins.get(p.twitch); if (!pin) continue;
      const lo = +p.lon, la = +p.lat;
      if (p._vlo !== lo || p._vla !== la) { p._vlo = lo; p._vla = la; p._v = unit([lo, la]); }
      const v = p._v, x0 = v[0] * cl - v[1] * sl, y0 = v[0] * sl + v[1] * cl;
      const depth = x0 * cf - v[2] * sf;
      const ok = depth > 0.03;
      const st = pin._st || (pin._st = { hid: null, tx: NaN, ty: NaN, z: -1, lift: NaN, loc: null, below: null, shift: NaN });
      if (st.hid !== !ok) { pin.hidden = !ok; st.hid = !ok; pin._stem.hidden = !ok || st.below === true; }
      if (!ok) continue;
      const px = W / 2 + sph * y0, py = H / 2 - sph * (v[2] * cf + x0 * sf);
      if (!(Math.abs(px - st.tx) <= 0.02) || !(Math.abs(py - st.ty) <= 0.02)) { st.tx = px; st.ty = py; pin.style.transform = `translate(${px.toFixed(2)}px, ${py.toFixed(2)}px)`; st.stemT = null; }
      if (pin.classList.contains('open')) {
        const card = pin._card || (pin._card = pin.querySelector('.card'));
        if (card && !card._size) card._size = [card.offsetWidth, card.offsetHeight];
        const ch = card ? card._size[1] : 260, half = (card ? card._size[0] : 290) / 2;
        const below = py - ch - 40 < 0 && py + ch + 20 < H;
        if (below !== st.below) { pin.classList.toggle('below', below); st.below = below; pin._stem.hidden = below; }
        let sh = 0; if (px - half < 8) sh = 8 + half - px; if (px + half > W - 8) sh = W - 8 - half - px;
        if (Math.abs(sh - st.shift) > 0.05 || st.shift !== st.shift) { if (card) card.style.translate = sh ? sh.toFixed(1) + 'px 0' : ''; st.shift = sh; } // translate directo: lo mueve la tarjeta gráfica sin recalcular ni repintar la ficha
      }
      const loc = pin._loc || (pin._loc = pin.querySelector('.pill-loc'));
      if (loc) {
        const lt = provMode ? (place(p.city, provinceLabel(p)) || p.country || '') : `${flag(p.country_iso2)} ${p.country || ''}`.trim();
        if (loc.dataset.t !== lt) { loc.dataset.t = lt; loc.replaceChildren(...(provMode ? [lt] : withFlag(p.country_iso2, p.country || ''))); }
      }
      order.push([py, pin, px, depth]);
    }
    order.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < order.length; i++) { const e = order[i][1], z = 10 + i; if (e._st.z !== z) { e._st.z = z; e.style.zIndex = String(z); } }
    // tres tamaños de pastilla: lejos solo la foto; a medio zoom (vista países) foto y nombre; de cerca, completa
    // (con margen en cada umbral para que no parpadee al cruzarlo)
    const mini = S.mini = S.mini ? S.k < 1.05 : S.k < 0.95;
    const semi = S.semi = !mini && !provMode && (S.semi ? S.k < 2.1 : S.k < 1.9);
    if (labels._mini !== mini) { labels._mini = mini; labels.classList.toggle('mini', mini); }
    if (labels._semi !== semi) { labels._semi = semi; labels.classList.toggle('semi', semi); }
    placeLabels(order, W, H, mini ? 'm' : semi ? 's' : 'f');
    const chipT = provMode ? 'Vista: provincias' : 'Vista: países';
    if (chipEl.textContent !== chipT) chipEl.textContent = chipT;
  };

  // ── colocación de las pastillas ──
  // Reglas (como los mapas profesionales: sitios candidatos con coste, choques prohibidos y memoria):
  //  1. Cada pastilla se mide de verdad (ancho y alto reales en cada tamaño), nada de cajas fijas.
  //  2. Sitios candidatos alrededor de su punto: encima (lo normal), debajo y a los lados, en anillos cada vez más lejos.
  //  3. Coste = largo del palito + un poco por no estar encima. Dos pastillas nunca se tapan.
  //     Cruzar palitos, que un palito atraviese otra pastilla o tapar el punto de otra cuesta mucho.
  //  4. Memoria: quedarse donde estaba es más barato, así una pastilla solo se mueve si gana claramente (sin saltos).
  //  5. Cada una parte de su sitio anterior; solo las nuevas buscan sitio desde cero. Después todas revisan su sitio
  //     dos veces sabiendo dónde están las demás (nadie acaba lejos teniendo hueco cerca, y que otra aparezca
  //     o se esconda tras el globo no recoloca al resto).
  //  6. Los cambios de sitio se deslizan en unos 150 ms en vez de saltar.
  //  7. Si no cabe cerca, antes que alejarse se queda solo con la foto (ocupa menos y su palito sigue corto).
  const GAP = 22, PAD = 4, KEEP = 40, SOLO = 40;
  const pillSize = (e, mode) => {
    const pl = e._pill || (e._pill = e.querySelector('.pill'));
    const k = mode + (e._loc ? e._loc.dataset.t : '');
    if (!e._sz || e._sz.k !== k) {
      const solo = e.classList.contains('solo');
      if (solo) e.classList.remove('solo');
      e._sz = { k, w: pl ? pl.offsetWidth : 40, h: pl ? pl.offsetHeight : 40, c: null };
      if (solo) e.classList.add('solo');
    }
    return e._sz;
  };
  // candidatos de una caja w×h: [centro x, centro y (relativos al punto), punto de la caja donde llega el palito x, y,
  // coste base, semiancho, semialto, solo foto], ordenados por coste base
  const ring = (out, w, h, pen, solo) => {
    const w2 = w / 2, h2 = h / 2;
    const add = (cx, cy, p) => {
      const ax = Math.max(cx - w2, Math.min(cx + w2, 0)), ay = Math.max(cy - h2, Math.min(cy + h2, 0));
      out.push([cx, cy, ax, ay, Math.hypot(ax, ay) + p + pen, w2, h2, solo]);
    };
    const xs = []; for (let d = 0; d <= w2 + 70; d += 18) { xs.push(d); if (d) xs.push(-d); }
    for (let r = 0; r < 9; r++) {
      const off = GAP + r * (h + PAD);
      for (const dx of xs) { add(dx, -off - h2, 0); add(dx, off + h2, 14); }
    }
    for (let c = 0; c < 3; c++) {
      const off = GAP + c * (w + PAD);
      for (let dy = -2 * h; dy <= 2 * h; dy += 12) { add(off + w2, dy, 8); add(-off - w2, dy, 8); }
    }
  };
  const candidates = (sz, mode) => {
    if (sz.c) return sz.c;
    const out = [];
    ring(out, sz.w, sz.h, 0, false);
    if (mode !== 'm') ring(out, sz.h, sz.h, SOLO, true); // solo la foto: un cuadrado del alto de la pastilla
    out.sort((a, b) => a[4] - b[4]);
    return (sz.c = out);
  };
  // ¿se cruzan los segmentos ab y cd?
  const cross = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const o = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
    return (o(ax, ay, bx, by, cx, cy) > 0) !== (o(ax, ay, bx, by, dx, dy) > 0) && (o(cx, cy, dx, dy, ax, ay) > 0) !== (o(cx, cy, dx, dy, bx, by) > 0);
  };
  // ¿el segmento ab atraviesa la caja (centro c, semitamaño w2×h2)? (recorte de Liang-Barsky)
  const segBox = (ax, ay, bx, by, cx, cy, w2, h2) => {
    let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay;
    const p = [-dx, dx, -dy, dy], q = [ax - (cx - w2), cx + w2 - ax, ay - (cy - h2), cy + h2 - ay];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t1 - t0 > 0.02;
  };
  // coste de poner a «a» en el candidato c frente a las demás ya colocadas (Infinity = prohibido)
  const costAt = (a, c, others, W, H) => {
    const cx = a.x + c[0], cy = a.y + c[1], w2 = c[5], h2 = c[6], ax = a.x + c[2], ay = a.y + c[3];
    if (!a.edge && (cx - w2 < 4 || cx + w2 > W - 4 || cy - h2 < 4 || cy + h2 > H - 4)) return Infinity;
    let s = c[4];
    for (const q of others) {
      if (q === a || !q.c) continue;
      const qx = q.x + q.c[0], qy = q.y + q.c[1], qw2 = q.c[5], qh2 = q.c[6];
      if (Math.abs(qx - cx) < w2 + qw2 + 3 && Math.abs(qy - cy) < h2 + qh2 + 3) return Infinity;
      // nada cerca: ni la caja ni el palito pueden tocarse
      const minX = Math.min(cx - w2, a.x), maxX = Math.max(cx + w2, a.x), minY = Math.min(cy - h2, a.y), maxY = Math.max(cy + h2, a.y);
      const qminX = Math.min(qx - qw2, q.x), qmaxX = Math.max(qx + qw2, q.x), qminY = Math.min(qy - qh2, q.y), qmaxY = Math.max(qy + qh2, q.y);
      if (maxX < qminX || minX > qmaxX || maxY < qminY || minY > qmaxY) continue;
      const qax = q.x + q.c[2], qay = q.y + q.c[3];
      if (cross(a.x, a.y, ax, ay, q.x, q.y, qax, qay)) s += 150;
      if (segBox(a.x, a.y, ax, ay, qx, qy, qw2, qh2)) s += 60;
      if (segBox(q.x, q.y, qax, qay, cx, cy, w2, h2)) s += 60;
      if (Math.abs(q.x - cx) < w2 + 7 && Math.abs(q.y - cy) < h2 + 7) s += 40;
    }
    return s;
  };
  const choose = (a, others, W, H) => {
    const cs = a.cs; let best = null, bestS = Infinity;
    for (const c of cs) {
      if (c[4] - KEEP >= bestS) break;
      let s = costAt(a, c, others, W, H);
      if (c === a.prev) s -= KEEP;
      if (s < bestS) { bestS = s; best = c; }
    }
    a.c = best || cs[0];
  };
  const placeLabels = (order, W, H, mode) => {
    const nowT = performance.now(), sig = order.length + mode;
    // al girar o hacer zoom el reparto casi no cambia: se recalcula como mucho cada 90 ms (o cuando cambia qué se ve o el tamaño)
    if (S._sig !== sig || nowT - (S._placeT || 0) >= 90) {
      S._sig = sig; S._placeT = nowT;
      const items = [];
      for (const [y, e, x, depth] of order) {
        if (e.classList.contains('open')) continue;
        const sz = pillSize(e, mode);
        const edge = depth < 0.2 || x < 0 || x > W || y < 0 || y > H;
        const cs = candidates(sz, mode);
        items.push({ e, x, y, edge, cs, prev: e._st.cand && cs.includes(e._st.cand) ? e._st.cand : null, c: null });
      }
      // primero las que tienen más vecinas (las que más difícil lo tienen eligen antes)
      for (const a of items) { let n = 0; for (const b of items) if (Math.abs(b.x - a.x) < 260 && Math.abs(b.y - a.y) < 160) n++; a.n = n; }
      const seq = items.slice().sort((p, q) => q.n - p.n || p.y - q.y);
      const done = [];
      for (const a of seq) if (a.prev) { a.c = a.prev; done.push(a); }
      for (const a of seq) if (!a.prev) { choose(a, done, W, H); done.push(a); }
      for (let pass = 0; pass < 2; pass++) for (const a of seq) choose(a, seq, W, H);
      for (const a of items) {
        const st = a.e._st, c = a.c;
        st.cand = c; st.tgt = [c[0], c[1], c[2], c[3], c[6]];
        if (st.solo !== c[7]) { st.solo = c[7]; a.e.classList.toggle('solo', c[7]); }
      }
    }
    let moving = false;
    for (const [y, e, x] of order) {
      const st = e._st;
      if (e.classList.contains('open') || !st.tgt) continue;
      const t = st.tgt;
      let cur = st.cur;
      if (!cur) cur = st.cur = t.slice();
      else if (cur !== t) {
        let d = 0;
        for (let i = 0; i < 5; i++) { cur[i] += (t[i] - cur[i]) * 0.35; d = Math.max(d, Math.abs(t[i] - cur[i])); }
        if (d < 0.4) for (let i = 0; i < 5; i++) cur[i] = t[i]; else moving = true;
      }
      // la pastilla, por CSS, está centrada encima del punto con su borde de abajo a 27 px: se desplaza hasta su sitio
      const tx = cur[0], ty = cur[1] + cur[4] + 27;
      const key = tx.toFixed(1) + ',' + ty.toFixed(1);
      if (st.lift !== key) {
        st.lift = key; st.stemT = null;
        e._pill.style.translate = Math.abs(tx) < 0.05 && Math.abs(ty) < 0.05 ? '' : tx.toFixed(1) + 'px ' + ty.toFixed(1) + 'px';
      }
      if (st.stemT === null || st.stemT === undefined) {
        // el palito va del punto al borde más cercano de la pastilla; vive en su propia capa debajo de todas
        st.stemT = 1;
        const len = Math.hypot(cur[2], cur[3]);
        e._stem.style.transform = 'translate(' + (st.tx - 1).toFixed(2) + 'px, ' + (st.ty - 24).toFixed(2) + 'px) rotate(' + Math.atan2(cur[2], -cur[3]).toFixed(4) + 'rad) scaleY(' + (len / 24).toFixed(3) + ')';
      }
    }
    if (moving) schedule();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };

  // zoom + rotate
  let lastT = null, programmatic = false, lastInteract = 0;
  const zoom = d3.zoom().scaleExtent([0.8, 60])
    .on('start', () => { lastT = null; })
    .on('zoom', (ev) => {
      const t = ev.transform;
      if (ev.sourceEvent) lastInteract = performance.now();
      markMoving();
      if (!programmatic && lastT && ev.sourceEvent && lastT.k === t.k) {
        const touch = !!(ev.sourceEvent.touches || ev.sourceEvent.pointerType === 'touch');
        const sp = 0.25 / S.k * (touch ? 1.9 : 1);
        S.rot = [S.rot[0] + (t.x - lastT.x) * sp, Math.max(-89, Math.min(89, S.rot[1] - (t.y - lastT.y) * sp))];
      }
      // con una ficha abierta, el zoom in se acerca hacia esa ficha
      if (!programmatic && S.open && t.k > S.k + 1e-6) {
        const p = S.all.get(S.open);
        if (p && Number.isFinite(+p.lat) && Number.isFinite(+p.lon)) {
          const f = Math.min(1, 1 - S.k / t.k) * 1.6;
          let lon1 = -p.lon; while (lon1 - S.rot[0] > 180) lon1 -= 360; while (lon1 - S.rot[0] < -180) lon1 += 360;
          S.rot = [S.rot[0] + (lon1 - S.rot[0]) * f, S.rot[1] + (-p.lat - S.rot[1]) * f];
        }
      }
      // con la ventana a tamaño cero (pestaña oculta) el zoom puede dar un valor roto: se ignora y se deja el último bueno
      if (!Number.isFinite(t.k) || !Number.isFinite(t.x) || !Number.isFinite(t.y)) { sel.property('__zoom', d3.zoomIdentity.scale(S.k)); return; }
      lastT = t; S.k = t.k; schedule();
    });
  const sel = d3.select(canvas).call(zoom).on('dblclick.zoom', null);
  // la rueda también debe funcionar encima de pastillas y fichas
  labels.addEventListener('wheel', (e) => {
    e.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY, ctrlKey: e.ctrlKey, bubbles: true, cancelable: true }));
  }, { passive: false });
  $('zin').addEventListener('click', () => sel.transition().duration(400).call(zoom.scaleBy, 1.8));
  $('zout').addEventListener('click', () => sel.transition().duration(400).call(zoom.scaleBy, 1 / 1.8));
  const flyTo = (p, kMin = 5, dur = 1100) => {
    const r0 = S.rot.slice(); let lon1 = -p.lon;
    while (lon1 - r0[0] > 180) lon1 -= 360; while (lon1 - r0[0] < -180) lon1 += 360;
    const ir = d3.interpolate(r0, [lon1, -p.lat]); const k0 = S.k, k1 = Math.max(S.k, kMin);
    programmatic = true;
    sel.transition().duration(dur).tween('fly', () => (t) => { S.rot = ir(t); markMoving(); zoom.scaleTo(sel, k0 + (k1 - k0) * t); })
      .on('end interrupt', () => { programmatic = false; lastT = null; });
  };
  canvas.addEventListener('click', (ev) => {
    if (S.picking) {
      const b = canvas.getBoundingClientRect();
      const ll = projection.invert([ev.clientX - b.left, ev.clientY - b.top]);
      if (!ll || d3.geoDistance(ll, center()) > Math.PI / 2) return;
      const cb = S.picking; stopPicking(); cb(locate(ll));
      return;
    }
    if (S.open) closeCard();
  });

  // estado en directo: lee live.json, que actualiza cada 5 min la API oficial de Twitch (en-directo.yml)
  const LIVE = new Map();
  try { const c = JSON.parse(localStorage.getItem('fl_live') || 'null'); if (c && Date.now() - c.t < 15 * 60000) for (const k in c.v) LIVE.set(k, !!c.v[k]); } catch {}
  const saveLive = () => { try { localStorage.setItem('fl_live', JSON.stringify({ t: Date.now(), v: Object.fromEntries(LIVE) })); } catch {} };
  const paintLive = (login) => { const pin = pins.get(login); if (pin) { const v = LIVE.get(login); pin.classList.toggle('is-live', v === true); pin.classList.toggle('is-off', v === false); } };
  const pollLive = async () => {
    if (document.hidden || polling || !live().length) return;
    polling = true; lastPoll = Date.now();
    try {
      const r = await fetch('live.json?t=' + Math.floor(Date.now() / 30000), { cache: 'no-store' });
      const d = await r.json();
      if (Date.now() - Date.parse(d.t) > 20 * 60000) throw 0; // dato caducado: mejor no mostrar nada que mostrar algo falso
      const on = new Set(d.live);
      for (const p of live()) { if (isKick(p)) continue; LIVE.set(p.twitch, on.has(p.twitch)); paintLive(p.twitch); }
      saveLive();
    } catch { for (const p of live()) { LIVE.delete(p.twitch); paintLive(p.twitch); } } finally { polling = false; }
  };
  let polling = false, lastPoll = 0;
  const needLive = () => { if (Date.now() - lastPoll > 20000 && live().some((p) => !isKick(p) && !LIVE.has(p.twitch))) pollLive(); };
  setInterval(pollLive, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });

  // arrastrar para girar también desde encima de pastillas y fichas (un toque sin mover sigue siendo un clic)
  { let drag = null, suppress = false;
    labels.addEventListener('pointerdown', (e) => { if (e.button > 0 || S.picking) return; if (drag) { drag = null; return; } drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, touch: e.pointerType === 'touch' }; });
    window.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) return;
      drag.moved = true;
      const sp = 0.25 / S.k * (drag.touch ? 1.9 : 1);
      S.rot = [S.rot[0] + (e.clientX - drag.x) * sp, Math.max(-89, Math.min(89, S.rot[1] - (e.clientY - drag.y) * sp))];
      drag.x = e.clientX; drag.y = e.clientY; lastInteract = performance.now(); markMoving(); schedule();
    });
    const end = (e) => { if (!drag || e.pointerId !== drag.id) return; if (drag.moved) { suppress = true; setTimeout(() => { suppress = false; }, 60); } drag = null; };
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    labels.addEventListener('click', (e) => { if (suppress) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  // pins
  const pins = new Map();
  const buildPins = () => {
    pins.clear(); labels.replaceChildren(); stemsEl.replaceChildren();
    live().forEach((p, i) => {
      const pin = el('div', 'pin'); pin.dataset.login = p.twitch; { const v = isKick(p) ? undefined : LIVE.get(p.twitch); if (v === true) pin.classList.add('is-live'); else if (v === false) pin.classList.add('is-off'); }
      const fl = el('div', 'pin-float bob'); fl.style.animationDelay = (i % 7) * 0.45 + 's';
      const stem = el('div', 'pin-stem'); stemsEl.append(stem);
      if (S.open === p.twitch) { pin.classList.add('open'); fl.append(buildCard(p)); fl.classList.remove('bob'); }
      else {
        const pill = el('div', 'pill'); pill.tabIndex = 0; pill.setAttribute('role', 'button'); pill.setAttribute('aria-label', `Ver datos de ${p.name || p.twitch}`);
        pill.setAttribute('aria-expanded', 'false');
        const txt = el('div', 'pill-txt');
        txt.append(el('span', 'pill-name', p.name || p.twitch), el('span', 'pill-loc'));
        const lv = el('span', 'pill-live'); lv.setAttribute('aria-hidden', 'true');
        pill.append(avatar(p), lv, txt, chevron());
        const openIt = () => openCard(p.twitch, pill);
        pill.addEventListener('click', openIt);
        pill.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); } });
        fl.append(pill);
      }
      pin.append(fl, el('div', 'pin-dot'));
      pin._stem = stem; labels.append(pin); pins.set(p.twitch, pin);
    });
  };
  // chevron that says "this opens downwards"
  const chevron = () => {
    const box = el('span', 'pill-more'); box.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 12 12');
    const pth = document.createElementNS('http://www.w3.org/2000/svg', 'path'); pth.setAttribute('d', 'M3 4.5 6 7.5 9 4.5');
    svg.append(pth); box.append(svg); return box;
  };
  // the pill grows into the card (and shrinks back) instead of swapping instantly
  const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  let lastPill = { w: 170, h: 40 }, closing = false;
  const morphClip = (card, pin, pw, ph, open) => {
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const shift = parseFloat(card.style.translate) || 0;
    const left = Math.max(0, cw / 2 - shift - pw / 2), right = Math.max(0, cw - left - pw), v = Math.max(0, ch - ph);
    const small = pin.classList.contains('below') ? `inset(0px ${right}px ${v}px ${left}px round 8px)` : `inset(${v}px ${right}px 0px ${left}px round 8px)`;
    const big = 'inset(0px 0px 0px 0px round 10px)';
    const ease = 'cubic-bezier(.22,.9,.24,1)';
    const parts = [...card.children];
    if (open) {
      parts.forEach((c) => c.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: 110, easing: 'ease-out', fill: 'backwards' }));
      return card.animate([{ clipPath: small }, { clipPath: big }], { duration: 340, easing: ease });
    }
    parts.forEach((c) => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-in', fill: 'forwards' }));
    return card.animate([{ clipPath: big }, { clipPath: small }], { duration: 240, easing: ease, fill: 'forwards' });
  };
  const openCard = (login, pill) => {
    if (pill) { const r = pill.getBoundingClientRect(); lastPill = { w: r.width, h: r.height }; }
    closing = false;
    S.open = login; buildPins(); schedule();
    try {
      const p0 = S.all.get(login);
      if (p0 && matchMedia('(pointer: coarse), (max-width: 700px)').matches) {
        const dy = Math.min(150, H * 0.26), dlat = dy / (R * S.k) * 180 / Math.PI;
        flyTo({ lon: +p0.lon, lat: Math.max(-85, Math.min(85, +p0.lat + dlat)) }, 0, 700);
      }
    } catch {}
    if (calm()) return;
    const pin = pins.get(login); const card = pin && pin.querySelector('.card');
    if (!card) return;
    card.style.visibility = 'hidden';
    requestAnimationFrame(() => { card.style.visibility = ''; try { morphClip(card, pin, lastPill.w, lastPill.h, true); } catch {} });
  };
  const closeCard = () => {
    if (!S.open || closing) return;
    const pin = pins.get(S.open); const card = pin && pin.querySelector('.card');
    const done = () => { closing = false; S.open = null; buildPins(); schedule(); };
    if (!card || calm()) return done();
    closing = true;
    try { morphClip(card, pin, lastPill.w, lastPill.h, false).finished.then(done, done); } catch { done(); }
  };
  const buildCard = (p) => {
    const card = el('div', 'card');
    const close = el('button', 'card-close'); close.type = 'button';
    { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 12 12');
      const pth = document.createElementNS('http://www.w3.org/2000/svg', 'path'); pth.setAttribute('d', 'M3 3l6 6M9 3 3 9'); svg.append(pth); close.append(svg); } close.setAttribute('aria-label', 'Cerrar');
    close.addEventListener('click', (e) => { e.stopPropagation(); closeCard(); });
    const head = el('div', 'card-head');
    const who = el('div');
    const a = el('a', 'card-name', p.name || p.twitch); a.href = channelUrl(p); a.target = '_blank'; a.rel = 'noopener noreferrer';
    const lt = el('span', 'card-live');
    who.append(a, el('div', 'card-login', '@' + p.twitch), lt);
    head.append(avatar(p), who);
    const dl = el('dl', 'facts');
    const add = (k, v) => { dl.append(el('dt', null, k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); };
    add('Vive en', place(p.city, provinceLabel(p), p.country) || '—');
    const natNode = el('span'); natNode.append(...withFlag(p.nationality, regionName(p.nationality)));
    add('Nacionalidad', p.nationality ? natNode : '—');
    const age = ageOf(p);
    add('Edad', age == null ? '—' : `${age} años${p.birthdate ? ' · ' + fmtDate(p.birthdate) : ''}`);
    const tz = p.tz || guessTz(p.country_iso2, +p.lon, +p.lat);
    const clock = el('div', 'clock'); clock.dataset.tz = tz;
    clock.append(document.createTextNode(timeIn(tz, true)), el('small', null, offsetOf(tz)));
    add('Hora local', clock);
    const liveA = el('a', 'live', isKick(p) ? 'Ver directo en Kick' : 'Ver directo en Twitch'); liveA.href = channelUrl(p); liveA.target = '_blank'; liveA.rel = 'noopener noreferrer';
    card.append(close, head, dl, liveA);
    const soc = p.socials && typeof p.socials === 'object' ? SOCIALS.map(([k, label]) => [k, label, socialUrl(k, p.socials[k])]).filter((x) => x[2]) : [];
    if (soc.length) {
      const row = el('div', 'socials');
      for (const [k, label, url] of soc) { const a = el('a', 'social', SOC_MONO[k] || label); a.title = label; a.href = url; { const im = new Image(); im.alt = ''; im.decoding = 'async'; im.onload = () => { a.textContent = ''; a.classList.add('has-icon'); a.append(im); }; im.src = `icons/${k}.webp?v=${ASSET_V}`; } a.target = '_blank'; a.rel = 'noopener noreferrer'; a.dataset.net = k; a.setAttribute('aria-label', `${label} de ${p.name || p.twitch}`); row.append(a); }
      card.append(row);
    }
    if (S.canEdit) {
      const ed = el('button', 'btn small', 'Editar'); ed.type = 'button'; ed.style.marginTop = '8px'; ed.style.width = '100%'; ed.style.justifyContent = 'center';
      ed.addEventListener('click', (e) => { e.stopPropagation(); openForm(p); });
      card.append(ed);
    }
    card.addEventListener('click', (e) => e.stopPropagation());
    return card;
  };
  setInterval(() => {
    document.querySelectorAll('.clock[data-tz]').forEach((c) => { c.firstChild.textContent = timeIn(c.dataset.tz, true); });
    const m = new Date().getSeconds(); if (m === 0) renderRoster();
  }, 1000);

  // ---------- roster ----------
  const renderRoster = () => {
    const ul = $('roster'); ul.replaceChildren();
    const q = norm(S.q);
    const items = live().filter((p) => !q || norm([p.name, p.twitch, p.city, p.province, p.country, regionName(p.nationality)].join(' ')).includes(q))
      .sort((a, b) => String(a.name || a.twitch).localeCompare(String(b.name || b.twitch), 'es'));
    if (!S.loaded) { ul.append(el('li', 'empty', 'Cargando el listado…')); return; }
    if (!items.length) {
      ul.append(el('li', 'empty', live().length ? 'Nadie coincide con la búsqueda.' : (S.canEdit ? 'Todavía no hay streamers. Tocá “+ Agregar streamer” para sumar el primero.' : 'Todavía no hay streamers en el globo.')));
      return;
    }
    if (S.canEdit && !q) {
      const pend = [...S.all.values()].filter((x) => !x.deleted && !(Number.isFinite(+x.lat) && x.lat !== '' && x.lat != null)).sort((a, b) => String(a.name || a.twitch).localeCompare(String(b.name || b.twitch), 'es'));
      if (pend.length) {
        ul.append(el('li', 'empty', `Sin ubicar (${pend.length}): pulsá Editar y elegí dónde viven para que aparezcan en el globo.`));
        for (const p of pend) {
          const li = el('li', 'row'); const main = el('div', 'row-main'); main.append(el('div', 'row-name', p.name || p.twitch), el('div', 'row-sub', '@' + p.twitch + ' · sin ubicación'));
          const side = el('div', 'row-side'); const b = el('button', 'icon-btn', 'Editar'); b.type = 'button'; b.addEventListener('click', (e) => { e.stopPropagation(); openForm(p); }); side.append(b);
          li.append(avatar(p), main, side); ul.append(li);
        }
      }
    }
    for (const p of items) {
      const li = el('li', 'row'); li.tabIndex = 0;
      const main = el('div', 'row-main');
      main.append(el('div', 'row-name', p.name || p.twitch), el('div', 'row-sub', place(p.city, provinceLabel(p), p.country)));
      const side = el('div', 'row-side');
      side.append(el('span', 'row-time', timeIn(p.tz || guessTz(p.country_iso2, +p.lon, +p.lat), false)));
      if (S.canEdit) {
        const b = el('button', 'icon-btn', 'Editar'); b.type = 'button';
        b.addEventListener('click', (e) => { e.stopPropagation(); openForm(p); });
        side.append(b);
      }
      li.append(avatar(p), main, side);
      const go = () => { openCard(p.twitch); flyTo(p); if (window.innerWidth < 820) stage.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      ul.append(li);
    }
  };
  $('q').addEventListener('input', (e) => { S.q = e.target.value; renderRoster(); });

  // total de streamers de la comunidad: el contador de arriba a la derecha muestra cuántos ya están en el mapa
  const TOTAL_STREAMERS = 70;
  const renderSummary = () => {
    const ps = live();
    $('count').textContent = S.loaded ? `Streamers en el mapa ${ps.length}/${TOTAL_STREAMERS}` : '';
    const nC = new Set(ps.map((p) => p.country_code)).size, nP = new Set(ps.map((p) => p.province_id).filter(Boolean)).size;
    $('sum').textContent = !S.loaded ? 'Cargando el listado…' : `${ps.length} ${ps.length === 1 ? 'streamer' : 'streamers'} en ${nC} ${nC === 1 ? 'país' : 'países'} y ${nP} ${nP === 1 ? 'provincia' : 'provincias'}`;
    const t = [...S.all.values()].filter((s) => s.deleted).length;
    const trashN = $('trash-n'); if (trashN) trashN.textContent = String(t);
  };
  const renderAll = () => { renderSummary(); renderRoster(); buildPins(); schedule(); needLive(); };

  // ---------- toast ----------
  let toastTimer = 0;
  const toast = (msg, actionLabel, action) => {
    $('toast-msg').textContent = msg; const b = $('toast-btn'); b.textContent = actionLabel || '';
    b.onclick = action ? async () => { $('toast').hidden = true; await action(); } : null;
    $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 7000);
  };

  const setItems = (arr) => {
    S.all = new Map((Array.isArray(arr) ? arr : []).filter((x) => x && x.twitch).map((x) => [x.twitch, x]));
    S.loaded = true;
    if (S.open && !live().some((p) => p.twitch === S.open)) S.open = null;
    renderAll();
  };

  // ---------- admin (online: entra con #admin y la clave de GitHub) ----------
  // ---------- GitHub storage ----------
  const CFG = { owner: 'ConfluxGN', repo: 'ForeverLatam-src', path: 'streamers.json', branch: 'main' };
  const API = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}`;
  const TOKEN_KEY = 'globo_gh_token';
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {} };
  const gh = async (p, opts = {}) => {
    const r = await fetch(API + p, { ...opts, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + getToken(), 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  };
  const b64enc = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(String(b).replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const clean = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
  let fileSha = null;
  const loadAdmin = async () => { const j = await gh(`/contents/${CFG.path}?ref=${CFG.branch}`); fileSha = j.sha; setItems(JSON.parse(b64dec(j.content))); };
  const serialize = (m) => JSON.stringify([...m.values()].sort((a, b) => a.twitch.localeCompare(b.twitch)), null, 2) + '\n';
  let queue = Promise.resolve();
  const commitMap = (next, message) => (queue = queue.catch(() => {}).then(async () => {
    try {
      const j = await gh(`/contents/${CFG.path}`, { method: 'PUT', body: JSON.stringify({ message, content: b64enc(serialize(next)), sha: fileSha, branch: CFG.branch }) });
      fileSha = j.content.sha; S.all = next; renderAll();
    } catch (e) { if (e.status === 409 || e.status === 422) await loadAdmin().catch(() => {}); throw e; }
  }));
  let staged = null;
  const writeDoc = async (login, data) => { if (!staged) staged = new Map(S.all); staged.set(login, data); };
  const removeDoc = async (login) => { if (!staged) staged = new Map(S.all); staged.delete(login); };
  const MSG = { add: 'Agregar', edit: 'Editar', delete: 'Papelera', restore: 'Restaurar', purge: 'Borrar definitivamente', revert: 'Deshacer cambio', import: 'Importar copia', version: 'Volver a versión' };
  const logChange = async (action, login, before, after, extra = {}) => {
    const next = staged; staged = null;
    if (!next) return null;
    const name = (after && after.name) || (before && before.name) || login;
    await commitMap(next, `${MSG[action] || action}: ${name}`);
    return { action, login, name, before: clean(before), after: clean(after), ...extra };
  };
  const fail = (e) => {
    staged = null;
    const st = e && e.status;
    toast(st === 401 ? 'La clave de GitHub no sirve o venció. Tocá “Salir” y cargá una nueva.' : (st === 403 || st === 404) ? 'Esa clave no tiene permiso para escribir en el repositorio.' : (st === 409 || st === 422) ? 'La lista cambió en otro lado; ya la recargué. Repetí el cambio.' : 'No se pudo guardar en GitHub. Probá de nuevo.');
  };
  const revert = async (h) => {
    try {
      const cur = S.all.get(h.login) || null;
      if (h.oldLogin && h.oldLogin !== h.login) await removeDoc(h.login);
      if (h.before) await writeDoc(h.before.twitch, { ...h.before, updatedAt: nowIso() });
      else await removeDoc(h.login);
      await logChange('revert', (h.before && h.before.twitch) || h.login, cur, h.before);
      toast(`Se deshizo el cambio sobre ${h.name || h.login}.`);
    } catch (e) { fail(e); }
  };

  // ---------- overlay ----------
  const overlay = $('overlay'), sheet = $('sheet');
  const openSheet = (nodes) => { sheet.replaceChildren(...nodes); overlay.hidden = false; const f = sheet.querySelector('input:not([type=file]), select, button'); if (f) f.focus(); };
  const closeSheet = () => { overlay.hidden = true; sheet.replaceChildren(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!overlay.hidden) closeSheet(); else if (S.picking) { const cb = S.pickCancel; stopPicking(); cb && cb(); } else if (S.open) closeCard(); } });

  const startPicking = (cb, cancel) => { S.picking = cb; S.pickCancel = cancel; stage.classList.add('picking'); $('pickbar').hidden = false; overlay.hidden = true; stage.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const stopPicking = () => { S.picking = null; stage.classList.remove('picking'); $('pickbar').hidden = true; };
  $('pick-cancel').addEventListener('click', () => { const cb = S.pickCancel; stopPicking(); cb && cb(); });

  // ---------- form ----------
  const field = (label, input, { full = false, note } = {}) => {
    const f = el('div', 'field' + (full ? ' full' : ''));
    const l = el('label', null, label); if (input.id) l.htmlFor = input.id;
    f.append(l, input); if (note) f.append(el('div', 'note', note));
    return f;
  };
  const inp = (id, type, value, attrs = {}) => { const i = el('input'); i.id = id; i.type = type; i.value = value ?? ''; Object.entries(attrs).forEach(([k, v]) => i.setAttribute(k, v)); return i; };
  const nationalityOptions = (() => {
    const out = []; const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const bad = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ', 'AA', 'QM', 'QN', 'QP', 'QQ', 'QR', 'QS', 'QT', 'QU', 'QV', 'QW', 'QX', 'QY', 'QZ']);
    for (const a of A) for (const b of A) { const c = a + b; if (bad.has(c) || c.startsWith('X') && c !== 'XK') continue; const n = regionName(c); if (n && n !== c && !/desconocid/i.test(n)) out.push([c, n]); }
    return out.sort((x, y) => x[1].localeCompare(y[1], 'es'));
  })();

  const openForm = (orig, draft) => {
    S.open = null;
    const isEdit = !!orig;
    const d = draft || { ...(orig || {}) };
    d._tzAuto = draft ? draft._tzAuto : !orig || !orig.tz;
    const title = el('h3', null, isEdit ? `Editar a ${orig.name || orig.twitch}` : 'Agregar streamer');
    const hint = el('p', 'hint', 'Cada cambio queda en el Historial y se puede deshacer. Lo que borres va a la Papelera.');
    const form = el('form', 'form'); form.noValidate = true;

    const login = inp('f-login', 'text', d.twitch, { autocomplete: 'off', spellcheck: 'false', placeholder: 'usuario de Twitch' });
    const name = inp('f-name', 'text', d.name, { placeholder: 'Como aparece en el globo' });
    // avatar
    const avWrap = el('div', 'avatar-edit');
    let avNode = avatar(d);
    const avFile = inp('f-avatar', 'file', ''); avFile.accept = 'image/*'; avFile.hidden = true;
    const avBtn = el('button', 'btn small', 'Subir imagen'); avBtn.type = 'button'; avBtn.addEventListener('click', () => avFile.click());
    const avDel = el('button', 'btn small', 'Quitar'); avDel.type = 'button';
    const setAv = (v) => { d.avatar = v || ''; const n = avatar(d); avNode.replaceWith(n); avNode = n; };
    avDel.addEventListener('click', () => setAv(''));
    avFile.addEventListener('change', async () => { const f = avFile.files[0]; if (!f) return; try { setAv(await fileToAvatar(f)); } catch (e) { err.textContent = e.message; } avFile.value = ''; });
    const avTw = el('button', 'btn small', 'Traer de Twitch'); avTw.type = 'button';
    avTw.addEventListener('click', async () => {
      const lg = String(login.value || '').trim().replace(/^@/, '').toLowerCase();
      if (!lg) { err.textContent = 'Primero escribí el usuario de Twitch.'; return; }
      avTw.disabled = true; err.textContent = '';
      try { const u = (await (await fetch('https://decapi.me/twitch/avatar/' + encodeURIComponent(lg))).text()).trim(); if (!/^https:\/\/static-cdn\.jtvnw\.net\//.test(u)) throw 0; setAv(u); }
      catch { err.textContent = 'No encontré la foto de ese usuario. Revisá el nombre o subila a mano.'; }
      avTw.disabled = false;
    });
    const avCtl = el('div'); avCtl.style.display = 'flex'; avCtl.style.gap = '6px'; avCtl.style.flexWrap = 'wrap'; avCtl.append(avTw, avBtn, avDel, avFile);
    avWrap.append(avNode, avCtl);
    const avField = el('div', 'field full'); avField.append(el('label', null, 'Imagen de perfil'), avWrap, el('div', 'note', '“Traer de Twitch” la busca sola con el usuario. También podés subir o pegar (Ctrl+V) otra imagen.'));
    sheet.onpaste = async (e) => { const it = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/')); if (it) { e.preventDefault(); try { setAv(await fileToAvatar(it.getAsFile())); } catch {} } };

    // location
    const locBox = el('div', 'locbox');
    const locTxt = el('span');
    const pickBtn = el('button', 'btn small', 'Marcar en el globo'); pickBtn.type = 'button';
    const onlyCountry = el('button', 'btn small', 'Solo el país'); onlyCountry.type = 'button';
    onlyCountry.title = 'Deja solo el país, sin provincia';
    onlyCountry.addEventListener('click', () => { d.province = ''; d.province_id = ''; showLoc(); });
    locBox.append(locTxt, onlyCountry, pickBtn);
    const searchIn = inp('f-prov', 'text', '', { autocomplete: 'off', placeholder: 'Buscar país, provincia o estado…' });
    const sugg = el('ul', 'sugg'); sugg.hidden = true;
    const provField = field('Ubicación', searchIn, { full: true }); provField.append(sugg, locBox);
    const city = inp('f-city', 'text', d.city, { placeholder: 'ej. Bilbao' });
    const nat = el('select'); nat.id = 'f-nat';
    nat.append(new Option('— Sin especificar —', ''), ...nationalityOptions.map(([c, n]) => new Option(`${flag(c)} ${n}`, c)));
    nat.value = d.nationality || '';
    const birth = inp('f-birth', 'date', d.birthdate, { min: '1900-01-01', max: new Date().toISOString().slice(0, 10) });
    const age = inp('f-age', 'number', d.birthdate ? '' : (d.age ?? ''), { min: '0', max: '120', placeholder: 'Si no sabés la fecha' });
    const socIn = {};
    for (const [k, label, , pre] of SOCIALS) socIn[k] = inp('f-soc-' + k, 'text', (d.socials && d.socials[k]) || '', { autocomplete: 'off', spellcheck: 'false', placeholder: `${label}: enlace o @usuario` });
    const tz = el('select'); tz.id = 'f-tz';
    const tzNow = () => d.tz || (Number.isFinite(+d.lat) ? guessTz(d.country_iso2, +d.lon, +d.lat) : '');
    const fillTz = () => {
      tz.replaceChildren(new Option('— Elegí una zona —', ''), ...ZONES.map((z) => new Option(`${z.replace(/_/g, ' ')} (${offsetOf(z)})`, z)));
      const g = tzNow(); if (g && !ZONES.includes(g)) tz.append(new Option(`${g} (${offsetOf(g)})`, g)); tz.value = g;
    };
    tz.addEventListener('change', () => { d.tz = tz.value; d._tzAuto = false; });
    const showLoc = () => {
      locTxt.textContent = Number.isFinite(+d.lat) && d.lat !== '' && d.lat != null ? `${[d.province, d.country].filter(Boolean).join(', ')} · ${(+d.lat).toFixed(2)}, ${(+d.lon).toFixed(2)}` : 'Sin ubicación todavía';
      onlyCountry.hidden = !d.province_id;
    };
    const applyLoc = (loc) => {
      Object.assign(d, loc);
      if (d._tzAuto) d.tz = guessTz(d.country_iso2, d.lon, d.lat);
      if (!nat.value && d.country_iso2) { nat.value = d.country_iso2; }
      showLoc(); fillTz();
    };
    let hits = [], hi = -1;
    const renderSugg = () => {
      sugg.replaceChildren(...hits.map((h, i) => { const li = el('li', i === hi ? 'on' : '', h.label); li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(h); }); return li; }));
      sugg.hidden = !hits.length;
    };
    const choose = (h) => {
      if (h.country) {
        const cf = h.country, iso2 = cf.properties.iso2 || '';
        d._fromList = true;
        applyLoc({ lon: +h.at[0].toFixed(4), lat: +h.at[1].toFixed(4), province: '', province_id: '', country_code: cf.properties.code, country_iso2: iso2, country: regionName(iso2) || cf.properties.name });
        searchIn.value = ''; hits = []; renderSugg();
        return;
      }
      const f = h.f; const c = G.byCode.get(f.properties.adm0_a3); const iso2 = c ? c.properties.iso2 : '';
      d._fromList = true;
      applyLoc({ lon: +f.c[0].toFixed(4), lat: +f.c[1].toFixed(4), province: f.properties.name, province_id: f.properties.pid, country_code: f.properties.adm0_a3, country_iso2: iso2, country: regionName(iso2) || f.properties.admin });
      searchIn.value = ''; hits = []; renderSugg();
    };
    searchIn.addEventListener('input', () => {
      const q = norm(searchIn.value).trim(); hi = -1;
      if (q.length < 2 || !G) { hits = []; return renderSugg(); }
      const starts = [], has = [];
      for (const p of G.provIndex) { const i = p.key.indexOf(q); if (i === 0) starts.push(p); else if (i > 0) has.push(p); if (starts.length > 10) break; }
      hits = starts.concat(has).slice(0, 10); renderSugg();
    });
    searchIn.addEventListener('keydown', (e) => {
      if (!hits.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); hi = (hi + 1) % hits.length; renderSugg(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hi = (hi - 1 + hits.length) % hits.length; renderSugg(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(hits[Math.max(0, hi)]); }
    });
    searchIn.addEventListener('blur', () => setTimeout(() => { hits = []; renderSugg(); }, 120));
    const snapshot = () => { d.twitch = login.value; d.name = name.value; d.city = city.value; d.nationality = nat.value; d.birthdate = birth.value; d.age = age.value; d.socials = Object.fromEntries(SOCIALS.map(([k]) => [k, socIn[k].value])); };
    pickBtn.addEventListener('click', () => {
      snapshot();
      startPicking((loc) => { d._fromList = false; applyLoc(loc); openForm(orig, d); }, () => openForm(orig, d));
    });

    const err = el('div', 'err full');
    form.append(
      field('Usuario de Twitch', login, { note: 'El que va en twitch.tv/…' }),
      field('Nombre visible', name),
      avField, provField,
      field('Ciudad / localidad', city, { note: 'Si la completás, al acercarte se colorea la localidad y la provincia queda más suave.' }), field('Nacionalidad', nat, { note: 'Puede ser distinta del país donde vive.' }),
      field('Fecha de nacimiento', birth), field('Edad', age),
      field('Zona horaria', tz, { full: true, note: 'Se elige sola según la ubicación; cambiala si hace falta.' }),
      ...SOCIALS.map(([k, label]) => field(label, socIn[k])),
      err,
    );
    showLoc(); fillTz();

    const foot = el('div', 'sheet-foot');
    const right = el('div', 'right');
    const cancel = el('button', 'btn', 'Cancelar'); cancel.type = 'button'; cancel.addEventListener('click', closeSheet);
    const save = el('button', 'btn primary', isEdit ? 'Guardar cambios' : 'Agregar'); save.type = 'submit'; save.setAttribute('form', 'f-form');
    form.id = 'f-form';
    right.append(cancel, save);
    if (isEdit) {
      const del = el('button', 'btn danger', 'Mandar a la papelera'); del.type = 'button';
      del.addEventListener('click', async () => {
        try {
          const before = S.all.get(orig.twitch);
          const after = { ...before, deleted: true, deletedAt: nowIso(), updatedAt: nowIso(), updatedBy: S.uid || '' };
          await writeDoc(orig.twitch, after); const h = await logChange('delete', orig.twitch, before, after);
          closeSheet(); toast(`${orig.name || orig.twitch} fue a la papelera.`, 'Deshacer', () => h && revert(h));
        } catch (e) { fail(e); }
      });
      foot.append(del);
    }
    foot.append(right);

    // the locality's outline from OpenStreetMap, so it can be coloured up close
    const findLocality = async (doc) => {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);
      try {
        const q = [doc.city, provinceLabel(doc), doc.country].filter(Boolean).join(', ');
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&polygon_threshold=0.0005&limit=5&accept-language=es&q=' + encodeURIComponent(q), { signal: ctl.signal });
        if (!r.ok) return null;
        const j = await r.json();
        const prov = (doc.province_id && G.provById && G.provById.get(DISTRICTS[doc.province_id] || doc.province_id)) || G.byCode.get(doc.country_code);
        const round = (v) => Array.isArray(v) ? v.map(round) : Math.round(v * 1e4) / 1e4;
        for (const f of j.features || []) {
          if (!f.geometry || !/Polygon/.test(f.geometry.type)) continue;
          const g = { type: f.geometry.type, coordinates: round(f.geometry.coordinates) };
          const test = fixWinding({ type: 'Feature', properties: {}, geometry: JSON.parse(JSON.stringify(g)) });
          const cen = d3.geoCentroid(test);
          if (prov && !d3.geoContains(prov, cen) && d3.geoDistance(cen, prov.c) > prov.rad) continue; // somewhere else with the same name
          if (JSON.stringify(g).length > 120000) continue;
          return { geo: g, center: cen };
        }
      } catch {} finally { clearTimeout(timer); }
      return null;
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); snapshot(); err.textContent = '';
      const lg = String(d.twitch || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/\/.*$/, '').toLowerCase();
      if (!/^[a-z0-9_]{2,25}$/.test(lg)) { err.textContent = 'Escribí el usuario de Twitch (letras, números o guion bajo).'; login.focus(); return; }
      if (!(Number.isFinite(+d.lat) && d.lat !== '' && d.lat != null)) { err.textContent = 'Falta la ubicación: buscá la provincia o marcala en el globo.'; searchIn.focus(); return; }
      const taken = S.all.get(lg);
      if ((!isEdit || lg !== orig.twitch) && taken) { err.textContent = taken.deleted ? `@${lg} está en la papelera: restauralo desde ahí.` : `@${lg} ya está en el globo.`; return; }
      const doc = {
        twitch: lg, name: String(d.name || '').trim() || lg, avatar: d.avatar || '',
        city: String(d.city || '').trim(), province: d.province || '', province_id: d.province_id || '',
        country: d.country || '', country_code: d.country_code || '', country_iso2: d.country_iso2 || '',
        lat: +d.lat, lon: +d.lon, nationality: d.nationality || '',
        birthdate: d.birthdate || '', age: d.birthdate ? null : (d.age === '' || d.age == null ? null : +d.age),
        tz: d.tz || guessTz(d.country_iso2, +d.lon, +d.lat), deleted: false,
        socials: Object.fromEntries(SOCIALS.map(([k]) => [k, socialUrl(k, d.socials && d.socials[k])]).filter(([, v]) => v)),
        createdAt: (orig && orig.createdAt) || nowIso(), updatedAt: nowIso(), updatedBy: S.uid || '',
      };
      save.disabled = true;
      try {
        if (doc.city && !DISTRICTS[doc.province_id]) {
          const same = orig && orig.locality_geo && norm(orig.city) === norm(doc.city) && orig.province_id === doc.province_id;
          if (same) { doc.locality_geo = orig.locality_geo; doc.locality_for = orig.locality_for || orig.city; }
          else {
            const label = save.textContent; save.textContent = 'Buscando la localidad…';
            const found = await findLocality(doc);
            save.textContent = label;
            if (found) {
              doc.locality_geo = found.geo; doc.locality_for = doc.city;
              // the pin goes to the town itself when the place was picked from the province list
              if (d._fromList) { doc.lon = +found.center[0].toFixed(4); doc.lat = +found.center[1].toFixed(4); }
            } else toast(`No encontré el límite de ${doc.city}: se colorea solo la provincia.`);
          }
        }
        await writeDoc(lg, doc);
        let h;
        if (isEdit && lg !== orig.twitch) { await removeDoc(orig.twitch); h = await logChange('edit', lg, S.all.get(orig.twitch) || orig, doc, { oldLogin: orig.twitch }); }
        else h = await logChange(isEdit ? 'edit' : 'add', lg, isEdit ? (S.all.get(lg) || orig) : null, doc);
        closeSheet();
        S.open = lg; flyTo(doc, isEdit ? S.k : 4);
        toast(isEdit ? `Guardado: ${doc.name}.` : `${doc.name} se sumó al globo.`, 'Deshacer', () => h && revert(h));
      } catch (e2) { save.disabled = false; fail(e2); }
    });
    openSheet([title, hint, form, foot]);
  };

  // ---------- history (GitHub commits) + trash ----------
  const when = (iso) => { try { return new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };
  const openHistory = async () => {
    const ul = el('ul', 'hist');
    ul.append(el('li', 'empty', 'Cargando historial…'));
    const foot = el('div', 'sheet-foot'); const c = el('button', 'btn', 'Cerrar'); c.type = 'button'; c.addEventListener('click', closeSheet);
    const r = el('div', 'right'); r.append(c); foot.append(r);
    openSheet([el('h3', null, 'Historial de versiones'), el('p', 'hint', 'Cada cambio que guardás queda como una versión en GitHub. “Volver a esta versión” deja la lista exactamente como estaba en ese momento (y eso también queda guardado, así que se puede volver a deshacer).'), ul, foot]);
    let commits;
    try { commits = await gh(`/commits?path=${CFG.path}&sha=${CFG.branch}&per_page=60`); }
    catch (e) { ul.replaceChildren(el('li', 'empty', 'No se pudo leer el historial de GitHub.')); return; }
    ul.replaceChildren();
    commits.forEach((cm, i) => {
      const li = el('li'); const info = el('div');
      info.append(el('div', 'what', cm.commit.message.split('\n')[0]), el('div', 'when', `${when(cm.commit.author.date)}${i === 0 ? ' · versión actual' : ''}`));
      li.append(info);
      if (i > 0) {
        const b = el('button', 'btn small', 'Volver a esta versión'); b.type = 'button';
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const j = await gh(`/contents/${CFG.path}?ref=${cm.sha}`);
            const arr = JSON.parse(b64dec(j.content));
            staged = new Map((Array.isArray(arr) ? arr : []).filter((x) => x && x.twitch).map((x) => [x.twitch, x]));
            await logChange('version', '', null, { name: when(cm.commit.author.date) });
            closeSheet(); toast('Listo: la lista volvió a esa versión.');
          } catch (e) { b.disabled = false; fail(e); }
        });
        li.append(b);
      }
      ul.append(li);
    });
    if (!commits.length) ul.append(el('li', 'empty', 'Todavía no hay versiones.'));
  };
  const openTrash = () => {
    const ul = el('ul', 'hist');
    const list = [...S.all.values()].filter((s) => s.deleted).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
    if (!list.length) ul.append(el('li', 'empty', 'La papelera está vacía.'));
    for (const s of list) {
      const li = el('li'); const info = el('div');
      const what = el('div', 'what'); what.textContent = s.name || s.twitch;
      info.append(what, el('div', 'when', `Borrado ${when(s.deletedAt)}`));
      const btns = el('div'); btns.style.display = 'flex'; btns.style.gap = '6px';
      const res = el('button', 'btn small', 'Restaurar'); res.type = 'button';
      res.addEventListener('click', async () => {
        try { const after = { ...s, deleted: false, deletedAt: null, updatedAt: nowIso(), updatedBy: S.uid || '' }; await writeDoc(s.twitch, after); await logChange('restore', s.twitch, s, after); closeSheet(); toast(`${s.name || s.twitch} volvió al globo.`); } catch (e) { fail(e); }
      });
      const purge = el('button', 'btn small danger', 'Borrar para siempre'); purge.type = 'button';
      purge.addEventListener('click', () => {
        if (li.nextSibling && li.nextSibling.classList && li.nextSibling.classList.contains('confirm')) return;
        const cf = el('li', 'confirm'); cf.append(document.createTextNode(`¿Borrar a ${s.name || s.twitch} de la papelera? Queda una copia en el Historial.`));
        const yes = el('button', 'btn small danger', 'Sí, borrar'); yes.type = 'button';
        const no = el('button', 'btn small', 'No'); no.type = 'button';
        no.addEventListener('click', () => cf.remove());
        yes.addEventListener('click', async () => { try { await removeDoc(s.twitch); await logChange('purge', s.twitch, s, null); closeSheet(); toast('Borrado. Podés recuperarlo desde el Historial.'); } catch (e) { fail(e); } });
        cf.append(yes, no); li.after(cf);
      });
      btns.append(res, purge); li.append(info, btns); ul.append(li);
    }
    const foot = el('div', 'sheet-foot'); const c = el('button', 'btn', 'Cerrar'); c.type = 'button'; c.addEventListener('click', closeSheet);
    const r = el('div', 'right'); r.append(c); foot.append(r);
    openSheet([el('h3', null, 'Papelera'), el('p', 'hint', 'Los streamers que borres esperan acá hasta que los restaures o los borres para siempre.'), ul, foot]);
  };

  // ---------- export / import ----------
  const exportCopy = () => {
    const data = JSON.stringify({ app: 'globo-de-streamers', version: 1, exportedAt: nowIso(), streamers: [...S.all.values()] }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `globo-streamers-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importCopy = async (file) => {
    let items;
    try { const j = JSON.parse(await file.text()); items = Array.isArray(j) ? j : j.streamers; if (!Array.isArray(items)) throw 0; }
    catch { toast('Ese archivo no es una copia del globo.'); return; }
    items = items.filter((x) => x && /^[a-z0-9_]{2,25}$/.test(String(x.twitch || '')) && Number.isFinite(+x.lat) && Number.isFinite(+x.lon)).slice(0, 1000);
    try {
      for (const x of items) await writeDoc(x.twitch, { ...x, lat: +x.lat, lon: +x.lon, updatedAt: nowIso() });
      await logChange('import', '', null, { name: `${items.length} streamers` });
      toast(`Se importaron ${items.length} ${items.length === 1 ? 'streamer' : 'streamers'}.`);
    } catch (e) { fail(e); }
  };
  $('btn-add').addEventListener('click', () => openForm(null));
  $('btn-hist').addEventListener('click', openHistory);
  $('btn-trash').addEventListener('click', openTrash);
  $('btn-export').addEventListener('click', exportCopy);
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await importCopy(f); });

  $('btn-logout').addEventListener('click', () => { setToken(''); location.replace(location.pathname); });

  // ---------- admin sign-in ----------
  const showSignin = (msg) => {
    const t = inp('f-token', 'password', '', { autocomplete: 'off', placeholder: 'github_pat_…' });
    const err = el('div', 'err', msg || '');
    const ol = el('ol');
    const li1 = el('li'); li1.append(document.createTextNode('Abrí '));
    const a = el('a', null, 'github.com/settings/personal-access-tokens/new'); a.href = 'https://github.com/settings/personal-access-tokens/new'; a.target = '_blank'; a.rel = 'noopener';
    li1.append(a);
    ol.append(li1,
      el('li', null, `En “Repository access” elegí “Only select repositories” → ${CFG.repo}.`),
      el('li', null, 'En “Permissions” → “Contents”, poné “Read and write”.'),
      el('li', null, 'Generá la clave, copiala y pegala acá abajo. Queda guardada solo en este navegador.'));
    const go = el('button', 'btn primary', 'Entrar'); go.type = 'button';
    const enter = async () => {
      const v = t.value.trim(); if (!v) return;
      go.disabled = true; err.textContent = ''; setToken(v);
      try {
        const repo = await gh('');
        if (!repo.permissions || !repo.permissions.push) throw Object.assign(new Error('no push'), { status: 403 });
        closeSheet(); await start();
      } catch (e) { setToken(''); go.disabled = false; err.textContent = e.status === 401 ? 'Esa clave no es válida.' : 'Esa clave no tiene permiso de escritura en el repositorio.'; }
    };
    go.addEventListener('click', enter);
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
    const box = el('div', 'signin');
    box.append(el('h3', null, 'Entrar como administrador'), el('p', 'hint', 'Para guardar cambios en la web necesitás una clave de GitHub con permiso sobre el repositorio. Se crea una sola vez:'), ol, field('Clave de GitHub', t, { full: true }), err);
    const cancel = el('button', 'btn', 'Cancelar'); cancel.type = 'button';
    cancel.addEventListener('click', () => { closeSheet(); try { history.replaceState(null, '', location.pathname); } catch {} });
    const foot = el('div', 'sheet-foot'); const r = el('div', 'right'); r.append(cancel, go); foot.append(r);
    openSheet([box, foot]);
  };
  const ADMIN_BTNS = ['btn-add', 'btn-hist', 'btn-trash', 'btn-export', 'btn-import', 'btn-preview', 'btn-logout'];
  const setMode = (mode) => {
    S.mode = mode; S.canEdit = mode === 'admin';
    document.body.classList.toggle('public', mode !== 'admin');
    document.body.classList.toggle('admin', mode === 'admin');
    document.body.classList.toggle('preview', mode === 'preview');
    ADMIN_BTNS.forEach((id) => { $(id).hidden = mode !== 'admin'; });
    S.open = null; renderAll(); resize();
  };
  const start = async (quiet) => {
    try { await loadAdmin(); }
    catch (e) {
      if (e.status === 401 || e.status === 403 || e.status === 404) { setToken(''); if (!quiet) showSignin('La clave guardada ya no sirve. Cargá una nueva.'); }
      return false;
    }
    setMode('admin');
    try { if (location.hash === '#admin') history.replaceState(null, '', location.pathname); } catch {}
    return true;
  };
  $('btn-preview').addEventListener('click', () => setMode('preview'));
  $('btn-back').addEventListener('click', () => setMode('admin'));

  // ---------- boot ----------
  readColors();
  new ResizeObserver(resize).observe(stage);
  try { const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', () => { readColors(); schedule(); }); } catch {}
  new MutationObserver(() => { readColors(); schedule(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  try { await loadGeo(); $('loading').hidden = true; }
  catch (e) { $('loading').textContent = 'No se pudo cargar el mapa. Recargá la página.'; }
  resize(); renderAll();

  S.mode = 'public';
  const pull = async () => {
    if (S.mode !== 'public') return; // the admin works on the live copy from GitHub
    try { const r = await fetch('streamers.json?t=' + Date.now(), { cache: 'no-store' }); const data = await r.json(); if (S.mode === 'public') setItems(data); }
    catch { S.loaded = true; renderAll(); }
  };
  // Your browser (with the key saved) opens straight into the admin view; everyone else sees only the globe.
  const signedIn = getToken() ? await start(true) : false;
  if (!signedIn) {
    await pull();
    if (location.hash === '#admin') showSignin();
  }
  setInterval(pull, 180000);
  window.addEventListener('hashchange', () => { if (location.hash === '#admin' && S.mode === 'public') showSignin(); });
  // slow spin while nobody is touching it (visitors and preview only)
  let prevT = performance.now();
  d3.timer(() => {
    const now = performance.now(); const dt = Math.min(64, now - prevT); prevT = now;
    if (S.mode === 'admin' || S.open || programmatic || S.k > 2 || now - lastInteract < 6000 || document.hidden) return;
    S.rot = [S.rot[0] + dt * 0.004, S.rot[1]]; schedule();
  });
})();
