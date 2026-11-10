(function () {
  'use strict';

  const { parse, findList, INBOX_NAME } = window.VoiceParser;
  const STORAGE_KEY = 'dilo.v1';
  const VERSION = '0.3';
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

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('⚠️ No se pudo guardar en este dispositivo'); }
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
    for (const text of [...texts].reverse()) {
      list.items.unshift({ id: uid(), text, done: false, createdAt: Date.now(), ...extra });
    }
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
    const open = currentListId && getList(currentListId);
    if (result.type === 'inbox' && open && open.name !== INBOX_NAME) {
      const items = window.VoiceParser.splitItems(result.items[0]);
      addItems(open, items);
      save(); render();
      const what = items.length === 1 ? `«${items[0]}»` : `${items.length} elementos`;
      toast(`${open.emoji} ${what} → ${open.name}`, true);
      return;
    }

    if (result.type === 'create') {
      const exists = findList(state.lists, result.list);
      const list = ensureList(result.list);
      save(); render();
      toast(exists ? `La lista «${list.name}» ya existía` : `Lista «${list.name}» creada`, true);
      return;
    }

    const list = result.type === 'inbox' ? inbox() : ensureList(result.list);
    addItems(list, result.items);
    save(); render();
    const what = result.items.length === 1 ? `«${result.items[0]}»` : `${result.items.length} elementos`;
    toast(`${list.emoji} ${what} → ${list.name}${result.created ? ' (nueva)' : ''}`, true);
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
  });

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
  function render() {
    const list = currentListId && getList(currentListId);
    $('homeView').hidden = !!list;
    $('listView').hidden = !list;
    $('backBtn').hidden = !list;
    $('title').textContent = list ? `${list.emoji} ${list.name}` : 'Dilo';
    if (list) renderList(list); else renderHome();
  }

  function renderHome() {
    const wrap = $('lists');
    wrap.innerHTML = '';
    for (const l of state.lists) {
      const pending = l.items.filter((i) => !i.done).length;
      const b = document.createElement('button');
      b.className = 'list-card' + (l.name === INBOX_NAME ? ' inbox' : '');
      b.innerHTML = `<span class="emoji"></span><span class="name"></span><span class="count"></span>`;
      b.querySelector('.emoji').textContent = l.emoji;
      b.querySelector('.name').textContent = l.name;
      const c = b.querySelector('.count');
      c.textContent = pending;
      if (pending) c.classList.add('has');
      b.addEventListener('click', () => { currentListId = l.id; render(); window.scrollTo(0, 0); });
      wrap.appendChild(b);
    }
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function renderList(list) {
    const ul = $('items');
    ul.innerHTML = '';
    const isInbox = list.name === INBOX_NAME;
    $('emptyMsg').hidden = list.items.length > 0;
    $('deleteListBtn').hidden = isInbox;
    $('renameListBtn').hidden = isInbox;

    const sorted = [...list.items].sort((a, b) => a.done - b.done);
    for (const item of sorted) {
      const li = document.createElement('li');
      li.className = 'item' + (item.done ? ' done' : '');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done;
      cb.setAttribute('aria-label', 'Completado');
      cb.addEventListener('change', () => { item.done = cb.checked; save(); render(); });

      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = item.text;
      const date = document.createElement('span');
      date.className = 'date';
      date.textContent = fmtDate(item.createdAt);
      text.appendChild(date);
      if (item.audioId) {
        const audio = document.createElement('audio');
        audio.controls = true;
        getAudio(item.audioId).then((blob) => { if (blob) audio.src = URL.createObjectURL(blob); });
        text.appendChild(audio);
      }

      const actions = document.createElement('div');
      actions.className = 'actions';

      // Mover a otra lista (clave para organizar la bandeja de entrada)
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Mover a lista');
      sel.innerHTML = '<option value="">📂</option>';
      sel.title = isInbox ? 'Organizar en una lista' : 'Mover a otra lista';
      for (const l of state.lists) {
        if (l.id === list.id) continue;
        const o = document.createElement('option');
        o.value = l.id;
        o.textContent = `${l.emoji} ${l.name}`;
        sel.appendChild(o);
      }
      const n = document.createElement('option');
      n.value = '__new';
      n.textContent = '+ Nueva lista…';
      sel.appendChild(n);
      sel.addEventListener('change', async () => {
        let target = null;
        if (sel.value === '__new') {
          const name = await ask('Nombre de la nueva lista');
          if (name && name.trim()) target = ensureList(name.trim());
        } else if (sel.value) {
          target = getList(sel.value);
        }
        if (!target) { sel.value = ''; return; }
        snapshot();
        list.items = list.items.filter((i) => i.id !== item.id);
        target.items.unshift(item);
        save(); render();
        toast(`Movido a ${target.emoji} ${target.name}`, true);
      });

      const edit = document.createElement('button');
      edit.textContent = '✏️';
      edit.setAttribute('aria-label', 'Editar');
      edit.addEventListener('click', async () => {
        const t = await ask('Editar', item.text);
        if (t && t.trim()) { item.text = t.trim(); save(); render(); }
      });

      const del = document.createElement('button');
      del.textContent = '🗑️';
      del.setAttribute('aria-label', 'Borrar');
      del.addEventListener('click', () => {
        snapshot();
        list.items = list.items.filter((i) => i.id !== item.id);
        save(); render();
        toast('Elemento borrado', true);
      });

      actions.append(sel, edit, del);
      li.append(cb, text, actions);
      ul.appendChild(li);
    }
  }

  // ---------- Acciones de lista ----------
  $('backBtn').addEventListener('click', () => { currentListId = null; render(); });
  $('helpBtn').addEventListener('click', () => $('helpDialog').showModal());
  $('version').textContent = 'Versión ' + VERSION;

  $('newListBtn').addEventListener('click', async () => {
    const name = await ask('Nombre de la nueva lista');
    if (!name || !name.trim()) return;
    snapshot();
    const list = ensureList(name.trim());
    save();
    currentListId = list.id;
    render();
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

  // Atajo: abrir la app con ?voz para empezar a hablar directamente
  if (new URLSearchParams(location.search).has('voz')) {
    setTimeout(() => micBtn.click(), 300);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
})();
