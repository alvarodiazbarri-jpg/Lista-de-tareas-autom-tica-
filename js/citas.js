// Entiende citas dichas con la voz y las convierte en una cita de «Mi agenda».
//   «cita con el dentista el martes a las 10 para Julia»
//   «apunta en la agenda reunión del colegio el jueves a las 5 de la tarde»
//   «consulta del pediatra el 15 de diciembre a las 9 y media en el centro de salud»
// DiloCitas.parse(frase, { familia: [{id, n}], tipos: [{id, n}], hoy: Date })
//   → null si no es una cita, o { titulo, fecha: 'AAAA-MM-DD' | '', hora: 'HH:MM' | '', lugar, persona, de, cat }
// Se puede probar con Node: require('./js/citas.js').parse(frase, {...})

(function (global) {
  // Quita tildes y pasa a minúsculas letra a letra, para que el texto sin tildes y el original
  // tengan la misma longitud (así lo encontrado en uno se puede recortar del otro)
  const sinTilde = (s) => [...s].map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0) || c).join('').toLowerCase();
  const may = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const CLAVE_RE = /\b(?:cita|citas|consulta|revision|reunion|vacuna|analitica|agenda)\b/;
  const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const NUM = { una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
  const NUM_RE = '(\\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)';
  const aNum = (x) => (/^\d+$/.test(x) ? +x : NUM[x]);

  // Tipo de cita según las palabras (si existe ese tipo en la agenda)
  const PISTAS = [
    ['medica', /\b(?:medic[oa]|doctor[a]?|dentista|pediatra|enfermer[oa]|hospital|centro de salud|ambulatorio|analitica|vacuna|oculista|oftalmologo|dermatolog[oa]|ginecolog[oa]|fisio|fisioterapeuta|revision medica|urgencias|clinica|psicolog[oa]|logopeda|traumatolog[oa]|ojos|vista|dientes|muelas)\b/],
    ['trabajo', /\b(?:trabajo|oficina|jefe|cliente|reunion de trabajo|entrevista)\b/],
    ['tramite', /\b(?:banco|notari[ao]|ayuntamiento|dni|pasaporte|itv|hacienda|gestoria|seguro|registro|abogad[oa]|tramite|juzgado|correos)\b/],
  ];

  function parse(frase, opciones = {}) {
    const familia = opciones.familia || [];
    const tipos = opciones.tipos || [];
    const hoy = opciones.hoy ? new Date(opciones.hoy) : new Date();
    hoy.setHours(0, 0, 0, 0);

    let orig = frase.replace(/[!?¡¿;]/g, '').replace(/\s+/g, ' ').trim();
    let t = sinTilde(orig);
    if (!CLAVE_RE.test(t)) return null;
    // «añade leche a la lista» no es una cita aunque diga «agenda» en otro sentido: exigimos
    // la palabra clave al principio o «en la agenda»
    const quitar = (re) => {
      const m = t.match(re);
      if (!m) return null;
      orig = (orig.slice(0, m.index) + ' ' + orig.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
      t = sinTilde(orig);
      return m;
    };

    // Arranque: «oye», «apunta», «en la agenda», «que tengo», «una»…
    quitar(/^(?:(?:oye|vale|dilo|por favor|hola)\s+)+/);
    quitar(/\s*\b(?:en|a|para) (?:la|mi) agenda\b/);
    quitar(/^(?:(?:apuntame|apunta|anademe|anade|agrega|ponme|pon|guarda|guardame|crea|creame|agenda|recuerdame|anota|anotame)\s+)?(?:que\s+)?(?:(?:tengo|tenemos|tiene)\s+)?(?:(?:una|un|la|el)\s+)?/);
    if (!/^(?:cita|citas|consulta|revision|reunion|vacuna|analitica)\b/.test(t)) return null;

    // Hora: «a las 10», «a las 10:30», «a las 10 y media», «a las 5 de la tarde», «a mediodía»
    let hora = '';
    let m = quitar(new RegExp('\\b(?:a|sobre|para|hacia)\\s+(?:las|la)\\s+' + NUM_RE + '(?:(?:[:.h]|\\s+y\\s+)(\\d{2})|\\s+y\\s+(media|cuarto)|\\s+menos\\s+(cuarto))?(?:\\s*(?:h|horas))?(?:\\s+(?:de la|por la)\\s+(manana|tarde|noche)|\\s+(?:del|al)\\s+(mediodia))?\\b'));
    if (m) {
      let h = aNum(m[1]);
      let min = m[2] ? +m[2] : m[3] === 'media' ? 30 : m[3] === 'cuarto' ? 15 : 0;
      if (m[4]) { h -= 1; min = 45; }
      const parte = m[5] || (m[6] ? 'tarde' : '');
      if ((parte === 'tarde' || parte === 'noche') && h < 12) h += 12;
      else if (!parte && h >= 1 && h <= 7) h += 12;    // «a las 5» suele ser por la tarde
      if (h === 24) h = 0;
      if (h >= 0 && h < 24 && min < 60) hora = `${pad(h)}:${pad(min)}`;
    } else if ((m = quitar(/\b(?:a|al)\s+mediodia\b/))) hora = '12:00';
    else if ((m = quitar(/\b(\d{1,2})[:.](\d{2})\b/))) hora = `${pad(+m[1])}:${m[2]}`;

    // Fecha
    let fecha = '';
    const dentroDe = (dias) => { const d = new Date(hoy); d.setDate(d.getDate() + dias); return iso(d); };
    if ((m = quitar(/\bpasado\s+manana\b/))) fecha = dentroDe(2);
    else if ((m = quitar(/\b(?:para\s+)?(?:hoy|esta tarde|esta noche|esta manana)\b/))) fecha = dentroDe(0);
    else if ((m = quitar(/\b(?:para\s+)?manana\b/))) fecha = dentroDe(1);
    else if ((m = quitar(new RegExp('\\bdentro de\\s+' + NUM_RE + '\\s+(dias?|semanas?)\\b')))) fecha = dentroDe(aNum(m[1]) * (m[2].startsWith('semana') ? 7 : 1));
    if (!fecha && (m = quitar(new RegExp('\\b(?:(?:el|este|el proximo|el siguiente|para el)\\s+)?(' + DIAS.join('|') + ')(?:\\s+(?:que viene|proximo))?(?:\\s+(?:dia\\s+)?(\\d{1,2}))?\\b')))) {
      if (m[2]) {
        fecha = diaDelMes(+m[2]);
      } else {
        const wd = DIAS.indexOf(m[1]);
        let suma = (wd - hoy.getDay() + 7) % 7;
        if (suma === 0 && !/^este/.test(m[0])) suma = 7;
        fecha = dentroDe(suma);
      }
    }
    if (!fecha && (m = quitar(new RegExp('\\b(?:(?:el|para el)\\s+)?(?:dia\\s+)?(\\d{1,2})\\s+de\\s+(' + MESES.join('|') + ')(?:\\s+de(?:l)?\\s+(\\d{4}))?\\b')))) {
      fecha = fechaDe(+m[1], MESES.indexOf(m[2]), m[3] ? +m[3] : null);
    }
    if (!fecha && (m = quitar(/\b(?:el\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/))) {
      fecha = fechaDe(+m[1], +m[2] - 1, m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null);
    }
    if (!fecha && (m = quitar(/\b(?:el|para el)\s+(?:dia\s+)?(\d{1,2})\b/))) fecha = diaDelMes(+m[1]);

    function fechaDe(d, mes, anio) {
      if (d < 1 || d > 31 || mes < 0 || mes > 11) return '';
      let f = new Date(anio || hoy.getFullYear(), mes, d);
      if (!anio && f < hoy) f = new Date(hoy.getFullYear() + 1, mes, d);
      return iso(f);
    }
    function diaDelMes(d) {
      if (d < 1 || d > 31) return '';
      let f = new Date(hoy.getFullYear(), hoy.getMonth(), d);
      if (f < hoy) f = new Date(hoy.getFullYear(), hoy.getMonth() + 1, d);
      return iso(f);
    }

    // De quién es: «para Julia», «de Julia», «para toda la familia»
    let de = '';
    if (quitar(/\b(?:para|de|con)\s+(?:toda la familia|la familia|todos)\b/)) de = 'familia';
    if (!de) {
      for (const p of familia) {
        const n = sinTilde(p.n || '').trim();
        if (!n) continue;
        const re = new RegExp('\\b(?:para|de|del|a)\\s+(?:el|la|mi)?\\s*' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        if (quitar(re)) { de = p.id; break; }
      }
    }

    // Lo que queda: «cita con el dentista en la clínica Sonrisas»
    let titulo = orig.trim();
    let lugar = '';
    let persona = '';
    const clave = sinTilde(titulo).match(/^(cita|citas|consulta|revision|reunion|vacuna|analitica)\b\s*/);
    const palabra = clave ? clave[1] : '';
    if (/^(?:cita|citas|consulta)$/.test(palabra)) titulo = titulo.slice(clave[0].length);
    // «cita en el banco» → el título es el sitio
    let tt = sinTilde(titulo);
    const enIni = tt.match(/^(?:en|al|a)\s+(?:(?:el|la|los|las)\s+)?/);
    if (enIni && /^(?:cita|citas|consulta)$/.test(palabra)) { titulo = titulo.slice(enIni[0].length); tt = sinTilde(titulo); }
    else {
      const en = tt.match(/\s(?:en|al)\s+(?:(?:el|la|los|las)\s+)?/);
      if (en) { lugar = titulo.slice(en.index + en[0].length).trim(); titulo = titulo.slice(0, en.index); tt = sinTilde(titulo); }
    }
    // «cita con el dentista» → «Dentista»; «revisión con la doctora García» → persona «doctora García»
    const conIni = tt.match(/^(?:con|del|de|para)\s+(?:(?:el|la|los|las)\s+)?/);
    if (conIni && /^(?:cita|citas|consulta)$/.test(palabra)) { titulo = titulo.slice(conIni[0].length); tt = sinTilde(titulo); }
    const con = tt.match(/\scon\s+(?:(?:el|la)\s+)?/);
    if (con) { persona = titulo.slice(con.index + con[0].length).trim(); titulo = titulo.slice(0, con.index); }
    titulo = titulo.replace(/^(?:de|del|el|la)\s+/i, '').trim();
    if (!titulo) titulo = persona || lugar || may(palabra || 'cita');

    let cat = '';
    const todo = sinTilde([frase].join(' '));
    for (const [id, re] of PISTAS) if (re.test(todo) && (!tipos.length || tipos.some((x) => x.id === id))) { cat = id; break; }
    if (!cat) cat = tipos.some((x) => x.id === 'personal') ? 'personal' : (tipos[0] ? tipos[0].id : 'personal');

    return { titulo: may(titulo.trim()), fecha, hora, lugar: may(lugar), persona: may(persona), de, cat };
  }

  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DiloCitas = api;
})(typeof window !== 'undefined' ? window : globalThis);
