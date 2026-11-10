(function () {
  'use strict';

  const { parse, findList, INBOX_NAME } = window.VoiceParser;
  const STORAGE_KEY = 'dilo.v1';
  const VERSION = '0.7';
  const $ = (id) => document.getElementById(id);

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
  let targetListId = null;              // lista elegida en las etiquetas de abajo
  const recienApuntados = new Set();    // para resaltar lo que se acaba de apuntar

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('⚠️ No se pudo guardar en este dispositivo'); }
    pushCloud();
  }

  // ---------- Nube: listas compartidas con la casa ----------
  // En la nube cada lista es un documento de «listas» y cada cosa apuntada uno de «items».
  // Al guardar se suben solo los cambios; lo que llega de otro móvil reemplaza el estado.
  let nubeDB = null;
  let nubeUnsubs = [];
  let nubeMigrada = false;
  const nubeDocs = { listas: [], items: [] };
  const nubeListo = { listas: false, items: false };     // ya llegó la respuesta del servidor
  const subido = { listas: new Map(), items: new Map() };  // lo último que hay en la nube
  const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  const limpio = (o) => JSON.parse(JSON.stringify(o));

  function docsLocales() {
    const listas = state.lists.map((l, i) => ({ id: l.id, data: { name: l.name, emoji: l.emoji || emojiFor(l.name), orden: i } }));
    const items = [];
    for (const l of state.lists) {
      for (const it of l.items) {
        const d = { listId: l.id, text: it.text, done: !!it.done, createdAt: it.createdAt || 0 };
        if (it.audioId) d.audioId = it.audioId;
        items.push({ id: it.id, data: d });
      }
    }
    return { listas, items };
  }

  function fallaNube(e) {
    if (e && e.code === 'permission-denied') toast('⚠️ No tienes permiso en esta casa. Revisa la invitación.');
  }

  function pushCloud() {
    if (!nubeDB || !nubeMigrada) return;
    const locales = docsLocales();
    for (const col of ['listas', 'items']) {
      const mapa = subido[col];
      const ids = new Set();
      for (const d of locales[col]) {
        ids.add(d.id);
        const c = canon(d.data);
        if (mapa.get(d.id) !== c) { mapa.set(d.id, c); nubeDB.collection(col).doc(d.id).set(limpio(d.data)).catch(fallaNube); }
      }
      for (const id of [...mapa.keys()]) {
        if (!ids.has(id)) { mapa.delete(id); nubeDB.collection(col).doc(id).delete().catch(fallaNube); }
      }
    }
  }

  // Construye las listas a partir de lo que hay en la nube
  function estadoDeLaNube() {
    const lists = nubeDocs.listas
      .slice().sort((a, b) => (a.data.orden || 0) - (b.data.orden || 0))
      .map((d) => ({ id: d.id, name: d.data.name || 'Lista', emoji: d.data.emoji || emojiFor(d.data.name || ''), items: [] }));
    const porId = new Map(lists.map((l) => [l.id, l]));
    for (const d of nubeDocs.items) {
      const l = porId.get(d.data.listId);
      if (!l) continue;
      const it = { id: d.id, text: d.data.text || '', done: !!d.data.done, createdAt: d.data.createdAt || 0 };
      if (d.data.audioId) it.audioId = d.data.audioId;
      l.items.push(it);
    }
    lists.forEach((l) => l.items.sort((a, b) => b.createdAt - a.createdAt));
    return { lists };
  }

  function recordarSubido() {
    for (const col of ['listas', 'items']) {
      subido[col] = new Map(nubeDocs[col].map((d) => [d.id, canon(d.data)]));
    }
  }

  const claveMigrada = () => 'dilo:nube:' + nubeDB.hogarId;

  // Primera vez en este móvil: juntar lo que había aquí con lo que hay en la nube.
  // Las listas con el mismo nombre se unen; no se borra nada.
  function migrarAlaNube() {
    const nube = estadoDeLaNube();
    const norm = (n) => window.VoiceParser.normalize(n);
    let nuevas = 0;
    for (const local of state.lists) {
      let destino = nube.lists.find((l) => l.id === local.id) || nube.lists.find((l) => norm(l.name) === norm(local.name));
      if (!destino) {
        destino = { id: local.id, name: local.name, emoji: local.emoji, items: [] };
        nube.lists.push(destino);
      }
      for (const it of local.items) {
        if (!nube.lists.some((l) => l.items.some((x) => x.id === it.id))) { destino.items.push(it); nuevas++; }
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
  }

  function alCambiarLaNube() {
    if (!nubeListo.listas || !nubeListo.items) return;
    if (!nubeMigrada) { migrarAlaNube(); return; }
    const nube = estadoDeLaNube();
    if (!nube.lists.some((l) => l.name === INBOX_NAME)) nube.lists.unshift({ id: uid(), name: INBOX_NAME, emoji: '📥', items: [] });
    state = nube;
    recordarSubido();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    pushCloud();   // por si hubo que crear la bandeja
    if (currentListId && !getList(currentListId)) currentListId = null;
    render();
  }

  function conectarListas(base) {
    nubeUnsubs.forEach((u) => { try { u(); } catch (e) {} });
    nubeUnsubs = [];
    nubeDB = base;
    nubeListo.listas = nubeListo.items = false;
    nubeDocs.listas = []; nubeDocs.items = [];
    if (!base) { nubeMigrada = false; return; }
    nubeMigrada = (() => { try { return localStorage.getItem(claveMigrada()) === '1'; } catch (e) { return false; } })();
    for (const col of ['listas', 'items']) {
      nubeUnsubs.push(base.collection(col).onSnapshot((snap) => {
        nubeDocs[col] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
        // Para juntar por primera vez esperamos la respuesta del servidor, no solo la caché
        if (!snap.metadata.fromCache || nubeMigrada) nubeListo[col] = true;
        alCambiarLaNube();
      }, fallaNube));
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
    }
    return list;
  }

  function addItems(list, texts, extra = {}) {
    const ahora = Date.now();
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
  function handleInput(text) {
    const result = parse(text, state.lists);
    if (!result) return;
    snapshot();

    // Si estás dentro de una lista y no nombras otra, va a la lista que tienes abierta
    const open = getList(currentListId || targetListId);
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
      const exists = findList(state.lists, result.list);
      const list = ensureList(result.list);
      if (result.items && result.items.length) {
        addItems(list, result.items);
        save(); render();
        const what = result.items.length === 1 ? `«${result.items[0]}»` : `${result.items.length} elementos`;
        toast(`${list.emoji} ${exists ? '' : 'Lista nueva · '}${what} → ${list.name}`, true);
        notifySaved(list, result.items);
        return;
      }
      save(); render();
      toast(exists ? `La lista «${list.name}» ya existía` : `Lista «${list.name}» creada`, true);
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
    $('chips').hidden = on || !!(currentListId && getList(currentListId));
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
  // Tras apuntar algo, sale un aviso en el móvil. Al tocarlo se abre la lista para revisarlo.
  const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator;

  function askNotifyPermission() {
    if (canNotify() && Notification.permission === 'default') {
      Notification.requestPermission().then(renderNotifyBtn).catch(() => {});
    }
  }

  async function notifySaved(list, items) {
    if (!canNotify() || Notification.permission !== 'granted') return;
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
    $('askOk').classList.toggle('danger-btn', isConfirm);
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
  function toast(msg, undoable = false) {
    $('toastMsg').textContent = msg;
    $('toastUndo').hidden = !undoable || !undoSnapshot;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
  }
  $('toastUndo').addEventListener('click', () => {
    if (!undoSnapshot) return;
    state = JSON.parse(undoSnapshot);
    undoSnapshot = null;
    if (currentListId && !getList(currentListId)) currentListId = null;
    save(); render();
    $('toast').hidden = true;
  });

  // ---------- Render ----------
  // Color de cada lista (siempre el mismo para el mismo nombre, en todos los móviles)
  const COLORES = ['#1D6FD1', '#2F8F6B', '#E08A00', '#8A4FBF', '#D1495B', '#0E9AA7', '#A8643A', '#558B2F'];
  function colorDe(list) {
    if (list.name === INBOX_NAME) return '#44515F';
    const n = window.VoiceParser.normalize(list.name);
    let h = 0;
    for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return COLORES[h % COLORES.length];
  }

  function render() {
    const list = currentListId && getList(currentListId);
    $('homeView').hidden = !!list;
    $('homeHead').hidden = !!list;
    $('listView').hidden = !list;
    $('listHead').hidden = !list;
    if (list) renderList(list); else renderHome();
    renderChips();
    renderComposer();
  }

  // ---- Inicio ----
  function saludo() {
    const h = new Date().getHours();
    const base = h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
    const N = window.DiloNube;
    const nombre = N && N.usuario && N.usuario.nombre ? N.usuario.nombre.split(' ')[0] : '';
    return nombre ? `${base}, ${nombre}` : base;
  }

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

  function renderAgendaTile() {
    const prox = agendaPending();
    const { fam } = leerAgenda();
    const c = prox[0];
    const count = $('atCount');
    count.textContent = prox.length;
    count.classList.toggle('has', prox.length > 0);
    if (!c) {
      $('atMes').textContent = new Date().toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
      $('atDia').textContent = new Date().getDate();
      $('atTitulo').textContent = 'Sin citas próximas';
      $('atDetalle').textContent = 'Toca para apuntar una';
      return;
    }
    const [y, m, d] = c.fecha.split('-').map(Number);
    const f = new Date(y, m - 1, d);
    $('atMes').textContent = f.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
    $('atDia').textContent = d;
    $('atTitulo').textContent = c.titulo || 'Cita';
    const quien = c.de === 'familia' ? 'Toda la familia' : (fam.find((p) => p.id === c.de) || {}).n;
    const cuando = c.fecha === hoyISO() ? 'Hoy' : f.toLocaleDateString('es-ES', { weekday: 'long' });
    $('atDetalle').textContent = [cuando.charAt(0).toUpperCase() + cuando.slice(1), c.hora, quien].filter(Boolean).join(' · ');
  }

  function renderHome() {
    const hoy = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    $('hoyFecha').textContent = hoy.charAt(0).toUpperCase() + hoy.slice(1);
    $('saludo').textContent = saludo();

    const bandeja = inbox();
    const porOrdenar = bandeja ? bandeja.items.filter((i) => !i.done).length : 0;
    $('inboxBanner').hidden = !porOrdenar;
    $('inboxTitle').textContent = porOrdenar === 1 ? '1 cosa por ordenar' : `${porOrdenar} cosas por ordenar`;

    renderAgendaTile();

    const wrap = $('lists');
    wrap.replaceChildren();
    for (const l of state.lists) {
      const pend = l.items.filter((i) => !i.done);
      const tile = el('button', { class: 'tile', type: 'button', style: `--hue:${colorDe(l)}`, 'aria-label': `${l.name}, ${pend.length} pendientes` },
        el('span', { class: 'tile-top' },
          el('span', { class: 'tile-emoji', text: l.emoji }),
          el('span', { class: 'tile-count' + (pend.length ? ' has' : ''), text: String(pend.length) })),
        el('span', { class: 'tile-name', text: l.name }),
        pend.length ? el('ul', { class: 'tile-peek' }, ...pend.slice(0, 2).map((i) => el('li', { text: i.text }))) : null);
      tile.addEventListener('click', () => { openList(l.id); });
      wrap.appendChild(tile);
    }
  }

  // ---- Una lista ----
  function cuandoFue(ts) {
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 1) return 'Ahora mismo';
    if (min < 60) return `Hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `Hace ${h} h`;
    const d = new Date(ts);
    const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    if (d.toDateString() === ayer.toDateString()) return 'Ayer';
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

  function fila(list, item) {
    const li = el('li', { class: 'row' + (item.done ? ' done' : '') + (recienApuntados.has(item.id) ? ' nuevo' : '') });
    const chk = el('button', { class: 'check', type: 'button', 'aria-label': item.done ? 'Marcar como pendiente' : 'Marcar como hecho', 'aria-pressed': String(!!item.done) });
    chk.innerHTML = ICON_CHECK;
    chk.addEventListener('click', () => { item.done = !item.done; save(); render(); });
    const txt = el('button', { class: 'row-text', type: 'button', 'aria-label': 'Editar: ' + item.text },
      el('b', { text: item.text }), el('span', { text: cuandoFue(item.createdAt) }));
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
    const pend = list.items.filter((i) => !i.done);
    const hechas = list.items.filter((i) => i.done);
    document.documentElement.style.setProperty('--hue', colorDe(list));
    $('listEmoji').textContent = list.emoji;
    $('title').textContent = list.name;
    $('listSub').textContent = list.items.length
      ? `${pend.length} ${pend.length === 1 ? 'pendiente' : 'pendientes'}${hechas.length ? ` · ${hechas.length} ${hechas.length === 1 ? 'hecha' : 'hechas'}` : ''}`
      : 'Vacía';

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

  // ---- Barra inferior: etiquetas para elegir lista y caja de texto ----
  function renderChips() {
    const box = $('chips');
    const enLista = !!(currentListId && getList(currentListId));
    box.hidden = enLista || listening;
    if (box.hidden) return;
    if (targetListId && !getList(targetListId)) targetListId = null;
    box.replaceChildren(el('span', { class: 'chip-label', text: 'Apuntar en' }));
    for (const l of state.lists) {
      const on = l.id === targetListId;
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(on) }, `${l.emoji} ${l.name}`);
      b.addEventListener('click', () => {
        targetListId = on ? null : l.id;
        render();
        if (!on) $('textInput').focus({ preventScroll: true });
      });
      box.append(b);
    }
  }

  function renderComposer() {
    const l = getList(currentListId || targetListId);
    $('textInput').placeholder = l && l.name !== INBOX_NAME ? `Añadir a ${l.name}…` : 'Escribe o pulsa el micro…';
    const conTexto = !!$('textInput').value.trim();
    $('sendBtn').hidden = !conTexto;
  }
  $('textInput').addEventListener('input', renderComposer);

  $('listMenuBtn').addEventListener('click', () => {
    const l = getList(currentListId);
    if (!l) return;
    $('listMenuTitle').textContent = `${l.emoji} ${l.name}`;
    $('listMenu').showModal();
  });
  for (const id of ['renameListBtn', 'clearDoneBtn', 'deleteListBtn']) {
    $(id).addEventListener('click', () => { if ($('listMenu').open) $('listMenu').close(); });
  }

  // ---------- Acciones de lista ----------
  $('backBtn').addEventListener('click', () => { currentListId = null; render(); window.scrollTo(0, 0); });
  $('helpBtn').addEventListener('click', () => $('helpDialog').showModal());
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
    if (!$('homeView').hidden) $('saludo').textContent = saludo();
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
      lista.append(el('li', {}, el('span', { text: m + (yo ? ' (tú)' : '') }),
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
      if (id !== hogarActual) { hogarActual = id; conectarListas(id ? N.db() : null); }
      renderCloud();
    });
    N.onMiembros(renderCloud);
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
    });
  }

  if (params.has('voz')) {
    setTimeout(() => micBtn.click(), 300);
  }

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
})();
