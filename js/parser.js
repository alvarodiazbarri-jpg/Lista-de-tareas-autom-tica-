// Interpreta lo que dices y decide qué hacer con ello.
// Devuelve { type: 'create' | 'add' | 'inbox', list?, items? }

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
      .replace(/^(?:(?:la|el|las|los|mi|mis)\s+)?(?:lista\s+(?:de\s+(?:la\s+|el\s+|las\s+|los\s+)?|llamada\s+)?)?/i, '')
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

  const CREATE_RE = /^(?:crea|crear|creame|haz|hazme|abre|nueva|nuevo|empieza)\s+(?:una\s+)?(?:nueva\s+)?lista\s+(?:de\s+|llamada\s+|para\s+)?(.+)$/i;
  const NEW_LIST_RE = /^(?:nueva|una nueva)\s+lista\s*(?:de\s+|llamada\s+|para\s+)?(.+)$/i;
  const ADD_VERBS = '(?:anade|anadir|anademe|agrega|agregar|apunta|apuntame|apuntar|pon|ponme|poner|mete|meter|incluye|incluir|guarda|guardar|anota|anotar)';
  const ADD_RE = new RegExp('^' + ADD_VERBS + '\\s+(.+)\\s+(?:a|en|al)\\s+(.+)$', 'i');
  const ADD_NO_LIST_RE = new RegExp('^' + ADD_VERBS + '\\s+(.+)$', 'i');

  function parse(rawText, lists) {
    const original = rawText.trim().replace(/\s+/g, ' ');
    const text = normalize(original);
    if (!text) return null;

    // Para devolver el texto con tildes originales usamos posiciones equivalentes:
    // normalize() no cambia la longitud salvo signos de puntuación, así que
    // recortamos sobre una versión sin puntuación del original.
    const orig = original.replace(/[.!?¡¿;:]/g, '').replace(/\s+/g, ' ').trim();
    const sliceOrig = (start, len) => orig.substr(start, len);

    // 1) Crear lista
    let m = text.match(CREATE_RE) || text.match(NEW_LIST_RE);
    if (m) {
      const start = text.lastIndexOf(m[1]);
      const name = cleanListName(sliceOrig(start, m[1].length));
      if (name) return { type: 'create', list: capitalize(name) };
    }

    // 2) Añadir X a/en LISTA
    m = text.match(ADD_RE);
    if (m) {
      // Probamos todos los cortes posibles " a|en|al " empezando por el último
      const verbMatch = text.match(new RegExp('^' + ADD_VERBS + '\\s+', 'i'));
      const body = text.slice(verbMatch[0].length);
      const bodyOrig = orig.slice(verbMatch[0].length);
      const sepRe = /\s(?:a|en|al)\s/g;
      const cuts = [];
      let s;
      while ((s = sepRe.exec(body))) {
        cuts.push({ idx: s.index, len: s[0].length });
        sepRe.lastIndex = s.index + 1;
      }
      for (let i = cuts.length - 1; i >= 0; i--) {
        const c = cuts[i];
        const itemPart = bodyOrig.slice(0, c.idx);
        const listPart = bodyOrig.slice(c.idx + c.len);
        const existing = findList(lists, listPart);
        if (existing) {
          return { type: 'add', list: existing.name, items: splitItems(itemPart) };
        }
      }
      // Si dice explícitamente "lista", la creamos
      for (let i = cuts.length - 1; i >= 0; i--) {
        const c = cuts[i];
        const listPartNorm = body.slice(c.idx + c.len);
        if (/^(?:(?:la|mi)\s+)?lista\b/.test(listPartNorm)) {
          const itemPart = bodyOrig.slice(0, c.idx);
          const name = cleanListName(bodyOrig.slice(c.idx + c.len));
          if (name) {
            return { type: 'add', list: capitalize(name), items: splitItems(itemPart), created: true };
          }
        }
      }
    }

    // 3) Empieza por el nombre de una lista: "compra: leche y pan" / "tareas llamar al médico"
    const sortedLists = [...lists].sort((a, b) => b.name.length - a.name.length);
    for (const l of sortedLists) {
      const n = normalize(l.name);
      const prefixes = [n, 'lista de ' + n, 'lista ' + n, 'en ' + n, 'para ' + n];
      for (const p of prefixes) {
        if (text.startsWith(p + ' ') && text.length > p.length + 1) {
          const rest = orig.slice(p.length).replace(/^[\s,]+/, '');
          if (rest) return { type: 'add', list: l.name, items: splitItems(rest) };
        }
      }
    }

    // 4) "apunta X" sin lista -> bandeja de entrada
    m = text.match(ADD_NO_LIST_RE);
    if (m) {
      const verbLen = text.length - m[1].length;
      return { type: 'inbox', list: INBOX_NAME, items: [capitalize(orig.slice(verbLen).trim())] };
    }

    // 5) Cualquier otra cosa: se guarda tal cual para organizarla luego
    return { type: 'inbox', list: INBOX_NAME, items: [capitalize(orig)] };
  }

  const api = { parse, normalize, findList, splitItems, INBOX_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VoiceParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
