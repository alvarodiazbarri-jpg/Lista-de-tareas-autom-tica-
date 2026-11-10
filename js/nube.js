// Conexión de Dilo con la nube (Firebase): entrar con Google, la «casa» compartida
// y una base de datos con la misma forma de uso que tenía «Mi agenda» en Claude.
//
// Lo usan index.html (listas) y agenda.html (citas). Expone window.DiloNube y avisa
// con el evento «dilonube» cuando está listo.

import { initializeApp } from './vendor/firebase/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut,
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

function seguirHogar(id) {
  if (hogarUnsub) { hogarUnsub(); hogarUnsub = null; }
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
function baseDeLaCasa() {
  if (!hogar) return null;
  const base = ['hogares', hogar.id];
  return {
    hogarId: hogar.id,
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

const api = {
  get estado() { return estado; },
  get usuario() { return user ? { correo: correo(), nombre: user.displayName || '', foto: user.photoURL || '' } : null; },
  get hogar() { return hogar; },
  get hogares() { return hogares; },
  get error() { return ultimoError; },
  db: baseDeLaCasa,

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

  async salir() {
    if (hogarUnsub) { hogarUnsub(); hogarUnsub = null; }
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
    hogar = null; hogares = []; estado = 'fuera';
    avisar();
    return;
  }
  alEntrar();
});

window.dispatchEvent(new Event('dilonube'));
