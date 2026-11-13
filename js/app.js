(function () {
  'use strict';

  const { parse, findList, INBOX_NAME } = window.VoiceParser;
  const STORAGE_KEY = 'dilo.v1';
  const VERSION = '0.17.1';
  const $ = (id) => document.getElementById(id);
  window.DILO_VERSION = VERSION;

  // ---------- Datos ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const EMOJIS = {
    'bandeja de entrada': '📥', tareas: '✅', compra: '🛒', compras: '🛒', ideas: '💡',
    regalos: '🎁', viajes: '✈️', viaje: '✈️', libros: '📚', peliculas: '🎬', series: '📺',
    trabajo: '💼', casa: '🏠', recetas: '🍳', musica: '🎵', deporte: '🏃', salud: '🩺',
  };
  const emojiFor = (name) => {
    const n = window.VoiceParser.normalize(name);
    if (EMOJIS[n]) return EMOJIS[n];
    const key = Object.keys(EMOJIS).find((k) => n.startsWith(k));
    return key ? EMOJIS[key] : '📝';
  };

  function defaultState() {
    const s = {
      lists: [INBOX_NAME, 'Tareas', 'Compra', 'Ideas'].map((name) => ({
        id: uid(), name, emoji: emojiFor(name), items: [],
      })),
    };
    // En la demo publicada se muestran unos ejemplos para ver cómo queda
    if (window.DILO_DEMO) {
      const ex = { [INBOX_NAME]: ['Ejemplo: una app que traduzca a los perros'],
        Tareas: ['Ejemplo: llamar al dentista'], Compra: ['Ejemplo: leche', 'Ejemplo: pan'] };
      s.lists.forEach((l) => (ex[l.name] || []).forEach((t) =>
        l.items.push({ id: uid(), text: t, done: false, createdAt: Date.now() })));
    }
    return s;
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.lists)) {
        if (!s.lists.some((l) => l.name === INBOX_NAME)) {
          s.lists.unshift({ id: uid(), name: INBOX_NAME, emoji: '📥', items: [] });
        }
        return s;
      }
    } catch (e) { /* datos corruptos o almacenamiento bloqueado */ }
    return defaultState();
  }

  let state = load();
  let undoSnapshot = null;
  let currentListId = null;
  const recienApuntados = new Set();    // para resaltar lo que se acaba de apuntar

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('⚠️ No se pudo guardar en este dispositivo'); }
    pushCloud();
  }

  // ---------- Nube: listas compartidas con la casa ----------
  // En la nube cada lista es un documento de «listas» y cada cosa apuntada uno de «items».
  // Quién apuntó cada cosa, quién la hizo y su etiqueta van aparte, en «detalles» (mismo id que
  // la cosa): así, si queda abierta en algún sitio una versión antigua de Dilo que reescribe
  // «items» con solo los campos que conoce, no borra esos datos.
  // Al guardar se suben solo los cambios; lo que llega de otro móvil reemplaza el estado.
  // Las listas privadas («Solo para mí») van en otro sitio de la nube, usuarios/{uid}, que solo
  // puede leer su dueño (lo protegen las reglas de Firebase): a los demás móviles ni les llegan.
  // FUENTES: 'casa' (lo compartido) y 'mia' (lo privado), cada una con sus tres colecciones.
  let nubeDB = null;           // base de la casa
  let miaDB = null;            // base privada
  let miaOk = false;           // el sitio privado funciona (si faltan las reglas, da «sin permiso»)
  let nubeUnsubs = [];
  let nubeMigrada = false;
  const COLECCIONES = ['listas', 'items', 'detalles'];
  const FUENTES = ['casa', 'mia'];
  const vacio = (v) => Object.fromEntries(COLECCIONES.map((c) => [c, typeof v === 'function' ? v() : v]));
  const nubeDocs = { casa: vacio(() => []), mia: vacio(() => []) };
  const nubeListo = { casa: vacio(false), mia: vacio(false) };   // ya llegó la respuesta del servidor
  const subido = { casa: vacio(() => new Map()), mia: vacio(() => new Map()) };  // lo último que hay en la nube
  const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  const limpio = (o) => JSON.parse(JSON.stringify(o));

  // Datos de la nube que esta versión de Dilo no usa (p. ej. de una versión más nueva):
  // se guardan en «otros» y se vuelven a subir tal cual, para no borrarlos nunca.
  const CAMPOS_LISTA = ['name', 'emoji', 'orden'];
  const CAMPOS_ITEM = ['listId', 'text', 'done', 'createdAt', 'audioId', 'by', 'doneBy', 'doneAt', 'etiqueta'];
  const CAMPOS_DETALLE = ['by', 'doneBy', 'doneAt', 'etiqueta'];
  function otrosCampos(data, conocidos) {
    const o = {};
    for (const k of Object.keys(data)) if (!conocidos.includes(k)) o[k] = data[k];
    return Object.keys(o).length ? o : null;
  }

  // Cada lista guarda su puesto («orden») y lo conserva aunque pase un tiempo siendo privada:
  // así vuelve a su sitio y todos los móviles ordenan igual (antes se numeraban según las que
  // veía cada móvil, y al esconder una privada se descolocaban las demás).
  function ponerOrden() {
    const conOrden = state.lists.filter((l) => typeof l.orden === 'number');
    let max = conOrden.length ? Math.max(...conOrden.map((l) => l.orden)) : -1;
    let min = conOrden.length ? Math.min(...conOrden.map((l) => l.orden)) : 0;
    for (const l of state.lists) {
      if (typeof l.orden === 'number') continue;
      l.orden = l.name === INBOX_NAME ? --min : ++max;
    }
  }
  const porOrden = (a, b) => (a.orden ?? 0) - (b.orden ?? 0) || (a.id < b.id ? -1 : 1);

  function docsLocales(fuente) {
    const mias = fuente === 'mia';
    ponerOrden();
    const listas = [];
    const items = [];
    const detalles = [];
    state.lists.forEach((l, i) => {
      if (!!l.privada !== mias) return;
      listas.push({ id: l.id, data: { ...(l.otros || {}), name: l.name, emoji: l.emoji || emojiFor(l.name), orden: l.orden ?? i } });
      for (const it of l.items) {
        const d = { ...(it.otros || {}), listId: l.id, text: it.text, done: !!it.done, createdAt: it.createdAt || 0 };
        if (it.audioId) d.audioId = it.audioId;
        items.push({ id: it.id, data: d });
        const x = {};
        if (it.by) x.by = it.by;
        if (it.done && it.doneBy) x.doneBy = it.doneBy;
        if (it.done && it.doneAt) x.doneAt = it.doneAt;
        if (it.etiqueta) x.etiqueta = it.etiqueta;
        if (Object.keys(x).length) detalles.push({ id: it.id, data: x });
      }
    });
    return { listas, items, detalles };
  }

  function fallaNube(e) {
    if (e && e.code === 'permission-denied') toast('⚠️ No tienes permiso en esta casa. Revisa la invitación.');
  }

  function pushCloud() {
    if (!nubeDB || !nubeMigrada) return;
    // Primero se guarda todo y después se borra: así, al pasar una lista de compartida a privada
    // (o al revés), primero aparece en su sitio nuevo y luego se quita del viejo
    const borrar = [];
    for (const fuente of FUENTES) {
      const base = fuente === 'casa' ? nubeDB : (miaOk ? miaDB : null);
      if (!base) continue;
      const locales = docsLocales(fuente);
      for (const col of COLECCIONES) {
        const mapa = subido[fuente][col];
        const ids = new Set();
        for (const d of locales[col]) {
          ids.add(d.id);
          const c = canon(d.data);
          if (mapa.get(d.id) !== c) { mapa.set(d.id, c); base.collection(col).doc(d.id).set(limpio(d.data)).catch(fallaNube); }
        }
        for (const id of [...mapa.keys()]) {
          if (!ids.has(id)) { mapa.delete(id); borrar.push([base, col, id]); }
        }
      }
    }
    for (const [base, col, id] of borrar) base.collection(col).doc(id).delete().catch(fallaNube);
  }

  // Construye las listas a partir de lo que hay en la nube (lo de la casa y lo privado)
  function estadoDeLaNube() {
    const lists = [];
    for (const fuente of FUENTES) {
      for (const d of nubeDocs[fuente].listas) {
        // Mientras se pasa de un sitio a otro puede estar en los dos un momento: vale lo de este móvil
        const ya = lists.findIndex((x) => x.id === d.id);
        if (ya >= 0) {
          const local = getList(d.id);
          if (!local || !!local.privada !== (fuente === 'mia')) continue;
          lists.splice(ya, 1);
        }
        const l = { id: d.id, name: d.data.name || 'Lista', emoji: d.data.emoji || emojiFor(d.data.name || ''), items: [], orden: d.data.orden || 0 };
        if (fuente === 'mia') l.privada = true;
        const otros = otrosCampos(d.data, CAMPOS_LISTA);
        if (otros) l.otros = otros;
        lists.push(l);
      }
    }
    lists.sort(porOrden);
    const porId = new Map(lists.map((l) => [l.id, l]));
    const vistos = new Set();
    for (const fuente of FUENTES) {
      const detalles = new Map(nubeDocs[fuente].detalles.map((d) => [d.id, d.data]));
      for (const d of nubeDocs[fuente].items) {
        const l = porId.get(d.data.listId);
        if (!l || vistos.has(d.id)) continue;
        vistos.add(d.id);
        const it = { id: d.id, text: d.data.text || '', done: !!d.data.done, createdAt: d.data.createdAt || 0 };
        if (d.data.audioId) it.audioId = d.data.audioId;
        // Lo de «detalles» manda; si no hay, lo que se guardaba antes dentro de la cosa (versión 0.8)
        const x = detalles.get(d.id) || {};
        for (const k of CAMPOS_DETALLE) { const v = x[k] || d.data[k]; if (v) it[k] = v; }
        const otros = otrosCampos(d.data, CAMPOS_ITEM);
        if (otros) it.otros = otros;
        l.items.push(it);
      }
    }
    lists.forEach((l) => l.items.sort((a, b) => b.createdAt - a.createdAt));
    return { lists };
  }

  function recordarSubido() {
    for (const fuente of FUENTES) {
      for (const col of COLECCIONES) {
        subido[fuente][col] = new Map(nubeDocs[fuente][col].map((d) => [d.id, canon(d.data)]));
      }
    }
  }

  // Si el sitio privado no funciona (faltan las reglas o no hay conexión), las listas privadas
  // que ya había en este móvil se conservan tal cual en vez de desaparecer
  function conservarPrivadas(nube) {
    if (!miaOk) {
      for (const l of state.lists) if (l.privada && !nube.lists.some((x) => x.id === l.id)) nube.lists.push(l);
    }
    // Una lista que acaba de pasar de compartida a privada (o al revés): la nube avisa por partes
    // y durante un momento puede faltar o estar a medias, así que se usa la de este móvil
    const ahora = Date.now();
    for (const [id, hasta] of enCamino) {
      if (hasta < ahora) { enCamino.delete(id); continue; }
      const local = getList(id);
      if (!local) continue;
      const i = nube.lists.findIndex((x) => x.id === id);
      if (i >= 0) nube.lists[i] = local;
      else nube.lists.push(local);
      const suyos = new Set(local.items.map((x) => x.id));
      for (const l of nube.lists) if (l !== local) l.items = l.items.filter((x) => !suyos.has(x.id));
    }
    nube.lists.sort(porOrden);
  }
  const enCamino = new Map();   // id de lista → hasta cuándo se protege

  // Para hacer algo cuando ya están las listas (de la nube, si se usa): p. ej. apuntar lo compartido
  let listoYa = false;
  const alListo = [];
  function cuandoListo(fn) { if (listoYa) fn(); else alListo.push(fn); }
  function marcarListo() { if (listoYa) return; listoYa = true; alListo.splice(0).forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }
  setTimeout(marcarListo, 6000);

  const claveMigrada = () => 'dilo:nube:' + nubeDB.hogarId;

  // Primera vez en este móvil: juntar lo que había aquí con lo que hay en la nube.
  // Las listas con el mismo nombre se unen; no se borra nada.
  function migrarAlaNube() {
    const nube = estadoDeLaNube();
    const norm = (n) => window.VoiceParser.normalize(n);
    let nuevas = 0;
    for (const local of state.lists) {
      let destino = nube.lists.find((l) => l.id === local.id) || nube.lists.find((l) => norm(l.name) === norm(local.name) && !!l.privada === !!local.privada);
      if (!destino) {
        destino = { id: local.id, name: local.name, emoji: local.emoji, items: [] };
        if (local.privada) destino.privada = true;
        nube.lists.push(destino);
      }
      for (const it of local.items) {
        if (!nube.lists.some((l) => l.items.some((x) => x.id === it.id))) {
          // Lo que solo estaba en este móvil lo apuntó quien lo usa
          if (!it.by && yoCorreo()) it.by = yoCorreo();
          destino.items.push(it); nuevas++;
        }
      }
      destino.items.sort((a, b) => b.createdAt - a.createdAt);
    }
    if (!nube.lists.some((l) => l.name === INBOX_NAME)) nube.lists.unshift({ id: uid(), name: INBOX_NAME, emoji: '📥', items: [] });
    state = nube;
    recordarSubido();
    nubeMigrada = true;
    try { localStorage.setItem(claveMigrada(), '1'); } catch (e) {}
    if (currentListId && !getList(currentListId)) currentListId = null;
    save();      // sube lo que faltaba
    render();
    if (nuevas) toast(`☁️ ${nuevas} ${nuevas === 1 ? 'cosa apuntada pasada' : 'cosas apuntadas pasadas'} a la nube`);
    marcarListo();
  }

  function alCambiarLaNube() {
    if (FUENTES.some((f) => COLECCIONES.some((c) => !nubeListo[f][c]))) return;
    if (!nubeMigrada) { migrarAlaNube(); return; }
    const nube = estadoDeLaNube();
    conservarPrivadas(nube);
    if (!nube.lists.some((l) => l.name === INBOX_NAME)) nube.lists.unshift({ id: uid(), name: INBOX_NAME, emoji: '📥', items: [] });
    state = nube;
    recordarSubido();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    pushCloud();   // por si hubo que crear la bandeja
    if (currentListId && !getList(currentListId)) currentListId = null;
    render();
    marcarListo();
  }

  function conectarListas(base, baseMia) {
    nubeUnsubs.forEach((u) => { try { u(); } catch (e) {} });
    nubeUnsubs = [];
    nubeDB = base;
    miaDB = base ? baseMia : null;
    miaOk = false;
    for (const f of FUENTES) for (const c of COLECCIONES) { nubeListo[f][c] = false; nubeDocs[f][c] = []; }
    if (!base) { nubeMigrada = false; return; }
    nubeMigrada = (() => { try { return localStorage.getItem(claveMigrada()) === '1'; } catch (e) { return false; } })();
    for (const fuente of FUENTES) {
      const b = fuente === 'casa' ? base : miaDB;
      for (const col of COLECCIONES) {
        if (!b) { nubeListo[fuente][col] = true; continue; }
        nubeUnsubs.push(b.collection(col).onSnapshot((snap) => {
          nubeDocs[fuente][col] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
          if (fuente === 'mia' && !snap.metadata.fromCache) miaOk = true;
          // Para juntar por primera vez esperamos la respuesta del servidor, no solo la caché
          if (!snap.metadata.fromCache || nubeMigrada) nubeListo[fuente][col] = true;
          alCambiarLaNube();
        }, (e) => {
          if (fuente === 'casa') { fallaNube(e); return; }
          // Sin permiso en lo privado (faltan las reglas nuevas): seguimos sin listas privadas en la nube
          miaOk = false;
          for (const c of COLECCIONES) nubeListo.mia[c] = true;
          alCambiarLaNube();
        }));
      }
    }
  }

  function snapshot() { undoSnapshot = JSON.stringify(state); }

  const inbox = () => state.lists.find((l) => l.name === INBOX_NAME);
  const getList = (id) => state.lists.find((l) => l.id === id);

  function ensureList(name) {
    let list = findList(state.lists, name);
    if (!list) {
      list = { id: uid(), name, emoji: emojiFor(name), items: [] };
      state.lists.push(list);
      ponerOrden();
    }
    return list;
  }

  // Correo de quien usa este móvil (si ha entrado con Google), para saber quién apuntó cada cosa
  const yoCorreo = () => {
    const N = window.DiloNube;
    return N && N.usuario ? N.usuario.correo : '';
  };

  // Marcar o desmarcar como hecha, guardando quién y cuándo
  function marcarHecha(item, hecha) {
    item.done = hecha;
    if (hecha) {
      item.doneAt = Date.now();
      if (yoCorreo()) item.doneBy = yoCorreo(); else delete item.doneBy;
    } else {
      delete item.doneAt; delete item.doneBy;
    }
  }

  function addItems(list, texts, extra = {}) {
    const ahora = Date.now();
    if (yoCorreo()) extra = { by: yoCorreo(), ...extra };
    [...texts].reverse().forEach((text, i) => {
      const id = uid();
      recienApuntados.add(id);
      list.items.unshift({ id, text, done: false, createdAt: ahora + i, ...extra });
    });
  }

  // ---------- Audio (IndexedDB) ----------
  const DB_NAME = 'dilo-audio';
  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('clips');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function putAudio(id, blob) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction('clips', 'readwrite');
      tx.objectStore('clips').put(blob, id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function getAudio(id) {
    const d = await db();
    return new Promise((res, rej) => {
      const r = d.transaction('clips').objectStore('clips').get(id);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function deleteAudio(id) {
    try {
      const d = await db();
      d.transaction('clips', 'readwrite').objectStore('clips').delete(id);
    } catch (e) { /* nada que borrar */ }
  }

  // ---------- Procesar lo dicho/escrito ----------
  // ---- Borrar o marcar como hecho por voz ----
  // Busca lo que se ha dicho entre lo apuntado aunque no se diga igual («la leche» → «Leche entera»)
  const ARTIC = /^(?:(?:el|la|los|las|un|una|unos|unas)\s+)+/;
  const clave = (t) => window.VoiceParser.normalize(t)
    .replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(ARTIC, '')
    .split(' ').map((w) => (w.length > 3 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).join(' ');
  function buscarCosa(dicho, listaDicha, soloPendientes) {
    const q = clave(dicho);
    if (!q) return null;
    const palabras = q.split(' ');
    const abierta = getList(currentListId);
    const donde = listaDicha ? [findList(state.lists, listaDicha)].filter(Boolean) : state.lists;
    let mejor = null;
    for (const l of donde) {
      for (const it of l.items) {
        if (soloPendientes && it.done) continue;
        const k = clave(it.text);
        if (!k) continue;
        const kp = k.split(' ');
        const puntos = k === q ? 4
          : k.startsWith(q + ' ') || q.startsWith(k + ' ') ? 3
          : palabras.every((w) => kp.includes(w)) ? 2
          : palabras.every((w) => k.includes(w)) ? 1 : 0;
        if (!puntos) continue;
        // A igualdad, mejor lo pendiente, lo de la lista abierta y lo más reciente
        const extra = (it.done ? 0 : 0.4) + (abierta && l.id === abierta.id ? 0.2 : 0) + (it.createdAt || 0) / 1e15;
        const total = puntos + extra;
        if (!mejor || total > mejor.total) mejor = { list: l, item: it, total };
      }
    }
    return mejor;
  }

  async function quitarPorVoz(result, textoOriginal) {
    const hechos = [];
    const noEncontrados = [];
    snapshot();
    for (const dicho of result.items) {
      const r = buscarCosa(dicho, result.list, result.type === 'done');
      if (!r) { noEncontrados.push(dicho); continue; }
      if (result.type === 'delete') r.list.items = r.list.items.filter((i) => i.id !== r.item.id);
      else marcarHecha(r.item, true);
      hechos.push(r);
    }
    if (hechos.length) {
      save(); render();
      const que = hechos.length === 1 ? `«${hechos[0].item.text}»` : `${hechos.length} cosas`;
      const donde = new Set(hechos.map((h) => h.list.name)).size === 1 ? ` de ${hechos[0].list.emoji} ${hechos[0].list.name}` : '';
      const falta = noEncontrados.length ? ` · No encuentro «${noEncontrados.join('», «')}»` : '';
      toast(result.type === 'delete' ? `🗑️ Borrado ${que}${donde}${falta}` : `✅ Hecho ${que}${donde}${falta}`, true);
      return;
    }
    undoSnapshot = null;
    // No hay nada parecido: quizá era algo para apuntar («quitar el polvo»)
    const lista = result.list ? ` en ${result.list}` : '';
    if (await ask(`No encuentro «${noEncontrados.join('», «')}»${lista}. ¿Lo apunto como algo nuevo?`, null, 'Apuntarlo')) {
      const destino = getList(currentListId) || inbox();
      snapshot();
      const t = textoOriginal.trim();
      addItems(destino, [t.charAt(0).toUpperCase() + t.slice(1)]);
      save(); render();
      toast(`${destino.emoji} Apuntado en ${destino.name}`, true);
    }
  }

  // ---- Citas por voz → «Mi agenda» ----
  // «cita con el dentista el martes a las 10 para Julia»: se guarda como en agenda.html
  // (en la nube de la casa, en «citas», o en este móvil si no hay nube)
  function datosAgenda() {
    const lee = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
    const familia = lee('agenda:m2') || lee('agenda:miembros') || [];
    const aj = lee('agenda:aj') || {};
    const tipos = Array.isArray(aj.tipos) && aj.tipos.length ? aj.tipos
      : [{ id: 'medica', n: 'Médica' }, { id: 'trabajo', n: 'Trabajo' }, { id: 'tramite', n: 'Trámite' }, { id: 'personal', n: 'Personal' }, { id: 'otra', n: 'Otra' }];
    return { familia, tipos, aj };
  }
  const CLAVE_CITAS = () => {
    const N = window.DiloNube;
    if (N && N.estado === 'dentro') return 'agenda:c2';
    try { return localStorage.getItem('agenda:c2') ? 'agenda:c2' : 'agenda:v1'; } catch (e) { return 'agenda:v1'; }
  };
  function citasLocales(clave) { try { return JSON.parse(localStorage.getItem(clave)) || []; } catch (e) { return []; } }

  async function guardarCita(c) {
    if (!c.fecha) {
      toast(`📅 Para apuntar «${c.titulo}» en la agenda dime también el día (por ejemplo, «el martes a las 10»)`);
      return;
    }
    const { familia, aj } = datosAgenda();
    const cita = {
      id: uid(), titulo: c.titulo, cat: c.cat, fecha: c.fecha, hora: c.hora, lugar: c.lugar, persona: c.persona,
      notas: '', aviso: c.fecha < hoyISO() ? 'none' : '1d', de: c.de, fotos: [], creada: Date.now(),
    };
    if (yoCorreo()) cita.por = yoCorreo();
    const clave = CLAVE_CITAS();
    const lista = citasLocales(clave);
    lista.push(cita);
    try { localStorage.setItem(clave, JSON.stringify(lista)); } catch (e) {}
    const N = window.DiloNube;
    const base = N && N.estado === 'dentro' ? N.db() : null;
    if (base) base.collection('citas').doc(cita.id).set(JSON.parse(JSON.stringify(cita))).catch(fallaNube);
    render();
    // Aviso: «📅 Dentista · mar 17 nov · 10:00 · Julia»
    const [y, m, d] = cita.fecha.split('-').map(Number);
    const dia = new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
    const quien = cita.de === 'familia' ? ((aj.familia && aj.familia.n) || 'Toda la familia') : (familia.find((p) => p.id === cita.de) || {}).n;
    const resumen = [cita.titulo, dia, cita.hora, cita.lugar, quien].filter(Boolean).join(' · ');
    toast(`📅 Cita guardada: ${resumen}`, () => {
      const l = citasLocales(clave).filter((x) => x.id !== cita.id);
      try { localStorage.setItem(clave, JSON.stringify(l)); } catch (e) {}
      if (base) base.collection('citas').doc(cita.id).delete().catch(fallaNube);
      render();
      toast('Cita borrada');
    });
    // Notificación de confirmación (en las citas sí, aunque Dilo esté abierta); al tocarla, se abre la cita
    if (canNotify() && Notification.permission === 'granted') {
      try {
        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 3000))]);
        if (reg) await reg.showNotification('✅ Apuntado en Mi agenda', {
          body: resumen + '\nToca para revisarlo', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
          tag: 'agenda-' + Date.now(), data: { agenda: true, citaId: cita.id },
        });
      } catch (e) { /* sin notificación: queda el aviso en pantalla */ }
    }
  }

  function handleInput(text) {
    const cita = window.DiloCitas ? window.DiloCitas.parse(text, datosAgenda()) : null;
    if (cita) { guardarCita(cita); return; }
    const result = parse(text, state.lists);
    if (!result) return;
    if (result.type === 'delete' || result.type === 'done') { quitarPorVoz(result, text); return; }
    snapshot();

    // Si estás dentro de una lista y no nombras otra, va a la lista que tienes abierta
    const open = getList(currentListId);
    if (result.type === 'inbox' && open && open.name !== INBOX_NAME) {
      const items = window.VoiceParser.splitItems(result.items[0]);
      addItems(open, items);
      save(); render();
      const what = items.length === 1 ? `«${items[0]}»` : `${items.length} elementos`;
      toast(`${open.emoji} ${what} → ${open.name}`, true);
      notifySaved(open, items);
      return;
    }

    if (result.type === 'create') {
      // «Crea una lista privada de regalos»: la crea solo para quien la dice
      const priv = result.list.match(/^(?:privad[ao]|personal|solo para mi|solo para mí)\s+(?:de\s+|para\s+|que se llame\s+)?/i);
      if (priv && result.list.length > priv[0].length) {
        result.list = result.list.slice(priv[0].length).replace(/^./, (c) => c.toUpperCase());
        result.privada = true;
      }
      const exists = findList(state.lists, result.list);
      const list = ensureList(result.list);
      if (result.privada && !exists) {
        const N = window.DiloNube;
        if (N && N.estado === 'dentro' && miaOk) list.privada = true;
        else toast('⚠️ La lista se ha creado compartida: las privadas aún no funcionan (faltan las reglas de Firebase).');
      }
      if (result.items && result.items.length) {
        addItems(list, result.items);
        save(); render();
        const what = result.items.length === 1 ? `«${result.items[0]}»` : `${result.items.length} elementos`;
        toast(`${list.emoji} ${exists ? '' : list.privada ? 'Lista nueva privada 🔒 · ' : 'Lista nueva · '}${what} → ${list.name}`, true);
        notifySaved(list, result.items);
        return;
      }
      save(); render();
      toast(exists ? `La lista «${list.name}» ya existía` : `Lista «${list.name}» creada${list.privada ? ' 🔒 (solo para ti)' : ''}`, true);
      return;
    }

    const list = result.type === 'inbox' ? inbox() : ensureList(result.list);
    addItems(list, result.items);
    save(); render();
    const what = result.items.length === 1 ? `«${result.items[0]}»` : `${result.items.length} elementos`;
    toast(`${list.emoji} ${what} → ${list.name}${result.created ? ' (nueva)' : ''}`, true);
    notifySaved(list, result.items);
  }

  // ---------- Voz ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const micBtn = $('micBtn');
  const live = $('live');
  let recognition = null;
  let listening = false;
  let finalText = '';
  let mediaRecorder = null;

  function setRecording(on, msg = '') {
    listening = on;
    micBtn.classList.toggle('recording', on);
    micBtn.setAttribute('aria-label', on ? 'Parar' : 'Hablar');
    live.textContent = msg;
  }

  function startRecognition() {
    recognition = new SR();
    recognition.lang = 'es-ES';
    recognition.interimResults = true;
    // En Android, el modo continuo repite lo ya dicho en cada resultado.
    // Allí escuchamos una sola frase (se para sola al dejar de hablar).
    recognition.continuous = !IS_ANDROID;
    recognition.maxAlternatives = 1;
    finalText = '';
    let lastInterim = '';
    let failedOver = false;

    recognition.onresult = (e) => {
      // En Android cada resultado puede traer la frase entera otra vez:
      // nos quedamos solo con el más largo y no los sumamos.
      if (IS_ANDROID) {
        let best = '';
        for (let i = 0; i < e.results.length; i++) {
          const t = e.results[i][0].transcript.trim();
          if (t.length > best.length) best = t;
        }
        finalText = best;
        lastInterim = '';
        live.textContent = best || 'Escuchando…';
        return;
      }
      let text = '';
      lastInterim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript.trim();
        if (!t) continue;
        if (!r.isFinal) { lastInterim = t; continue; }
        // Si un resultado ya contiene todo lo anterior, lo sustituye en vez de sumarse
        const a = text.toLowerCase();
        const b = t.toLowerCase();
        if (b.startsWith(a)) text = t;
        else if (!a.endsWith(b)) text = (text + ' ' + t).trim();
      }
      finalText = text;
      live.textContent = (finalText + ' ' + lastInterim).trim() || 'Escuchando…';
    };
    recognition.onerror = (e) => {
      if (e.error === 'network' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') {
        // Sin conexión o sin servicio: no perder la idea, grabamos audio
        failedOver = true;
        setRecording(false);
        startAudioRecording();
      } else if (e.error === 'not-allowed') {
        setRecording(false);
        toast('Permite el acceso al micrófono para usar la voz');
      }
    };
    recognition.onend = () => {
      if (failedOver) return;
      setRecording(false);
      const text = (finalText || lastInterim).trim();
      if (text) handleInput(text);
      recognition = null;
    };
    recognition.start();
    setRecording(true, recognition.continuous ? 'Escuchando… pulsa otra vez para terminar' : 'Escuchando… habla ahora');
  }

  async function startAudioRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      toast('Aquí no se puede usar el micrófono. Escríbelo abajo.');
      $('textInput').focus();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        mediaRecorder = null;
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
        const audioId = uid();
        try {
          await putAudio(audioId, blob);
          snapshot();
          addItems(inbox(), ['🎙️ Nota de voz'], { audioId });
          save(); render();
          toast('🎙️ Nota de voz guardada en la Bandeja de entrada');
        } catch (e) {
          toast('⚠️ No se pudo guardar el audio');
        }
      };
      mediaRecorder.start();
      setRecording(true, '🎙️ Grabando audio (sin reconocimiento)… pulsa para terminar');
    } catch (e) {
      setRecording(false);
      toast('No hay acceso al micrófono. Permítelo o escríbelo abajo.');
      $('textInput').focus();
    }
  }

  micBtn.addEventListener('click', () => {
    askNotifyPermission();
    if (listening) {
      if (recognition) recognition.stop();
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      return;
    }
    if (SR && navigator.onLine) {
      try { startRecognition(); return; } catch (e) { /* cae al modo audio */ }
    }
    startAudioRecording();
  });

  // ---------- Texto ----------
  $('textForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('textInput');
    const text = input.value.trim();
    if (!text) return;
    handleInput(text);
    input.value = '';
    renderComposer();
  });

  // ---------- Notificación de confirmación ----------
  // Tras apuntar algo con Dilo cerrada o en segundo plano (p. ej. con un atajo), sale un aviso en el
  // móvil; al tocarlo se abre la lista. Con Dilo abierta no hace falta: se ve en la pantalla.
  // (Las citas de la agenda tienen su propio aviso, en agenda.html.)
  const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator;

  function askNotifyPermission() {
    if (canNotify() && Notification.permission === 'default') {
      Notification.requestPermission().then(renderNotifyBtn).catch(() => {});
    }
  }

  async function notifySaved(list, items) {
    if (!canNotify() || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((r) => setTimeout(() => r(null), 3000)),
      ]);
      if (!reg) return;
      await reg.showNotification(`✅ Apuntado en ${list.name}`, {
        body: items.join(' · ') + '\nToca para revisarlo',
        icon: 'icons/icon-192.png',
        badge: 'icons/badge-96.png',
        tag: 'dilo-' + Date.now(),
        data: { listId: list.id },
      });
    } catch (e) { /* sin notificaciones: queda el aviso dentro de la app */ }
  }

  function renderNotifyBtn() {
    const b = $('notifyBtn');
    if (!canNotify()) { b.hidden = true; return; }
    const p = Notification.permission;
    b.textContent = p === 'granted' ? '🔔 Notificaciones activadas'
      : p === 'denied' ? '🔕 Notificaciones bloqueadas (actívalas en Ajustes del móvil)'
      : '🔔 Activar notificaciones';
    b.disabled = p !== 'default';
  }

  function openList(id) {
    if (!getList(id)) return;
    currentListId = id;
    render();
    window.scrollTo(0, 0);
  }

  // ---------- Diálogo propio (sustituye a prompt/confirm) ----------
  // ask(titulo, valor) -> texto o null; ask(titulo, null, 'Botón') -> true/false
  function ask(title, value, okLabel = 'Guardar') {
    const dlg = $('askDialog');
    const input = $('askInput');
    const isConfirm = value === null;
    $('askTitle').textContent = title;
    $('askOk').textContent = okLabel;
    $('askOk').classList.toggle('danger-btn', isConfirm && okLabel !== 'Apuntarlo');
    input.hidden = isConfirm;
    input.value = value || '';
    return new Promise((resolve) => {
      const done = (ok) => {
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        if (isConfirm) resolve(ok);
        else resolve(ok && input.value.trim() ? input.value.trim() : null);
      };
      const onClose = () => done(dlg.returnValue === 'ok');
      dlg.returnValue = '';
      dlg.addEventListener('close', onClose);
      input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); dlg.close('ok'); } };
      dlg.showModal();
      if (!isConfirm) { input.focus(); input.select(); }
    });
  }

  // ---------- Toast con deshacer ----------
  let toastTimer;
  // deshacerOtro: para deshacer algo que no son las listas (p. ej. una cita guardada por voz)
  let deshacerOtro = null;
  function toast(msg, undoable = false) {
    $('toastMsg').textContent = msg;
    if (typeof undoable === 'function') { deshacerOtro = undoable; undoable = true; } else deshacerOtro = null;
    $('toastUndo').hidden = !undoable || (!undoSnapshot && !deshacerOtro);
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
  }
  $('toastUndo').addEventListener('click', () => {
    if (deshacerOtro) { const f = deshacerOtro; deshacerOtro = null; f(); $('toast').hidden = true; return; }
    if (!undoSnapshot) return;
    state = JSON.parse(undoSnapshot);
    undoSnapshot = null;
    if (currentListId && !getList(currentListId)) currentListId = null;
    save(); render();
    $('toast').hidden = true;
  });

  // ---------- Render ----------
  // Colores de las listas: cada lista tiene un color distinto según su puesto (el mismo en todos los
  // móviles, porque el orden de las listas está en la nube). Hay varios juegos para elegir en «?».
  // Cada color: [fondo, fondo2 (para el degradado)]. La Bandeja de entrada va siempre en gris.
  const PALETAS = {
    vivos: { n: 'Vivos', bandeja: ['#546E7A', '#37474F'], c: [
      ['#E53935', '#B71C1C'], ['#1E88E5', '#0D47A1'], ['#43A047', '#1B5E20'], ['#FB8C00', '#E65100'],
      ['#8E24AA', '#4A148C'], ['#00ACC1', '#006064'], ['#D81B60', '#880E4F'], ['#6D4C41', '#3E2723'],
      ['#3949AB', '#1A237E'], ['#7CB342', '#33691E'], ['#F4511E', '#BF360C'], ['#00897B', '#004D40']] },
    pastel: { n: 'Pastel', bandeja: ['#CFD8DC', '#B0BEC5'], c: [
      ['#FFCDD2', '#EF9A9A'], ['#BBDEFB', '#90CAF9'], ['#C8E6C9', '#A5D6A7'], ['#FFE0B2', '#FFCC80'],
      ['#E1BEE7', '#CE93D8'], ['#B2EBF2', '#80DEEA'], ['#F8BBD0', '#F48FB1'], ['#D7CCC8', '#BCAAA4'],
      ['#C5CAE9', '#9FA8DA'], ['#DCEDC8', '#C5E1A5'], ['#FFF9C4', '#FFF59D'], ['#B2DFDB', '#80CBC4']] },
    profundos: { n: 'Profundos', bandeja: ['#37474F', '#263238'], c: [
      ['#9B2335', '#6E1423'], ['#1F4E8C', '#12325E'], ['#2E6B3A', '#1B4424'], ['#A0520F', '#6E3708'],
      ['#5B2E83', '#3A1C56'], ['#0F6B66', '#084642'], ['#8C1D56', '#5E1239'], ['#5A4034', '#3B2A22'],
      ['#2B3A8C', '#1B255C'], ['#4F6B1E', '#334612'], ['#0D6577', '#08424E'], ['#7A3B12', '#50260B']] },
    degradados: { n: 'Degradados', bandeja: ['#607D8B', '#37474F'], c: [
      ['#FF5F6D', '#FFC371'], ['#36D1DC', '#5B86E5'], ['#56AB2F', '#A8E063'], ['#F7971E', '#FFD200'],
      ['#8E2DE2', '#C86DD7'], ['#11998E', '#38EF7D'], ['#EC008C', '#FC6767'], ['#C79081', '#8E5A4B'],
      ['#4776E6', '#8E54E9'], ['#F953C6', '#B91D73'], ['#00B4DB', '#0083B0'], ['#E96443', '#904E95']] },
  };
  const PALETA_KEY = 'dilo:paleta';
  let paleta = (() => { try { return PALETAS[localStorage.getItem(PALETA_KEY)] ? localStorage.getItem(PALETA_KEY) : 'vivos'; } catch (e) { return 'vivos'; } })();
  function coloresDe(list) {
    const P = PALETAS[paleta];
    if (list.name === INBOX_NAME) return P.bandeja;
    const resto = state.lists.filter((l) => l.name !== INBOX_NAME);
    const i = Math.max(0, resto.findIndex((l) => l.id === list.id));
    return P.c[i % P.c.length];
  }
  const colorDe = (list) => coloresDe(list)[0];
  function estiloTarjeta(list) {
    const [c1, c2] = coloresDe(list);
    // Letras blancas salvo en colores muy claros (pastel)
    const t = luz(c1) > 0.45 ? '#16202B' : '#FFFFFF';
    const fondo = paleta === 'degradados' ? `linear-gradient(135deg, ${c1}, ${c2})` : `linear-gradient(160deg, ${c1}, ${c2})`;
    return `--hue:${c1};--hue-bg:${fondo};--tile-t:${t}`;
  }

  function render() {
    const list = currentListId && getList(currentListId);
    $('homeView').hidden = !!list;
    $('homeHead').hidden = !!list;
    $('listView').hidden = !list;
    $('listHead').hidden = !list;
    if (list) renderList(list); else renderHome();
    renderComposer();
  }

  // ---- Inicio ----
  function leerAgenda() {
    try {
      const citas = JSON.parse(localStorage.getItem('agenda:c2')) || JSON.parse(localStorage.getItem('agenda:v1')) || [];
      const fam = JSON.parse(localStorage.getItem('agenda:m2')) || JSON.parse(localStorage.getItem('agenda:miembros')) || [];
      return { citas, fam };
    } catch (e) { return { citas: [], fam: [] }; }
  }
  const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // Citas pendientes de «Mi agenda» (se guarda aparte, en agenda.html)
  function agendaPending() {
    const { citas } = leerAgenda();
    const hoy = hoyISO();
    return citas.filter((c) => c.fecha >= hoy && (c.estado || (c.hecha ? 'hecha' : 'pendiente')) === 'pendiente')
      .sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')));
  }

  // Color de contraste (negro o blanco) para escribir encima de un color
  function luz(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  }
  function tinta(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    if (isNaN(n)) return '#fff';
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
    return L > 0.179 ? '#111820' : '#FFFFFF';
  }

  // Próximo día con citas: todas las de ese día, cada una con el color de su persona (como en la agenda)
  function renderAgendaTile() {
    const prox = agendaPending();
    const { fam } = leerAgenda();
    let aj = {};
    try { aj = JSON.parse(localStorage.getItem('agenda:aj')) || {}; } catch (e) {}
    const FAMILIA = { n: (aj.familia && aj.familia.n) || 'Toda la familia', c: (aj.familia && aj.familia.c) || '#44515F' };
    const NADIE = { n: '', c: (aj.nadie && aj.nadie.c) || '#9AA5B1' };
    const count = $('atCount');
    count.textContent = prox.length;
    count.classList.toggle('has', prox.length > 0);
    const box = $('atCitas');
    box.replaceChildren();
    const c = prox[0];
    if (!c) {
      $('atMes').textContent = new Date().toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
      $('atDia').textContent = new Date().getDate();
      $('atLabel').textContent = 'Mi agenda';
      box.append(el('b', { class: 'at-vacia', text: 'Sin citas próximas' }), el('span', { class: 'at-hint', text: 'Toca para apuntar una' }));
      return;
    }
    const [y, m, d] = c.fecha.split('-').map(Number);
    const f = new Date(y, m - 1, d);
    $('atMes').textContent = f.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
    $('atDia').textContent = d;
    const manana = new Date(); manana.setDate(manana.getDate() + 1);
    const cuando = c.fecha === hoyISO() ? 'Hoy' : f.toDateString() === manana.toDateString() ? 'Mañana'
      : f.toLocaleDateString('es-ES', { weekday: 'long' });
    $('atLabel').textContent = `Mi agenda · ${cuando}`;
    const delDia = prox.filter((x) => x.fecha === c.fecha);
    for (const x of delDia.slice(0, 3)) {
      const p = x.de === 'familia' ? FAMILIA : (fam.find((q) => q.id === x.de) || NADIE);
      box.append(el('span', { class: 'at-cita', style: `background:${p.c};color:${tinta(p.c)}` },
        el('b', { text: x.hora || 'Todo el día' }), ' ',
        el('span', { class: 'at-tit', text: x.titulo || 'Cita' }),
        p.n ? el('small', { text: p.n }) : null));
    }
    if (delDia.length > 3) box.append(el('span', { class: 'at-hint', text: `y ${delDia.length - 3} más ese día` }));
  }

  function renderHome() {
    const hoy = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    $('hoyFecha').textContent = hoy.charAt(0).toUpperCase() + hoy.slice(1);

    const bandeja = inbox();
    const porOrdenar = bandeja ? bandeja.items.filter((i) => !i.done).length : 0;
    $('inboxBanner').hidden = !porOrdenar;
    $('inboxTitle').textContent = porOrdenar === 1 ? '1 cosa por ordenar' : `${porOrdenar} cosas por ordenar`;

    renderAgendaTile();

    const wrap = $('lists');
    wrap.replaceChildren();
    for (const l of state.lists) {
      const pend = l.items.filter((i) => !i.done);
      const tile = el('button', { class: 'tile', type: 'button', style: estiloTarjeta(l), 'aria-label': `${l.name}, ${pend.length} pendientes` },
        el('span', { class: 'tile-emoji', text: l.emoji }),
        el('span', { class: 'tile-foot' },
          el('span', { class: 'tile-name' }, (l.privada ? '🔒 ' : '') + l.name,
            el('span', { class: 'tile-sub', text: pend.length ? (pend.length === 1 ? '1 pendiente' : `${pend.length} pendientes`) : 'Vacía' })),
          el('span', { class: 'tile-count' + (pend.length ? ' has' : ''), text: String(pend.length) })));
      tile.addEventListener('click', () => { openList(l.id); });
      wrap.appendChild(tile);
    }
    ajustarTiles();
  }

  // Las tarjetas de las listas ocupan el hueco libre de la pantalla, sin tener que desplazarse:
  // con pocas listas son grandes; con muchas se hacen pequeñas (3 columnas y luego filas).
  // Solo con muchísimas listas hay que desplazarse.
  // Formas de las tarjetas, de más grande a más pequeña: [columnas, alto mínimo, estilo]
  const FORMAS = [[2, 84, ''], [3, 84, ''], [3, 66, 'mini'], [2, 42, 'fila']];
  const ALTO_MAX = 150;
  function ajustarTiles() {
    if ($('homeView').hidden) return;
    const grid = document.querySelector('.tiles');
    const tiles = [...grid.querySelectorAll('.tile')];
    if (!tiles.length) return;
    const gap = 10;
    const arriba = grid.getBoundingClientRect().top + window.scrollY;
    const abajo = window.innerHeight - document.querySelector('.dock').offsetHeight - 10;
    const hueco = abajo - arriba;
    const alto = (c) => { const filas = Math.ceil(tiles.length / c); return (hueco - gap * (filas - 1)) / filas; };
    // Vista «Filas»: una fila ancha por lista, como las citas de Mi agenda
    grid.classList.toggle('filas-anchas', vista === 'filas');
    if (vista === 'filas') {
      const hf = Math.floor(Math.max(56, Math.min(84, (hueco - gap * (tiles.length - 1)) / tiles.length)));
      grid.style.gridTemplateColumns = '1fr';
      grid.style.gridAutoRows = hf + 'px';
      grid.style.setProperty('--fh', hf + 'px');
      grid.classList.toggle('con-sub', hf >= 64);
      grid.classList.remove('mini', 'fila');
      return;
    }
    const ancha = window.innerWidth >= 560;
    const formas = FORMAS.map(([c, min, estilo]) => [ancha && c === 2 && !estilo ? 3 : c, min, estilo]);
    // La primera forma que quepa sin desplazarse; si ninguna cabe, la más pequeña
    let [cols, min, estilo] = formas.find(([c, m]) => alto(c) >= m) || formas[formas.length - 1];
    const h = Math.floor(Math.max(min, Math.min(ALTO_MAX, alto(cols))));
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    grid.style.gridAutoRows = h + 'px';
    grid.style.setProperty('--th', h + 'px');
    grid.classList.toggle('mini', estilo === 'mini' || (!estilo && h < 96));
    grid.classList.toggle('fila', estilo === 'fila');
  }
  let ajusteTimer;
  window.addEventListener('resize', () => {
    // Con el teclado abierto la pantalla encoge: no reordenar entonces
    if (document.activeElement === $('textInput')) return;
    clearTimeout(ajusteTimer);
    ajusteTimer = setTimeout(ajustarTiles, 120);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustarTiles).catch(() => {});

  // ---- Una lista ----
  // «Ahora mismo», «Hace 5 min», «Hoy 9:15», «Ayer 18:30», «3 nov 18:30»
  function cuandoFue(ts) {
    if (!ts) return '';
    const min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return 'Ahora mismo';
    if (min < 60) return `Hace ${min} min`;
    const d = new Date(ts);
    const hora = d.toLocaleTimeString('es-ES', { hour: 'numeric', minute: '2-digit' });
    const hoy = new Date();
    const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    if (d.toDateString() === hoy.toDateString()) return `Hoy ${hora}`;
    if (d.toDateString() === ayer.toDateString()) return `Ayer ${hora}`;
    const fecha = d.toLocaleDateString('es-ES', d.getFullYear() === hoy.getFullYear()
      ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
    return `${fecha} ${hora}`;
  }

  // Línea de debajo: quién lo apuntó y cuándo (y quién lo marcó como hecho)
  function quienYCuando(item) {
    const N = window.DiloNube;
    const quien = (correo) => (N && N.persona && correo ? N.persona(correo) : null);
    const meta = el('span', { class: 'meta' });
    const trozo = (p, texto, cls) => {
      const t = el('span', { class: 'meta-part' + (cls ? ' ' + cls : '') });
      if (cls) t.append(el('span', { class: 'meta-tick', text: '✓', 'aria-label': 'Hecho' }));
      t.append(texto);
      if (p) t.append(' · ', el('span', { class: 'meta-who', text: p.nombre }));
      meta.append(t);
    };
    trozo(quien(item.by), cuandoFue(item.createdAt));
    if (item.done && (item.doneAt || item.doneBy)) {
      const p = quien(item.doneBy);
      trozo(p, cuandoFue(item.doneAt), 'meta-done');
    }
    return meta;
  }

  const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

  // Etiquetas de las cosas apuntadas. Sin etiqueta = normal. Para añadir más, basta con
  // añadirlas aquí (id, nombre, color); las urgentes salen siempre arriba.
  const ETIQUETAS = [
    { id: 'urgente', n: 'Urgente', c: '#D32F2F' },
    { id: 'informativa', n: 'Informativa', c: '#1D6FD1' },
    { id: 'curiosidad', n: 'Curiosidad', c: '#8A4FBF' },
  ];
  const etiquetaDe = (item) => ETIQUETAS.find((e) => e.id === item.etiqueta) || null;
  const pesoEtiqueta = (item) => (item.etiqueta === 'urgente' ? 0 : 1);

  function fila(list, item) {
    const li = el('li', { class: 'row' + (item.done ? ' done' : '') + (recienApuntados.has(item.id) ? ' nuevo' : '') });
    const chk = el('button', { class: 'check', type: 'button', 'aria-label': item.done ? 'Marcar como pendiente' : 'Marcar como hecho', 'aria-pressed': String(!!item.done) });
    chk.innerHTML = ICON_CHECK;
    chk.addEventListener('click', () => { marcarHecha(item, !item.done); save(); render(); });
    const txt = el('button', { class: 'row-text', type: 'button', 'aria-label': 'Editar: ' + item.text },
      el('b', {}, etiquetaDe(item) ? el('span', { class: 'tag', style: `--tc:${etiquetaDe(item).c}`, text: etiquetaDe(item).n }) : null, item.text),
      quienYCuando(item));
    txt.addEventListener('click', () => editarItem(item));
    if (item.audioId) {
      const audio = el('audio');
      audio.controls = true;
      getAudio(item.audioId).then((blob) => { if (blob) audio.src = URL.createObjectURL(blob); }).catch(() => {});
      txt.append(audio);
    }
    const more = el('button', { class: 'row-more', type: 'button', 'aria-label': 'Más opciones' });
    more.innerHTML = ICON_MORE;
    more.addEventListener('click', () => abrirMenuItem(list, item));
    li.append(chk, txt, more);
    return li;
  }

  let verHechas = false;
  function renderList(list) {
    const isInbox = list.name === INBOX_NAME;
    const pend = list.items.filter((i) => !i.done).sort((a, b) => pesoEtiqueta(a) - pesoEtiqueta(b));
    const hechas = list.items.filter((i) => i.done);
    document.documentElement.style.setProperty('--hue', coloresDe(list)[paleta === 'pastel' ? 1 : 0]);
    $('listEmoji').textContent = list.emoji;
    $('title').textContent = list.name;
    $('listSub').textContent = (list.privada ? '🔒 Solo tú · ' : '') + (list.items.length
      ? `${pend.length} ${pend.length === 1 ? 'pendiente' : 'pendientes'}${hechas.length ? ` · ${hechas.length} ${hechas.length === 1 ? 'hecha' : 'hechas'}` : ''}`
      : 'Vacía');

    $('items').replaceChildren(...pend.map((i) => fila(list, i)));
    $('emptyMsg').hidden = pend.length > 0;
    $('emptyEmoji').textContent = hechas.length ? '🎉' : list.emoji;
    $('emptyMsg').querySelector('b').textContent = hechas.length ? '¡Todo hecho!' : 'Lista vacía';
    $('emptyHint').textContent = isInbox
      ? 'Aquí llega lo que dices sin nombrar una lista.'
      : `Pulsa el micro y di, por ejemplo, «${list.name === 'Compra' ? 'leche y pan' : 'llamar al taller'}».`;

    $('doneBox').hidden = !hechas.length;
    $('doneSummary').textContent = `Hechas (${hechas.length})`;
    $('doneToggle').setAttribute('aria-expanded', String(verHechas));
    $('doneItems').hidden = !verHechas;
    $('doneItems').replaceChildren(...hechas.map((i) => fila(list, i)));

    $('deleteListBtn').hidden = isInbox;
    $('renameListBtn').hidden = isInbox;
    $('clearDoneBtn').hidden = !hechas.length;
    setTimeout(() => recienApuntados.clear(), 1500);
  }
  $('doneToggle').addEventListener('click', () => { verHechas = !verHechas; render(); });

  async function editarItem(item) {
    const t = await ask('Editar', item.text);
    if (t && t.trim()) { snapshot(); item.text = t.trim(); save(); render(); }
  }

  // Menú de una cosa apuntada: editar, mover a otra lista, borrar
  let menuItem = null;
  function abrirMenuItem(list, item) {
    menuItem = { list, item };
    $('itemMenuTitle').textContent = item.text;
    // Quién lo apuntó (también sirve para ver si ese dato llegó a guardarse)
    const N = window.DiloNube;
    const p = item.by && N && N.persona ? N.persona(item.by) : null;
    $('itemMenuWho').textContent = item.by
      ? `Apuntado por ${p ? p.nombre : item.by} (${item.by}) · ${cuandoFue(item.createdAt)}`
      : `Sin datos de quién lo apuntó · ${cuandoFue(item.createdAt)}`;
    const tags = $('itemTags');
    tags.replaceChildren();
    for (const e of [{ id: '', n: 'Normal', c: '#6B7785' }, ...ETIQUETAS]) {
      const on = (item.etiqueta || '') === e.id;
      const b = el('button', { class: 'chip tag-chip', type: 'button', 'aria-pressed': String(on), style: e.c ? `--tc:${e.c}` : '' }, e.n);
      b.addEventListener('click', () => {
        snapshot();
        if (e.id) item.etiqueta = e.id; else delete item.etiqueta;
        $('itemMenu').close();
        save(); render();
      });
      tags.append(b);
    }
    const grid = $('itemMoveTo');
    grid.replaceChildren();
    for (const l of state.lists) {
      if (l.id === list.id) continue;
      const b = el('button', { class: 'chip', type: 'button' }, `${l.emoji} ${l.name}`);
      b.addEventListener('click', () => moverItem(l));
      grid.append(b);
    }
    const nueva = el('button', { class: 'chip', type: 'button' }, '+ Lista nueva');
    nueva.addEventListener('click', async () => {
      $('itemMenu').close();
      const name = await ask('Nombre de la nueva lista');
      if (name && name.trim()) moverItem(ensureList(name.trim()));
    });
    grid.append(nueva);
    $('itemMenu').showModal();
  }
  function moverItem(target) {
    const { list, item } = menuItem;
    if ($('itemMenu').open) $('itemMenu').close();
    snapshot();
    list.items = list.items.filter((i) => i.id !== item.id);
    target.items.unshift(item);
    save(); render();
    toast(`Movido a ${target.emoji} ${target.name}`, true);
  }
  $('itemEdit').addEventListener('click', () => { $('itemMenu').close(); editarItem(menuItem.item); });
  $('itemDelete').addEventListener('click', () => {
    const { list, item } = menuItem;
    $('itemMenu').close();
    snapshot();
    list.items = list.items.filter((i) => i.id !== item.id);
    save(); render();
    toast('Borrado', true);
  });

  // ---- Barra inferior: caja de texto ----
  function renderComposer() {
    const l = getList(currentListId);
    $('textInput').placeholder = l && l.name !== INBOX_NAME ? `Añadir a ${l.name}…` : 'Escribe o pulsa el micro…';
    const conTexto = !!$('textInput').value.trim();
    $('sendBtn').hidden = !conTexto;
  }
  $('textInput').addEventListener('input', renderComposer);

  $('listMenuBtn').addEventListener('click', () => {
    const l = getList(currentListId);
    if (!l) return;
    $('listMenuTitle').textContent = `${l.privada ? '🔒 ' : ''}${l.emoji} ${l.name}`;
    $('privListBtn').hidden = l.name === INBOX_NAME;
    $('privListBtn').textContent = l.privada ? '👥 Compartirla con la casa' : '🔒 Hacerla privada (solo para mí)';
    $('listMenu').showModal();
  });
  for (const id of ['privListBtn', 'shareListBtn', 'renameListBtn', 'clearDoneBtn', 'deleteListBtn']) {
    $(id).addEventListener('click', () => { if ($('listMenu').open) $('listMenu').close(); });
  }

  // ---------- Acciones de lista ----------
  $('backBtn').addEventListener('click', () => { currentListId = null; render(); window.scrollTo(0, 0); });
  $('helpBtn').addEventListener('click', () => { renderVistas(); renderPaletas(); $('helpDialog').showModal(); });

  // Elegir cómo se ven las listas: tarjetas o filas (se guarda en este móvil)
  const VISTA_KEY = 'dilo:vista';
  let vista = (() => { try { return localStorage.getItem(VISTA_KEY) === 'filas' ? 'filas' : 'tarjetas'; } catch (e) { return 'tarjetas'; } })();
  function renderVistas() {
    const box = $('vistas');
    box.replaceChildren();
    for (const [id, n, dibujo] of [['tarjetas', 'Tarjetas', '▦'], ['filas', 'Filas', '☰']]) {
      const b = el('button', { class: 'pal pal-vista', type: 'button', 'aria-pressed': String(id === vista) },
        el('span', { class: 'pal-dibujo', text: dibujo }), el('span', { text: n }));
      b.addEventListener('click', () => {
        vista = id;
        try { localStorage.setItem(VISTA_KEY, id); } catch (e) {}
        renderVistas(); render();
      });
      box.append(b);
    }
  }

  // Elegir los colores de las listas (se guarda en este móvil)
  function renderPaletas() {
    const box = $('paletas');
    box.replaceChildren();
    for (const [id, P] of Object.entries(PALETAS)) {
      const muestra = el('span', { class: 'pal-muestra' },
        ...P.c.slice(0, 6).map(([c1, c2]) => el('i', { style: `background:linear-gradient(135deg, ${c1}, ${c2})` })));
      const b = el('button', { class: 'pal', type: 'button', 'aria-pressed': String(id === paleta) }, muestra, el('span', { text: P.n }));
      b.addEventListener('click', () => {
        paleta = id;
        try { localStorage.setItem(PALETA_KEY, id); } catch (e) {}
        renderPaletas(); render();
      });
      box.append(b);
    }
  }
  $('version').textContent = 'Versión ' + VERSION;
  $('notifyBtn').addEventListener('click', askNotifyPermission);
  renderNotifyBtn();

  $('newListBtn').addEventListener('click', async () => {
    const name = await ask('Nombre de la nueva lista');
    if (!name || !name.trim()) return;
    snapshot();
    const list = ensureList(name.trim());
    save();
    openList(list.id);
  });

  // Lista privada («Solo para mí») o compartida con la casa
  async function cambiarPrivada(list, privada) {
    const N = window.DiloNube;
    if (!N || N.estado !== 'dentro') {
      toast('Las listas privadas sirven cuando compartes Dilo con la casa (☁️). Ahora todo está solo en este móvil.');
      return false;
    }
    if (!miaOk) {
      toast('⚠️ Aún no se pueden hacer listas privadas: falta poner las reglas nuevas en Firebase (o no hay conexión).');
      return false;
    }
    if (privada && !(await ask(`¿Hacer privada «${list.name}»? Solo la verás tú, con tu cuenta. Desaparecerá de los móviles de los demás.`, null, 'Hacerla privada'))) return false;
    if (!privada && !(await ask(`¿Compartir «${list.name}» con la casa? La verán todos.`, null, 'Compartirla'))) return false;
    snapshot();
    if (privada) list.privada = true; else delete list.privada;
    enCamino.set(list.id, Date.now() + 8000);
    save(); render();
    toast(privada ? `🔒 «${list.name}» ahora es solo tuya` : `👥 «${list.name}» se comparte con la casa`, true);
    return true;
  }
  $('privListBtn').addEventListener('click', () => {
    const list = getList(currentListId);
    if (list) cambiarPrivada(list, !list.privada);
  });

  // Copiar la lista como texto (para pegarla en WhatsApp, en un correo o en el chat con Claude)
  $('shareListBtn').addEventListener('click', async () => {
    const list = getList(currentListId);
    if (!list) return;
    const N = window.DiloNube;
    const linea = (i) => {
      const p = i.by && N && N.persona ? N.persona(i.by) : null;
      return `- ${i.text}${p ? ` (${p.nombre})` : ''}`;
    };
    const pend = list.items.filter((i) => !i.done).map(linea);
    const hechas = list.items.filter((i) => i.done).map(linea);
    const texto = [`${list.emoji} ${list.name}`, ...pend, ...(hechas.length ? ['', 'Hechas:', ...hechas] : [])].join('\n');
    try {
      if (navigator.share) { await navigator.share({ title: list.name, text: texto }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(texto); toast('📋 Lista copiada. Ya puedes pegarla donde quieras.'); }
    catch (e) { await ask('Copia el texto de la lista', texto, 'Cerrar'); }
  });

  $('clearDoneBtn').addEventListener('click', () => {
    const list = getList(currentListId);
    if (!list || !list.items.some((i) => i.done)) return;
    snapshot();
    list.items = list.items.filter((i) => !i.done);
    save(); render();
    toast('Completadas borradas', true);
  });

  $('renameListBtn').addEventListener('click', async () => {
    const list = getList(currentListId);
    const name = await ask('Nuevo nombre', list.name);
    if (!name || !name.trim()) return;
    snapshot();
    list.name = name.trim();
    list.emoji = emojiFor(list.name);
    save(); render();
  });

  $('deleteListBtn').addEventListener('click', async () => {
    const list = getList(currentListId);
    if (!list || !(await ask(`¿Eliminar la lista «${list.name}» y todo su contenido?`, null, 'Eliminar'))) return;
    snapshot();
    state.lists = state.lists.filter((l) => l.id !== list.id);
    currentListId = null;
    save(); render();
    toast('Lista eliminada', true);
  });

  // Limpia audios huérfanos al arrancar (p. ej. tras borrar notas)
  (async () => {
    try {
      const used = new Set(state.lists.flatMap((l) => l.items.map((i) => i.audioId).filter(Boolean)));
      const d = await db();
      const req = d.transaction('clips').objectStore('clips').getAllKeys();
      req.onsuccess = () => req.result.forEach((k) => { if (!used.has(k)) deleteAudio(k); });
    } catch (e) { /* sin IndexedDB */ }
  })();

  // ---------- Nube: tarjeta y ventana «Nube y familia» ----------
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    e.append(...kids.filter(Boolean));
    return e;
  };

  function renderCloud() {
    const N = window.DiloNube;
    const card = $('cloudCard');
    const chip = $('cloudChip');
    if (!N) { card.hidden = true; return; }
    const st = N.estado;
    // Botón redondo de arriba: tu foto (con punto verde si estás en la nube) o una nube
    const u = N.usuario;
    chip.replaceChildren();
    if (u && u.foto) chip.append(el('img', { src: u.foto, alt: '' }));
    else chip.textContent = '☁️';
    chip.classList.toggle('on', st === 'dentro');
    chip.setAttribute('aria-label', st === 'dentro' ? 'Nube y familia: conectado' : 'Nube y familia');
    // Aviso grande solo mientras no estás dentro
    card.hidden = st === 'dentro' || st === 'cargando';
    if (st === 'fuera') { $('cloudTitle').textContent = 'Guarda tus listas en la nube'; $('cloudSub').textContent = 'Entra con Google y compártelas con tu familia'; }
    else if (st === 'sin-casa') { $('cloudTitle').textContent = 'Falta crear tu casa'; $('cloudSub').textContent = u ? u.correo : ''; }
    if ($('cloudDialog').open) renderCloudDialog();
  }

  async function conEspera(btn, fn) {
    const t = btn.textContent;
    btn.disabled = true; btn.textContent = 'Un momento…';
    try { await fn(); } catch (e) {
      const c = e && e.code;
      toast(c === 'auth/unauthorized-domain' ? '⚠️ Falta autorizar la dirección de Dilo en Firebase (Dominios autorizados)'
        : c === 'auth/network-request-failed' || c === 'unavailable' ? '⚠️ Sin conexión. Inténtalo con internet.'
        : e && e.message === 'correo' ? 'Escribe un correo válido, por ejemplo nombre@gmail.com'
        : '⚠️ No se pudo hacer. ' + (c || ''));
    } finally { btn.disabled = false; btn.textContent = t; }
  }

  function renderCloudDialog() {
    const N = window.DiloNube;
    const body = $('cloudBody');
    body.replaceChildren();
    if (!N || N.estado === 'cargando') { body.append(el('p', { text: 'Conectando…' })); return; }

    if (N.estado === 'fuera') {
      body.append(
        el('p', { text: 'Con la nube, tus listas y tu agenda se guardan en internet: no se pierden si cambias de móvil, y puedes compartirlas con tu familia.' }),
        el('button', { class: 'primary-btn google-btn', type: 'button', onclick: (e) => conEspera(e.currentTarget, () => N.entrar()) }, 'Entrar con Google'),
        el('p', { class: 'cloud-note', text: 'Solo podrán ver tus datos las personas que tú invites.' }),
      );
      return;
    }

    const u = N.usuario;
    body.append(el('div', { class: 'cloud-who' },
      u.foto ? el('img', { src: u.foto, alt: '' }) : null,
      el('div', {}, el('b', { text: u.nombre || u.correo }), el('br'), el('span', { class: 'cloud-note', text: u.correo }))));

    if (N.estado === 'sin-casa') {
      const nombre = el('input', { type: 'text', id: 'casaNombre', placeholder: 'Ej.: Casa de Álvaro y Bea' });
      nombre.value = 'Casa de ' + ((u.nombre || '').split(' ')[0] || 'la familia');
      body.append(
        el('p', { text: 'Todavía no estás en ninguna casa.' }),
        el('p', { class: 'cloud-note', text: 'Si alguien te va a invitar a la suya, pídele que lo haga y pulsa «Buscar de nuevo». Si eres el primero, crea la tuya.' }),
        el('div', { class: 'cloud-row' }, nombre),
        el('button', { class: 'primary-btn', type: 'button', onclick: (e) => conEspera(e.currentTarget, () => N.crearHogar(nombre.value)) }, 'Crear mi casa'),
        el('button', { class: 'ghost-btn', type: 'button', onclick: (e) => conEspera(e.currentTarget, () => N.buscarDeNuevo()) }, 'Buscar de nuevo (ya me han invitado)'),
        el('button', { class: 'ghost-btn', type: 'button', onclick: (e) => conEspera(e.currentTarget, () => N.salir()) }, 'Salir de la cuenta'),
      );
      return;
    }

    const h = N.hogar;
    const lista = el('ul', { class: 'cloud-members' });
    for (const m of h.miembros || []) {
      const yo = m === u.correo;
      const v = N.versionDe ? N.versionDe(m) : '';
      const vieja = !v || v !== VERSION;
      lista.append(el('li', {}, el('span', {}, m + (yo ? ' (tú)' : ''), el('br'),
        el('small', { class: 'cloud-note' + (vieja && !yo ? ' cloud-old' : ''),
          text: v ? `Dilo ${v}${vieja && !yo ? ' · tiene que actualizar' : ''}` : 'Dilo antigua · tiene que actualizar' })),
        yo ? null : el('button', { type: 'button', onclick: async (e) => {
          if (!(await ask(`¿Quitar a ${m} de la casa? Dejará de ver vuestras listas y citas.`, null, 'Quitar'))) return;
          conEspera(e.currentTarget, () => N.quitar(m));
        } }, 'Quitar')));
    }
    const email = el('input', { type: 'email', id: 'invitarCorreo', placeholder: 'correo@gmail.com', autocomplete: 'off' });
    body.append(
      el('p', { text: `Casa: ${h.nombre || 'Mi casa'}` }),
      el('b', { text: 'Quién puede verla' }),
      lista,
      el('b', { text: 'Invitar a alguien' }),
      el('p', { class: 'cloud-note', text: 'Escribe su correo de Google (Gmail). Luego esa persona abre Dilo en su móvil, pulsa «Entrar con Google» y verá todo.' }),
      el('div', { class: 'cloud-row' }, email,
        el('button', { class: 'primary-btn', type: 'button', onclick: (e) => conEspera(e.currentTarget, async () => {
          await N.invitar(email.value);
          toast(`✅ Invitación hecha: ${email.value.trim().toLowerCase()}`);
          email.value = '';
        }) }, 'Invitar')),
      el('p', { class: 'cloud-note', text: 'Todo lo de Dilo (listas y agenda) se comparte con las personas de la casa. Las notas de voz grabadas se quedan en el móvil donde se grabaron.' }),
      el('button', { class: 'ghost-btn', type: 'button', onclick: (e) => conEspera(e.currentTarget, () => N.salir()) }, 'Salir de la cuenta'),
    );
  }

  const abrirNube = () => { renderCloudDialog(); $('cloudDialog').showModal(); };
  $('cloudCard').addEventListener('click', abrirNube);
  $('cloudChip').addEventListener('click', abrirNube);
  $('inboxBanner').addEventListener('click', () => { const b = inbox(); if (b) openList(b.id); });

  function conectarNube() {
    const N = window.DiloNube;
    if (!N) return;
    let hogarActual = null;
    N.onChange(() => {
      const id = N.estado === 'dentro' && N.hogar ? N.hogar.id : null;
      if (N.estado === 'fuera' || N.estado === 'sin-casa') marcarListo();
      if (typeof renderGtasks === 'function') renderGtasks();
      if (id !== hogarActual) { hogarActual = id; conectarListas(id ? N.db() : null, id && N.dbMia ? N.dbMia() : null); }
      renderCloud();
    });
    N.onMiembros(() => { renderCloud(); render(); });
    renderCloud();
  }
  if (window.DiloNube) conectarNube();
  else window.addEventListener('dilonube', conectarNube, { once: true });

  // Atajo: abrir la app con ?voz para empezar a hablar directamente
  // Al tocar una notificación: abrir la lista donde se apuntó
  const params = new URLSearchParams(location.search);
  if (params.has('lista')) currentListId = getList(params.get('lista')) ? params.get('lista') : null;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.openList) openList(e.data.openList);
      if (e.data && e.data.voz && !listening) micBtn.click();
    });
  }

  if (params.has('voz')) {
    setTimeout(() => micBtn.click(), 300);
  }

  // «Compartir» → Dilo desde otra app (Keep, WhatsApp, el asistente…): se apunta como si se dijera.
  // Esperamos a tener las listas de la nube para no pisar nada.
  // El texto manda; el título solo si no hay texto; el enlace se añade si no venía ya dentro
  const tx = (params.get('texto') || '').trim();
  const en = (params.get('enlace') || '').trim();
  const compartido = [tx || (params.get('titulo') || '').trim(), en && !tx.includes(en) ? en : ''].filter(Boolean).join(' ');
  // Se guarda un momento en el móvil por si Dilo se recarga al abrirse (versión nueva)
  if (compartido) {
    try { sessionStorage.setItem('dilo:compartido', compartido); } catch (e) {}
    history.replaceState(null, '', location.pathname);
  }
  let pendiente = compartido;
  try { pendiente = sessionStorage.getItem('dilo:compartido') || compartido; } catch (e) {}
  if (pendiente) {
    cuandoListo(() => {
      try { sessionStorage.removeItem('dilo:compartido'); } catch (e) {}
      handleInput(pendiente);
    });
  }

  // ---- Recoger lo dictado a «Hey Google» (Google Tasks) ----
  // «Hey Google, recuérdame comprar pilas» (con el móvil bloqueado) lo guarda en Google Tasks, en
  // «Mis tareas». Al abrir Dilo se traen esas tareas, se apuntan como si se dijeran y en Google
  // Tasks se marcan como hechas para no traerlas dos veces.
  const GT_KEY = 'dilo:gtasks';
  const gtActivo = () => { try { return localStorage.getItem(GT_KEY) === '1'; } catch (e) { return false; } };
  let recogiendo = false;
  function renderGtasks() {
    const N = window.DiloNube;
    const dentro = N && N.estado === 'dentro';
    $('gtasksBtn').textContent = gtActivo() ? '🎙️ Recoger lo dictado a «Hey Google»: activado (toca para quitarlo)'
      : '🎙️ Recoger lo que dicte a «Hey Google» (Google Tasks)';
    $('gtasksBanner').hidden = !(gtActivo() && dentro && N.tokenTasksGuardado && !N.tokenTasksGuardado());
  }
  async function recogerDeGoogle(conToque) {
    const N = window.DiloNube;
    if (!gtActivo() || recogiendo || !N || N.estado !== 'dentro' || !N.tokenTasksGuardado) return;
    recogiendo = true;
    try {
      let token = N.tokenTasksGuardado();
      if (!token && conToque) token = await N.pedirTokenTasks();
      if (!token) { renderGtasks(); return; }
      const api = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';
      const r = await fetch(`${api}?showCompleted=false&showHidden=false&maxResults=100`, { headers: { Authorization: 'Bearer ' + token } });
      if (r.status === 401) { N.olvidarTokenTasks(); renderGtasks(); if (conToque) toast('Vuelve a tocar para dar permiso a Dilo'); return; }
      if (!r.ok) {
        const txt = await r.text();
        toast(/has not been used|is disabled|SERVICE_DISABLED/i.test(txt) ? '⚠️ Falta activar «Google Tasks API» en la consola de Google'
          : '⚠️ No se pudo leer Google Tasks (' + r.status + ')');
        return;
      }
      const datos = await r.json();
      const tareas = (datos.items || []).filter((t) => t.status !== 'completed' && (t.title || '').trim())
        .sort((a, b) => (a.position || '').localeCompare(b.position || ''));
      if (!tareas.length) { if (conToque) toast('🎙️ No hay nada nuevo dictado a «Hey Google»'); return; }
      for (const t of tareas) {
        // «Hey Google, añade leche a la compra a Tasks» llega como «leche a la compra»: sin verbo
        // iría a la Bandeja, así que si con «apunta» delante encaja en una lista que existe, se usa
        let texto = t.title.trim();
        const r = parse(texto, state.lists);
        if (r && r.type === 'inbox') {
          const r2 = parse('apunta ' + texto, state.lists);
          if (r2 && r2.type === 'add' && !r2.created) texto = 'apunta ' + texto;
        }
        handleInput(texto);
        // En Google Tasks queda como hecha (no se borra, por si acaso)
        fetch(`${api}/${encodeURIComponent(t.id)}`, {
          method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        }).catch(() => {});
      }
      toast(tareas.length === 1 ? `🎙️ Recogido de «Hey Google»: «${tareas[0].title.trim()}»` : `🎙️ ${tareas.length} cosas recogidas de «Hey Google»`);
    } catch (e) {
      const c = e && e.code;
      if (c === 'auth/popup-blocked') toast('⚠️ El móvil bloqueó la ventana de Google. Vuelve a tocar.');
      else if (c !== 'auth/popup-closed-by-user' && c !== 'auth/cancelled-popup-request') toast('⚠️ No se pudo conectar con Google Tasks. ' + (c || (e && e.message) || ''));
    } finally {
      recogiendo = false;
      renderGtasks();
    }
  }
  $('gtasksBtn').addEventListener('click', async () => {
    const N = window.DiloNube;
    if (gtActivo()) {
      try { localStorage.setItem(GT_KEY, '0'); } catch (e) {}
      if (N && N.olvidarTokenTasks) N.olvidarTokenTasks();
      renderGtasks();
      toast('Ya no se recoge lo de «Hey Google»');
      return;
    }
    if (!N || N.estado !== 'dentro') { toast('Primero entra con Google en ☁️ (la misma cuenta que usa «Hey Google»)'); return; }
    try { localStorage.setItem(GT_KEY, '1'); } catch (e) {}
    renderGtasks();
    await recogerDeGoogle(true);
  });
  $('gtasksBanner').addEventListener('click', () => recogerDeGoogle(true));
  // Al abrir Dilo y al volver a ella: se recoge solo si el permiso sigue vigente; si no, sale el aviso
  cuandoListo(() => { renderGtasks(); recogerDeGoogle(false); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && listoYa) { renderGtasks(); recogerDeGoogle(false); }
  });

  // Botón fijo «Toca para apuntar» en las notificaciones (opciones iguales que en sw.js)
  const FIJO_KEY = 'dilo:fijo';
  const fijoActivo = () => { try { return localStorage.getItem(FIJO_KEY) === '1'; } catch (e) { return false; } };
  async function ponerFijo(on) {
    try { localStorage.setItem(FIJO_KEY, on ? '1' : '0'); } catch (e) {}
    if (!canNotify()) return;
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 3000))]);
    if (!reg) return;
    if (!on) { (await reg.getNotifications({ tag: 'dilo-fijo' })).forEach((n) => n.close()); return; }
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') { toast('Para el botón fijo hay que permitir las notificaciones de Dilo'); return; }
    await reg.showNotification('🎙️ Dilo · Toca para apuntar', {
      body: 'Habla y se apunta en tus listas o en Mi agenda',
      icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'dilo-fijo',
      requireInteraction: true, silent: true, renotify: false,
      actions: [{ action: 'voz', title: '🎙️ Apuntar' }],
      data: { voz: true },
    });
  }
  function renderFijo() {
    const b = $('fijoBtn');
    b.hidden = !canNotify();
    b.textContent = fijoActivo() ? '📌 Botón «Apuntar» en las notificaciones: activado (toca para quitarlo)'
      : '📌 Poner un botón «Apuntar» fijo en las notificaciones';
  }
  $('fijoBtn').addEventListener('click', async () => {
    await ponerFijo(!fijoActivo());
    renderFijo();
    toast(fijoActivo() ? '📌 Listo: en las notificaciones tienes «Toca para apuntar»' : 'Botón fijo quitado');
  });
  renderFijo();
  // Si estaba activado, se vuelve a poner al abrir Dilo (por si se quitó al reiniciar el móvil)
  if (fijoActivo() && canNotify() && Notification.permission === 'granted') ponerFijo(true);

  if ('serviceWorker' in navigator) {
    // Busca siempre la versión nueva del service worker y recarga una vez cuando llega
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }

  render();

  // Cada minuto se actualiza «Hace 5 min» en la lista abierta
  setInterval(() => {
    if (document.hidden || !currentListId || document.querySelector('dialog[open]')) return;
    render();
  }, 60000);
})();
