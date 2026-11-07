(function () {
  'use strict';

  const { parse, findList, INBOX_NAME } = window.VoiceParser;
  const STORAGE_KEY = 'dilo.v1';
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
    return {
      lists: [INBOX_NAME, 'Tareas', 'Compra', 'Ideas'].map((name) => ({
        id: uid(), name, emoji: emojiFor(name), items: [],
      })),
    };
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
    recognition.continuous = true;
    finalText = '';
    let failedOver = false;

    recognition.onresult = (e) => {
      let interim = '';
      finalText = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      live.textContent = (finalText + interim).trim() || 'Escuchando…';
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
      const text = finalText.trim();
      if (text) handleInput(text);
      recognition = null;
    };
    recognition.start();
    setRecording(true, 'Escuchando… pulsa otra vez para terminar');
  }

  async function startAudioRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      toast('Este navegador no permite grabar. Escríbelo abajo.');
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
      toast('Permite el acceso al micrófono para grabar');
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
    // Dentro de una lista (que no sea la bandeja), lo escrito va directo a esa lista
    // salvo que sea un comando explícito.
    const list = currentListId && getList(currentListId);
    const parsed = parse(text, state.lists);
    if (list && list.name !== INBOX_NAME && parsed.type === 'inbox') {
      snapshot();
      addItems(list, window.VoiceParser.splitItems(parsed.items[0]));
      save(); render();
    } else {
      handleInput(text);
    }
    input.value = '';
  });

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
      sel.addEventListener('change', () => {
        let target = null;
        if (sel.value === '__new') {
          const name = prompt('Nombre de la nueva lista');
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
      edit.addEventListener('click', () => {
        const t = prompt('Editar', item.text);
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

  $('newListBtn').addEventListener('click', () => {
    const name = prompt('Nombre de la nueva lista');
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

  $('renameListBtn').addEventListener('click', () => {
    const list = getList(currentListId);
    const name = prompt('Nuevo nombre', list.name);
    if (!name || !name.trim()) return;
    list.name = name.trim();
    list.emoji = emojiFor(list.name);
    save(); render();
  });

  $('deleteListBtn').addEventListener('click', () => {
    const list = getList(currentListId);
    if (!list || !confirm(`¿Eliminar la lista «${list.name}»?`)) return;
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
