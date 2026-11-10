// Interpreta lo que dices y decide qué hacer con ello.
// Devuelve { type: 'create' | 'add' | 'inbox' | 'delete' | 'done', list?, items? }

(function (global) {
  const INBOX_NAME = 'Bandeja de entrada';

  function normalize(str) {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[.!?¡¿;:]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Quita artículos y la palabra "lista" del principio: "la lista de la compra" -> "compra"
  function cleanListName(str) {
    return str
      .replace(/^(?:(?:la|el|las|los|mi|mis|una|un)\s+)?(?:lista\s+(?:(?:nueva|nuevo)\s+)?(?:de\s+(?:la\s+|el\s+|las\s+|los\s+)?|llamada\s+|que se llame\s+)?)?/i, '')
      .replace(/^(?:la|el|las|los)\s+/i, '')
      .trim();
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function singular(n) {
    if (n.endsWith('es') && n.length > 4) return n.slice(0, -2);
    if (n.endsWith('s') && n.length > 3) return n.slice(0, -1);
    return n;
  }

  // Busca una lista existente por nombre (tolera tildes, artículos y plurales)
  function findList(lists, name) {
    const target = normalize(cleanListName(name));
    if (!target) return null;
    const exact = lists.find((l) => normalize(cleanListName(l.name)) === target);
    if (exact) return exact;
    const t = singular(target);
    return lists.find((l) => singular(normalize(cleanListName(l.name))) === t) || null;
  }

  // "pan, leche y huevos" -> ["pan", "leche", "huevos"]
  function splitItems(str) {
    return str
      .split(/\s*,\s*|\s+y\s+(?=\S)/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(capitalize);
  }

  const ADD_VERBS = '(?:anade|anadir|anademe|anademe|agrega|agregar|agregame|apunta|apuntame|apuntar|pon|ponme|poner|mete|meter|meteme|incluye|incluir|guarda|guardar|guardame|anota|anotar|anotame|escribe|escribir|escribeme|recuerdame)';
  const ADD_VERB_RE = new RegExp('^' + ADD_VERBS + '\\s+', 'i');
  const CREATE_VERB_RE = /^(?:crea|crear|creame|haz|hacer|hazme|abre|abrir|abreme|empieza|empezar|nueva|nuevo|anade|anadir|agrega)\b/;
  // Palabras de cortesía o de arranque que no aportan nada
  const LEAD_RE = /^(?:(?:oye|vale|bueno|venga|hola|dilo|por favor|quiero que|quiero|quisiera|me gustaria|necesito|puedes|podrias|me|tu)\s+)+/;
  const TRAIL_RE = /\s+(?:por favor|gracias)$/;
  const NAME_LEAD_RE = /^(?:(?:una|un|la|el|nueva|nuevo|que se llame|llamada|llamado|con el nombre de|con el nombre|de nombre|de|para|sobre)\s+)+/;

  // Borrar o marcar como hecho: «quita la leche de la compra», «borra pan», «tacha el pan»,
  // «marca la leche como hecha». La lista es opcional y solo cuenta si existe.
  const DEL_RE = /^(?:quita|quitar|quitame|borra|borrar|borrame|elimina|eliminar|eliminame|saca|sacar|sacame|suprime|suprimir)\s+/;
  const DONE_RE = /^(?:tacha|tachar|tachame|marca|marcar|marcame)\s+/;
  const DONE_TAIL_RE = /\s+(?:como\s+)?(?:hech[oa]s?|terminad[oa]s?|completad[oa]s?|comprad[oa]s?)$/;
  const ARTICULOS_RE = /^(?:(?:el|la|los|las|un|una|unos|unas|lo de|eso de)\s+)+/;

  function parseQuitar(text, orig, lists) {
    let type = null;
    let m = text.match(DEL_RE);
    if (m) type = 'delete';
    else if ((m = text.match(DONE_RE))) type = 'done';
    if (!type) return null;
    let body = text.slice(m[0].length);
    let bodyOrig = orig.slice(m[0].length);
    // «marca la leche como hecha»: quitamos «como hecha»
    const t = body.match(DONE_TAIL_RE);
    if (t) { body = body.slice(0, t.index); bodyOrig = bodyOrig.slice(0, t.index); }
    // «marca como hecho el pan»
    const h = body.match(/^como\s+(?:hech[oa]s?|terminad[oa]s?|completad[oa]s?)\s+/);
    if (h) { body = body.slice(h[0].length); bodyOrig = bodyOrig.slice(h[0].length); }
    // La lista, si se dice: «... de la compra», «... en tareas», «... de la lista de regalos»
    let list = null;
    const sepRe = /\s(?:de|del|en|a|al)\s/g;
    const cuts = [];
    let sm;
    while ((sm = sepRe.exec(body))) { cuts.push({ idx: sm.index, len: sm[0].length }); sepRe.lastIndex = sm.index + 1; }
    // De izquierda a derecha, para que «de la lista de la compra» se quite entero
    for (let i = 0; i < cuts.length && !list; i++) {
      const c = cuts[i];
      const found = findList(lists, bodyOrig.slice(c.idx + c.len));
      if (found) { list = found.name; body = body.slice(0, c.idx); bodyOrig = bodyOrig.slice(0, c.idx); }
    }
    const items = splitItems(bodyOrig)
      .map((x) => x.replace(new RegExp(ARTICULOS_RE.source, 'i'), '').trim())
      .filter(Boolean);
    if (!items.length) return null;
    return { type, list, items };
  }

  // Si se repite la frase entera ("compra pan compra pan") nos quedamos con una
  function collapseRepeat(str) {
    const w = str.split(' ');
    for (let n = 1; n <= w.length / 2; n++) {
      if (w.length % n) continue;
      const key = (i) => normalize(w.slice(i, i + n).join(' '));
      let all = true;
      for (let i = n; i < w.length; i += n) if (key(i) !== key(0)) { all = false; break; }
      if (all && n < w.length) return w.slice(0, n).join(' ');
    }
    return str;
  }

  function parse(rawText, lists) {
    const colon = rawText.indexOf(':');
    if (colon > 0) {
      const head = parse(rawText.slice(0, colon), lists);
      const tail = rawText.slice(colon + 1).trim();
      if (head && head.type === 'create' && !head.items && tail) {
        return { type: 'create', list: head.list, items: splitItems(tail.replace(/[.!?¡¿;:]/g, '')) };
      }
    }
    // orig y text tienen la misma longitud: text es orig sin tildes y en minúsculas
    let orig = rawText.replace(/[.!?¡¿;:]/g, '').replace(/\s+/g, ' ').trim();
    orig = collapseRepeat(orig);
    let text = normalize(orig);
    if (!text) return null;

    const cut = (from, to) => { orig = orig.slice(from, to).trim(); text = normalize(orig); };
    let m = text.match(LEAD_RE);
    if (m) cut(m[0].length);
    m = text.match(TRAIL_RE);
    if (m) cut(0, text.length - m[0].length);
    if (!text) return null;

    // 0) Borrar o marcar como hecho
    const q = parseQuitar(text, orig, lists);
    if (q) return q;

    // 1) Crear lista: "crea una lista de viajes", "hazme una lista nueva que se llame viajes",
    //    "nueva lista viajes", "añade una lista de regalos"
    const listIdx = text.search(/\blista\b/);
    if (listIdx >= 0 && (CREATE_VERB_RE.test(text) || /^lista nuev[ao]\b/.test(text))) {
      const before = text.slice(0, listIdx).trim().split(' ');
      if (before.length <= 3) {
        const after = orig.slice(listIdx + 5).trim();
        const lead = normalize(after).match(NAME_LEAD_RE);
        const name = (lead ? after.slice(lead[0].length) : after).trim();
        if (name) {
          // "crea una lista de viajes y apunta pasaporte" / "... con pasaporte y maleta"
          const nn = normalize(name);
          const sep = nn.match(new RegExp('\\s(?:y\\s+(?:' + ADD_VERBS.slice(3, -1) + ')|con|y dentro|y en ella(?:\\s+' + ADD_VERBS + ')?)\\s+'));
          if (sep) {
            const listName = name.slice(0, sep.index).trim();
            const items = name.slice(sep.index + sep[0].length).trim();
            if (listName && items) return { type: 'create', list: capitalize(listName), items: splitItems(items) };
          }
          return { type: 'create', list: capitalize(name) };
        }
      }
    }

    // 2) Añadir: quitamos el verbo ("apunta", "añade"...) si lo hay
    const verb = text.match(ADD_VERB_RE);
    const body = verb ? text.slice(verb[0].length) : text;
    const bodyOrig = verb ? orig.slice(verb[0].length) : orig;

    // 2a) La lista va delante: "apunta en tareas limpiar el motor", "compra: leche y pan",
    //     "en la lista de la compra pan"
    const sortedLists = [...lists].sort((a, b) => b.name.length - a.name.length);
    const listPrefix = /^(?:(?:a|en|al|para)\s+)?(?:(?:la|el|mi)\s+)?(?:lista\s+(?:de\s+)?(?:(?:la|el|las|los)\s+)?)?/;
    const pre = body.match(listPrefix)[0];
    for (const l of sortedLists) {
      const n = normalize(cleanListName(l.name));
      for (const cand of [n, singular(n) === n ? n + 's' : singular(n)]) {
        const rest = body.slice(pre.length);
        if (rest === cand) continue;
        if (rest.startsWith(cand + ' ')) {
          let items = bodyOrig.slice(pre.length + cand.length).replace(/^[\s,]+/, '');
          const v = normalize(items).match(ADD_VERB_RE);
          if (v) items = items.slice(v[0].length);
          if (items) return { type: 'add', list: l.name, items: splitItems(items) };
        }
      }
    }

    // 2b) La lista va detrás: "añade leche y pan a la compra"
    if (verb) {
      const sepRe = /\s(?:a|en|al|para)\s/g;
      const cuts = [];
      let s;
      while ((s = sepRe.exec(body))) {
        cuts.push({ idx: s.index, len: s[0].length });
        sepRe.lastIndex = s.index + 1;
      }
      for (let i = cuts.length - 1; i >= 0; i--) {
        const c = cuts[i];
        const existing = findList(lists, bodyOrig.slice(c.idx + c.len));
        if (existing) {
          return { type: 'add', list: existing.name, items: splitItems(bodyOrig.slice(0, c.idx)) };
        }
      }
      // Si dice explícitamente "lista" y no existe, la creamos
      for (let i = cuts.length - 1; i >= 0; i--) {
        const c = cuts[i];
        if (/^(?:(?:la|mi|una)\s+)?lista\b/.test(body.slice(c.idx + c.len))) {
          const name = cleanListName(bodyOrig.slice(c.idx + c.len));
          if (name) {
            return { type: 'add', list: capitalize(name), items: splitItems(bodyOrig.slice(0, c.idx)), created: true };
          }
        }
      }
      // "apunta X" sin lista -> bandeja de entrada
      return { type: 'inbox', list: INBOX_NAME, items: [capitalize(bodyOrig.trim())] };
    }

    // 3) Cualquier otra cosa: se guarda tal cual para organizarla luego
    return { type: 'inbox', list: INBOX_NAME, items: [capitalize(orig)] };
  }

  const api = { parse, normalize, findList, splitItems, INBOX_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VoiceParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
