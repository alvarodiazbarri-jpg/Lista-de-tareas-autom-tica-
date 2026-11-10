// Conexión de Dilo con la nube (Firebase): entrar con Google, la «casa» compartida
// y una base de datos con la misma forma de uso que tenía «Mi agenda» en Claude.
//
// Lo usan index.html (listas) y agenda.html (citas). Expone window.DiloNube y avisa
// con el evento «dilonube» cuando está listo.

import { initializeApp } from './vendor/firebase/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut, reauthenticateWithPopup,
} from './vendor/firebase/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot, query, where, getDocs, addDoc,
  updateDoc, arrayUnion, arrayRemove, serverTimestamp,
} from './vendor/firebase/firebase-firestore.js';

// Datos públicos del proyecto (no son contraseñas: las reglas de Firestore protegen los datos)
const firebaseConfig = {
  apiKey: 'AIzaSyBHYBfgXlfYARbokRbC1wBytES7v_C6Ej4',
  authDomain: 'dilo-2dfb7.firebaseapp.com',
  projectId: 'dilo-2dfb7',
  storageBucket: 'dilo-2dfb7.firebasestorage.app',
  messagingSenderId: '276485665018',
  appId: '1:276485665018:web:b719c388695b8aef165943',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Caché en el móvil: se puede apuntar sin conexión y se sube al volver la red
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const HOGAR_KEY = 'dilo:hogar';
const TASKS_KEY = 'dilo:tasks';
const listeners = new Set();
let user = null;
let hogar = null;          // { id, nombre, miembros, creador }
let hogares = [];          // casas en las que está este correo
let hogarUnsub = null;
let estado = 'cargando';   // cargando | fuera | sin-casa | dentro
let ultimoError = '';

const correo = () => (user && user.email ? user.email.toLowerCase() : '');

function avisar() {
  for (const fn of listeners) { try { fn(api); } catch (e) { console.error(e); } }
}

function leerHogarGuardado() { try { return localStorage.getItem(HOGAR_KEY); } catch (e) { return null; } }
function guardarHogar(id) { try { id ? localStorage.setItem(HOGAR_KEY, id) : localStorage.removeItem(HOGAR_KEY); } catch (e) {} }

// Perfiles de la casa (nombre y foto de cada persona), en hogares/{id}/perfiles/{correo}.
// Sirven para enseñar quién apuntó cada cosa.
let perfiles = new Map();
let perfilesUnsub = null;
function seguirPerfiles(id) {
  if (perfilesUnsub) { perfilesUnsub(); perfilesUnsub = null; }
  perfiles = new Map();
  if (!id) return;
  const yo = correo();
  if (yo && user) {
    setDoc(doc(db, 'hogares', id, 'perfiles', yo), {
      nombre: user.displayName || '', foto: user.photoURL || '', visto: serverTimestamp(),
      version: window.DILO_VERSION || '',
    }).catch(() => {});
  }
  perfilesUnsub = onSnapshot(collection(db, 'hogares', id, 'perfiles'), (s) => {
    perfiles = new Map(s.docs.map((d) => [d.id, d.data()]));
    avisarMiembros();
  }, () => {});
}

function seguirHogar(id) {
  if (hogarUnsub) { hogarUnsub(); hogarUnsub = null; }
  seguirPerfiles(id);
  if (!id) { hogar = null; return; }
  hogarUnsub = onSnapshot(doc(db, 'hogares', id), (s) => {
    if (!s.exists() || !(s.data().miembros || []).includes(correo())) {
      // Ya no está en esa casa (le han quitado)
      hogar = null; guardarHogar(null); estado = 'sin-casa'; avisar(); return;
    }
    const antes = hogar && hogar.id;
    hogar = { id: s.id, ...s.data() };
    estado = 'dentro';
    if (antes !== hogar.id) avisar(); else avisarMiembros();
  }, (e) => { ultimoError = e.code || String(e); avisar(); });
}

const miembrosListeners = new Set();
function avisarMiembros() { for (const fn of miembrosListeners) { try { fn(api); } catch (e) {} } }

async function buscarHogares() {
  const q = query(collection(db, 'hogares'), where('miembros', 'array-contains', correo()));
  const s = await getDocs(q);
  hogares = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  return hogares;
}

async function alEntrar() {
  try {
    const lista = await buscarHogares();
    const guardado = leerHogarGuardado();
    const elegido = lista.find((h) => h.id === guardado) || lista[0];
    if (elegido) {
      guardarHogar(elegido.id);
      hogar = elegido;
      estado = 'dentro';
      seguirHogar(elegido.id);
    } else {
      estado = 'sin-casa';
    }
  } catch (e) {
    // Sin conexión: si ya conocíamos la casa, seguimos con la caché del móvil
    const guardado = leerHogarGuardado();
    if (guardado) { hogar = { id: guardado, nombre: '', miembros: [correo()] }; estado = 'dentro'; seguirHogar(guardado); }
    else { estado = 'sin-casa'; ultimoError = e.code || String(e); }
  }
  avisar();
}

// Base de datos de la casa, con la misma forma que la de «Mi agenda» en Claude:
// db.collection('citas').doc(id).set(datos) / .delete() / .onSnapshot(fn, err)
// db.doc('ajustes/general').set(datos) / .onSnapshot(fn, err)
function baseEn(base, hogarId) {
  return {
    hogarId,
    collection(nombre) {
      return {
        doc(id) {
          const ref = doc(db, ...base, nombre, id);
          return { set: (datos) => setDoc(ref, datos), delete: () => deleteDoc(ref) };
        },
        onSnapshot(fn, err) {
          return onSnapshot(collection(db, ...base, nombre), { includeMetadataChanges: true }, fn, err);
        },
      };
    },
    doc(ruta) {
      const ref = doc(db, ...base, ...ruta.split('/'));
      return {
        set: (datos) => setDoc(ref, datos),
        onSnapshot(fn, err) {
          return onSnapshot(ref, (s) => fn({ exists: s.exists(), data: () => s.data(), metadata: s.metadata }), err);
        },
      };
    },
  };
}

// Colores de las personas de la casa (en el orden en que entraron, para que no se repitan)
const COLORES_PERSONA = ['#1D6FD1', '#D1495B', '#2F8F6B', '#8A4FBF', '#E08A00', '#0E9AA7', '#A8643A', '#C2185B'];

function persona(email) {
  const e = (email || '').toLowerCase();
  if (!e) return null;
  const p = perfiles.get(e) || {};
  const yo = e === correo();
  let nombre = (p.nombre || (yo && user && user.displayName) || '').trim().split(/\s+/)[0];
  if (!nombre) nombre = e.split('@')[0];
  nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);
  const lista = (hogar && hogar.miembros) || [];
  let i = lista.indexOf(e);
  if (i < 0) { i = 0; for (const c of e) i = (i * 31 + c.charCodeAt(0)) >>> 0; }
  return {
    correo: e, nombre, yo,
    inicial: nombre.charAt(0).toUpperCase(),
    foto: p.foto || (yo && user && user.photoURL) || '',
    color: COLORES_PERSONA[i % COLORES_PERSONA.length],
  };
}

function baseDeLaCasa() {
  return hogar ? baseEn(['hogares', hogar.id], hogar.id) : null;
}
// Lo privado de cada persona (listas «Solo para mí»): usuarios/{uid}, que solo puede leer esa persona
function baseMia() {
  return user ? baseEn(['usuarios', user.uid], hogar ? hogar.id : '') : null;
}

const api = {
  get estado() { return estado; },
  get usuario() { return user ? { correo: correo(), nombre: user.displayName || '', foto: user.photoURL || '' } : null; },
  get hogar() { return hogar; },
  get hogares() { return hogares; },
  get error() { return ultimoError; },
  db: baseDeLaCasa,
  dbMia: baseMia,
  persona,
  // Versión de Dilo que usó cada persona la última vez ('' si es anterior a la 0.8)
  versionDe(email) { const p = perfiles.get((email || '').toLowerCase()); return p ? (p.version || '0.8') : ''; },
  // ¿Hay más de una persona en la casa? (si estás solo, no hace falta decir quién apuntó)
  get compartida() { return !!(hogar && (hogar.miembros || []).length > 1); },

  onChange(fn) { listeners.add(fn); if (estado !== 'cargando') fn(api); return () => listeners.delete(fn); },
  onMiembros(fn) { miembrosListeners.add(fn); return () => miembrosListeners.delete(fn); },

  async entrar() {
    const prov = new GoogleAuthProvider();
    prov.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, prov);
    } catch (e) {
      // Si el móvil bloquea la ventana, probamos redirigiendo
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
        await signInWithRedirect(auth, prov);
        return;
      }
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
      throw e;
    }
  },

  // Permiso para leer Google Tasks (lo que se dicta a «Hey Google, recuérdame…»).
  // Google da un permiso que dura 1 hora: lo guardamos en el móvil y, cuando caduca, hay que
  // volver a pedirlo con un toque (sale y se cierra una ventanita de Google).
  tokenTasksGuardado() {
    try {
      const t = JSON.parse(localStorage.getItem(TASKS_KEY));
      return t && t.correo === correo() && t.hasta > Date.now() ? t.token : null;
    } catch (e) { return null; }
  },
  async pedirTokenTasks() {
    if (!user) throw new Error('fuera');
    const prov = new GoogleAuthProvider();
    prov.addScope('https://www.googleapis.com/auth/tasks');
    prov.setCustomParameters({ login_hint: user.email || '' });
    const res = await reauthenticateWithPopup(user, prov);
    const cred = GoogleAuthProvider.credentialFromResult(res);
    const token = cred && cred.accessToken;
    if (!token) throw new Error('sin-permiso');
    try { localStorage.setItem(TASKS_KEY, JSON.stringify({ token, correo: correo(), hasta: Date.now() + 50 * 60000 })); } catch (e) {}
    return token;
  },
  olvidarTokenTasks() { try { localStorage.removeItem(TASKS_KEY); } catch (e) {} },

  async salir() {
    if (hogarUnsub) { hogarUnsub(); hogarUnsub = null; }
    seguirPerfiles(null);
    hogar = null; guardarHogar(null);
    await signOut(auth);
  },

  async crearHogar(nombre) {
    const ref = await addDoc(collection(db, 'hogares'), {
      nombre: (nombre || '').trim() || 'Mi casa',
      miembros: [correo()],
      creador: user.uid,
      creado: serverTimestamp(),
    });
    guardarHogar(ref.id);
    hogar = { id: ref.id, nombre, miembros: [correo()], creador: user.uid };
    estado = 'dentro';
    seguirHogar(ref.id);
    avisar();
  },

  async buscarDeNuevo() { await alEntrar(); },

  async invitar(email) {
    const e = (email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('correo');
    await updateDoc(doc(db, 'hogares', hogar.id), { miembros: arrayUnion(e) });
  },

  async quitar(email) {
    await updateDoc(doc(db, 'hogares', hogar.id), { miembros: arrayRemove(email) });
  },
};

window.DiloNube = api;

getRedirectResult(auth).catch((e) => { ultimoError = e.code || String(e); });

onAuthStateChanged(auth, (u) => {
  user = u;
  if (!u) {
    if (hogarUnsub) { hogarUnsub(); hogarUnsub = null; }
    seguirPerfiles(null);
    hogar = null; hogares = []; estado = 'fuera';
    avisar();
    return;
  }
  alEntrar();
});

window.dispatchEvent(new Event('dilonube'));
