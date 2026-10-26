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
    return { countries, parts, provinces, byCode, groups, provById, ...meshArcs(ct) };
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
  const stage = $('stage'), canvas = $('globe'), ctx = canvas.getContext('2d'), labels = $('labels');
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

  const DPR = () => Math.min(2, window.devicePixelRatio || 1);
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
  // proyección ortográfica a mano → Path2D/contexto. Devuelve false si algún vértice queda detrás del horizonte.
  const emitSeg = (p2, seg, M, close) => {
    const U = uOf(seg.pts), idx = seg.idx, n = idx ? idx.length : seg.pts.length;
    const { cl, sl, cf, sf, s, cx, cy } = M;
    let have = false, pu0 = 0, pu1 = 0, pu2 = 0;
    for (let j = 0; j < n; j++) {
      const i = idx ? idx[j] : j, u0 = U[i * 3], u1 = U[i * 3 + 1], u2 = U[i * 3 + 2];
      if (have) {
        const dot = u0 * pu0 + u1 * pu1 + u2 * pu2;
        if (dot < 0.99998) { // arista larga: se subdivide por el gran círculo, como hace d3
          const w = Math.acos(Math.max(-1, dot)); if (w > 2.5) return false;
          const m = Math.ceil(w / 0.0063), sw = Math.sin(w);
          for (let t = 1; t < m; t++) {
            const f = t / m, a = Math.sin((1 - f) * w) / sw, b = Math.sin(f * w) / sw;
            const q0 = a * pu0 + b * u0, q1 = a * pu1 + b * u1, q2 = a * pu2 + b * u2;
            const x0 = q0 * cl - q1 * sl, y0 = q0 * sl + q1 * cl;
            if (x0 * cf - q2 * sf < 0) return false;
            p2.lineTo(cx + s * y0, cy - s * (q2 * cf + x0 * sf));
          }
        }
      }
      const x0 = u0 * cl - u1 * sl, y0 = u0 * sl + u1 * cl;
      if (x0 * cf - u2 * sf < 0) return false;
      const X = cx + s * y0, Y = cy - s * (u2 * cf + x0 * sf);
      if (have) p2.lineTo(X, Y); else p2.moveTo(X, Y);
      have = true; pu0 = u0; pu1 = u1; pu2 = u2;
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
    return { loadBase, paintFallback, paintMask, render, clear, base: () => baseState, ready: () => ready && maskReady, maxK: TW / (2 * Math.PI * 280) / 1.1 };
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
  const draw = () => {
    raf = 0;
    if (!G || !W) return;
    projection.translate([W / 2, H / 2]).scale(R * S.k).rotate([S.rot[0], S.rot[1], 0]).clipExtent([[-4, -4], [W + 4, H + 4]]);
    const dpr = DPR();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const provMode = S.k >= PROV_K;
    const people = live();
    const c = center(), r = reach();
    if (GL && S.k < vectorFrom()) ensureTexture();
    const useGL = GL && S.k < vectorFrom() && GL.ready();
    const sphereR = R * S.k;
    // ¿toda la ventana cae dentro del disco? entonces la proyección a mano es exacta (sin horizonte que recortar)
    const inside = Math.hypot(W, H) / 2 + 40 < sphereR * 0.97 && r < 1.3;
    const vector = (fast) => {
      const set = G.hi || G.lo, cset = set;
      const V = unit(c), cr = Math.cos(r), sr = Math.sin(r);
      const M = { cl: Math.cos(S.rot[0] * RAD), sl: Math.sin(S.rot[0] * RAD), cf: Math.cos(S.rot[1] * RAD), sf: Math.sin(S.rot[1] * RAD), s: sphereR, cx: W / 2, cy: H / 2 };
      let bad = false;
      const disk = new Path2D(); disk.arc(W / 2, H / 2, sphereR, 0, 2 * Math.PI);
      const grad = ctx.createRadialGradient(W / 2 - sphereR * 0.35, H / 2 - sphereR * 0.4, sphereR * 0.1, W / 2, H / 2, sphereR);
      grad.addColorStop(0, colors.a); grad.addColorStop(1, colors.b);
      ctx.fillStyle = grad; ctx.fill(disk);
      // manchas del pergamino: multiplicar directamente sobre la forma (sin recortes de pantalla completa)
      const stainPat = ctx.createPattern(stains, 'repeat');
      const stain = (alpha, scale, p2) => { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = alpha; stainPat.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0])); ctx.fillStyle = stainPat; ctx.fill(p2); ctx.restore(); };
      stain(0.5, 1.2, disk);
      wmView(ctx, projection, c, disk);
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
      const lands = vc.map((f) => ({ f, p: cullPoly(f.geometry, V, cr, sr) }));
      const landP = polysPath(lands.map((x) => x.p));
      const coastRuns = []; for (const f of vk) cullLine(f.geometry.coordinates, V, cr, sr, coastRuns);
      const coastP = linesPath(coastRuns);
      if (bad) return false;
      // coast shadow in the water
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colors.ripple; ctx.globalAlpha = 0.16; ctx.lineWidth = 18; ctx.stroke(coastP);
      ctx.globalAlpha = 0.22; ctx.lineWidth = 8; ctx.stroke(coastP); ctx.globalAlpha = 1;
      // land
      ctx.fillStyle = colors.land; ctx.fill(landP);
      stain(0.75, 1, landP);
      ctx.save(); ctx.clip(landP); ctx.strokeStyle = colors.edge; ctx.globalAlpha = 0.22; ctx.lineWidth = 22; ctx.stroke(coastP); ctx.globalAlpha = 0.3; ctx.lineWidth = 8; ctx.stroke(coastP); ctx.restore(); ctx.globalAlpha = 1;
      // wine wash for the places with streamers
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = colors.hi;
      const A = 0.6;
      ctx.globalAlpha = A;
      // trazos discontinuos: cada tramo lleva su fase, así los guiones quedan fijos al mover el mapa
      const dashed = (runs, dash, color, width) => {
        const per = dash[0] + dash[1];
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.lineJoin = 'round';
        if (!fast) projection.clipExtent(null);
        for (const q of runs) {
          ctx.lineDashOffset = (q.d * sphereR) % per; ctx.beginPath();
          if (fast) { if (!emitSeg(ctx, q, M, false)) { bad = true; break; } } else { gp.context(ctx); gp(lineGeom(q)); }
          ctx.stroke();
        }
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
        projection.clipExtent([[-4, -4], [W + 4, H + 4]]);
      };
      let locP = null, vl = [];
      const wash = (cond) => polysPath(lands.filter((x) => cond(x.f.properties.code)).map((x) => x.p));
      if (!provMode) {
        const on = new Set(people.map((p) => p.country_code));
        ctx.fill(wash((code) => on.has(code)));
        ctx.restore();
      } else {
        // province fully coloured; at half strength when the streamer's locality is coloured on top
        const full = new Set(), half = new Set(), locs = [], cFull = new Set(), cHalf = new Set();
        for (const p of people) {
          const g = regionsOf(p, set);
          if (g.loc) locs.push(g.loc);
          if (g.prov) (g.loc ? half : full).add(g.prov);
          else (g.loc ? cHalf : cFull).add(p.country_code); // only the country was chosen
        }
        for (const id of full) half.delete(id);
        for (const id of cFull) cHalf.delete(id);
        ctx.fill(wash((code) => cFull.has(code)));
        ctx.globalAlpha = A * 0.5;
        ctx.fill(wash((code) => cHalf.has(code)));
        ctx.globalAlpha = A;
        const vp = [];
        for (const g of set.groups) if (d3.geoDistance(g.c, c) - g.rad < r) for (const f of g.fs) if (visV(f, V, r)) vp.push({ f, p: cullPoly(f.geometry, V, cr, sr) });
        ctx.fill(polysPath(vp.filter((x) => full.has(x.f.properties.pid)).map((x) => x.p)));
        ctx.globalAlpha = A * 0.5;
        ctx.fill(polysPath(vp.filter((x) => half.has(x.f.properties.pid)).map((x) => x.p)));
        ctx.globalAlpha = A;
        vl = locs.filter((f) => visV(f, V, r));
        locP = polysPath(vl.map((f) => cullPoly(f.geometry, V, cr, sr))); ctx.fill(locP);
        ctx.restore();
        const provRuns = []; for (const x of vp) for (const pl of x.p) for (const sg of pl) cullLine(sg.pts, V, cr, sr, provRuns);
        dashed(provRuns, [2, 3], colors.prov, 0.8);
        if (vl.length) { ctx.strokeStyle = colors.hi; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'; ctx.stroke(locP); }
      }
      if (bad) return false;
      // land borders dashed, coastline in ink
      const borderRuns = []; for (const f of vb) cullLine(f.geometry.coordinates, V, cr, sr, borderRuns);
      dashed(borderRuns, [6, 4], colors.border, provMode ? 1.4 : 1);
      ctx.strokeStyle = colors.line; ctx.lineWidth = provMode ? 1.8 : 1.3; ctx.lineCap = 'round'; ctx.stroke(coastP);
      // grano del papel
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.32; stainPat.setTransform(new DOMMatrix([380 / 512, 0, 0, 380 / 512, 0, 0])); ctx.fillStyle = stainPat; ctx.fill(disk); ctx.restore();
      return !bad;
    };
    if (useGL) {
      GL.render();
    } else {
      if (GL) GL.clear();
      if (!vector(inside)) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([]); ctx.clearRect(0, 0, W, H); vector(false); }
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
      if (st.hid !== !ok) { pin.hidden = !ok; st.hid = !ok; }
      if (!ok) continue;
      const px = W / 2 + sph * y0, py = H / 2 - sph * (v[2] * cf + x0 * sf);
      if (!(Math.abs(px - st.tx) <= 0.02) || !(Math.abs(py - st.ty) <= 0.02)) { st.tx = px; st.ty = py; pin.style.transform = `translate(${px.toFixed(2)}px, ${py.toFixed(2)}px)`; }
      if (pin.classList.contains('open')) {
        const card = pin._card || (pin._card = pin.querySelector('.card'));
        if (card && !card._size) card._size = [card.offsetWidth, card.offsetHeight];
        const ch = card ? card._size[1] : 260, half = (card ? card._size[0] : 290) / 2;
        const below = py - ch - 40 < 0 && py + ch + 20 < H;
        if (below !== st.below) { pin.classList.toggle('below', below); st.below = below; }
        let sh = 0; if (px - half < 8) sh = 8 + half - px; if (px + half > W - 8) sh = W - 8 - half - px;
        if (Math.abs(sh - st.shift) > 0.05 || st.shift !== st.shift) { pin.style.setProperty('--shift', sh + 'px'); st.shift = sh; }
      }
      const loc = pin._loc || (pin._loc = pin.querySelector('.pill-loc'));
      if (loc) {
        const lt = provMode ? (place(p.city, provinceLabel(p)) || p.country || '') : `${flag(p.country_iso2)} ${p.country || ''}`.trim();
        if (loc.dataset.t !== lt) { loc.dataset.t = lt; loc.replaceChildren(...(provMode ? [lt] : withFlag(p.country_iso2, p.country || ''))); }
      }
      order.push([py, pin, px]);
    }
    order.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < order.length; i++) { const e = order[i][1], z = 10 + i; if (e._st.z !== z) { e._st.z = z; e.style.zIndex = String(z); } }
    // lejos: solo la foto de perfil (con un poco de margen para que no parpadee al cruzar el umbral)
    const mini = S.mini = S.mini ? S.k < 1.05 : S.k < 0.95;
    if (labels._mini !== mini) { labels._mini = mini; labels.classList.toggle('mini', mini); }
    // las pastillas que se tapan se reparten: primero lo más cerca de su sitio (arriba, en diagonal o a un lado); el palito sigue unido a la ubicación real
    const PW = mini ? 42 : 165, PH = mini ? 42 : 42, STEP = mini ? 44 : 44;
    const offs = (S._offs || (S._offs = {}))[mini ? 1 : 0] || ((S._offs[mini ? 1 : 0]) = (() => {
      const o = [];
      for (const ox of mini ? [0, 22, -22, 44, -44] : [0, 45, -45, 90, -90, 135, -135, 173, -173]) for (let r = 0; r <= 12; r++) o.push([ox, r * STEP / 2, Math.hypot(ox, r * STEP / 2)]);
      return o.sort((p, q) => p[2] - q[2]);
    })());
    // los palitos no deben cruzarse entre sí ni atravesar otras pastillas: gana el sitio más cercano a su punto; un cruce solo cuesta un poco, así que nunca se alarga una pastilla por evitarlo
    const sx = (ax, ay, bx, by, cx, cy, dx, dy) => { const o = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px); return (o(ax, ay, bx, by, cx, cy) > 0) !== (o(ax, ay, bx, by, dx, dy) > 0) && (o(cx, cy, dx, dy, ax, ay) > 0) !== (o(cx, cy, dx, dy, bx, by) > 0); };
    const HW = PW / 2;
    const inPill = (ax, ay, bx, by, cx, cy) => { for (let t = 0.2; t <= 1.001; t += 0.2) { const px = ax + (bx - ax) * t, py = ay + (by - ay) * t; if (Math.abs(px - cx) < HW && py > cy - 67 && py < cy - 27) return true; } return false; };
    const placed = [];
    for (let j = order.length - 1; j >= 0; j--) {
      const [y, e, x] = order[j];
      let ox = 0, lift = 0;
      if (!e.classList.contains('open')) {
        let best = null, bestS = 1e9;
        for (const o of offs) {
          if (o[2] >= bestS) break;
          const cx = x + o[0], cy = y - o[1]; let hit = false, cr = 0;
          for (const q of placed) {
            if (Math.abs(q.cx - cx) < PW && Math.abs(q.cy - cy) < PH) { hit = true; break; }
            if (sx(x, y, cx, cy - 27, q.x, q.y, q.cx, q.cy - 27) || inPill(x, y, cx, cy - 27, q.cx, q.cy) || inPill(q.x, q.y, q.cx, q.cy - 27, cx, cy)) cr++;
          }
          if (hit) continue;
          const s = o[2] + cr * 25;
          if (s < bestS) { bestS = s; best = o; }
        }
        best = best || offs[offs.length - 1];
        ox = best[0]; lift = best[1];
      }
      const key = ox + ',' + lift;
      if (e._st.lift !== key) {
        e._st.lift = key;
        const pl = e._pill || (e._pill = e.querySelector('.pill')), sm = e._stem || (e._stem = e.querySelector('.pin-stem'));
        if (pl) pl.style.translate = ox || lift ? ox + 'px ' + (-lift) + 'px' : '';
        if (sm) sm.style.transform = ox || lift ? 'rotate(' + Math.atan2(ox, 24 + lift) + 'rad) scaleY(' + (Math.hypot(ox, 24 + lift) / 24) + ')' : '';
      }
      placed.push({ x, y, cx: x + ox, cy: y - lift });
    }
    const chipT = provMode ? 'Vista: provincias' : 'Vista: países';
    if (chipEl.textContent !== chipT) chipEl.textContent = chipT;
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
    if (document.hidden || polling) return;
    polling = true; lastPoll = Date.now();
    try {
      const r = await fetch('live.json?t=' + Math.floor(Date.now() / 30000), { cache: 'no-store' });
      const d = await r.json();
      if (Date.now() - Date.parse(d.t) > 20 * 60000) throw 0; // dato caducado: mejor no mostrar nada que mostrar algo falso
      const on = new Set(d.live);
      for (const p of live()) { LIVE.set(p.twitch, on.has(p.twitch)); paintLive(p.twitch); }
      saveLive();
    } catch { for (const p of live()) { LIVE.delete(p.twitch); paintLive(p.twitch); } } finally { polling = false; }
  };
  let polling = false, lastPoll = 0;
  const needLive = () => { if (Date.now() - lastPoll > 20000 && live().some((p) => !LIVE.has(p.twitch))) pollLive(); };
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
    pins.clear(); labels.replaceChildren();
    live().forEach((p, i) => {
      const pin = el('div', 'pin'); pin.dataset.login = p.twitch; { const v = LIVE.get(p.twitch); if (v === true) pin.classList.add('is-live'); else if (v === false) pin.classList.add('is-off'); }
      const fl = el('div', 'pin-float bob'); fl.style.animationDelay = (i % 7) * 0.45 + 's';
      fl.append(el('div', 'pin-stem'));
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
      labels.append(pin); pins.set(p.twitch, pin);
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
    const shift = parseFloat(pin.style.getPropertyValue('--shift')) || 0;
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
    const a = el('a', 'card-name', p.name || p.twitch); a.href = twitchUrl(p.twitch); a.target = '_blank'; a.rel = 'noopener noreferrer';
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
    const liveA = el('a', 'live', 'Ver directo en Twitch'); liveA.href = twitchUrl(p.twitch); liveA.target = '_blank'; liveA.rel = 'noopener noreferrer';
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

  const renderSummary = () => {
    const ps = live();
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
