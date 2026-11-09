// Capa de datos: Firebase (compartido entre la familia) o modo demo (solo este móvil).
import { firebaseConfig } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';

export const isConfigured = () =>
  !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PEGA') && !!firebaseConfig.projectId;

// El código familiar nunca se guarda en la nube: se convierte en un identificador irreversible.
export async function householdIdFromCode(code) {
  const norm = code.trim().toLowerCase().replace(/\s+/g, ' ');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('donde-esta:' + norm));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const randomId = () =>
  (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 20);

// ───────────────────────── Firebase ─────────────────────────
export async function createFirebaseStore(hid, onStatus = () => {}) {
  const [appMod, authMod, fs] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-firestore.js')
  ]);
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const emu = localStorage.getItem('donde-esta-emulator'); // solo para pruebas locales
  if (emu && !auth.emulatorConfig) authMod.connectAuthEmulator(auth, `http://${emu}:9099`, { disableWarnings: true });
  const user = await new Promise(res => { const un = authMod.onAuthStateChanged(auth, u => { un(); res(u); }); });
  if (!user) await authMod.signInAnonymously(auth);

  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
    });
  } catch (e) { db = fs.getFirestore(app); }
  if (emu) { try { fs.connectFirestoreEmulator(db, emu, 8080); } catch {} }

  const hRef = fs.doc(db, 'households', hid);
  const col = n => fs.collection(db, 'households', hid, n);

  return {
    kind: 'firebase',
    async getHousehold() {
      const s = await fs.getDoc(hRef);
      return s.exists() ? s.data() : null;
    },
    setHousehold(data) { return fs.setDoc(hRef, data, { merge: true }); },
    addMember(name) { return fs.setDoc(hRef, { members: fs.arrayUnion(name) }, { merge: true }); },
    watchHousehold(cb) { return fs.onSnapshot(hRef, s => cb(s.data() || {})); },
    watch(name, cb) {
      return fs.onSnapshot(col(name), { includeMetadataChanges: true }, snap => {
        onStatus(snap.metadata.hasPendingWrites ? 'pending' : (snap.metadata.fromCache ? 'offline' : 'ok'));
        cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, err => { console.error(err); onStatus('error', err); });
    },
    newId(name) { return fs.doc(col(name)).id; },
    set(name, id, data) { return fs.setDoc(fs.doc(col(name), id), data, { merge: true }); },
    replace(name, id, data) { return fs.setDoc(fs.doc(col(name), id), data); },
    del(name, id) { return fs.deleteDoc(fs.doc(col(name), id)); },
    async get(name, id) {
      const s = await fs.getDoc(fs.doc(col(name), id));
      return s.exists() ? s.data() : null;
    },
    async getAll(name) {
      const s = await fs.getDocs(col(name));
      return s.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async bulkSet(name, records) {
      for (let i = 0; i < records.length; i += 400) {
        const b = fs.writeBatch(db);
        records.slice(i, i + 400).forEach(r => { const { id, ...data } = r; b.set(fs.doc(col(name), id), data); });
        await b.commit();
      }
    }
  };
}

// ───────────────────────── Modo demo (localStorage) ─────────────────────────
export function createLocalStore(hid, onStatus = () => {}) {
  const KEY = 'donde-esta-demo:' + hid;
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY)) || null; } catch { data = null; }
  data = data || { household: null, places: {}, items: {}, photos: {} };
  const listeners = { household: [], places: [], items: [], photos: [] };
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); onStatus('demo'); }
    catch (e) { onStatus('error', e); throw new Error('El almacenamiento del móvil está lleno (modo demo).'); }
  };
  const emit = name => {
    if (name === 'household') listeners.household.forEach(cb => cb(data.household || {}));
    else listeners[name].forEach(cb => cb(Object.entries(data[name]).map(([id, v]) => ({ id, ...v }))));
  };
  const later = fn => Promise.resolve().then(fn);
  return {
    kind: 'demo',
    async getHousehold() { return data.household; },
    async setHousehold(d) { data.household = { ...(data.household || {}), ...d }; save(); emit('household'); },
    async addMember(name) {
      const h = data.household || {}; const m = new Set(h.members || []); m.add(name);
      data.household = { ...h, members: [...m] }; save(); emit('household');
    },
    watchHousehold(cb) { listeners.household.push(cb); later(() => cb(data.household || {})); return () => {}; },
    watch(name, cb) { listeners[name].push(cb); later(() => emit(name)); onStatus('demo'); return () => {}; },
    newId() { return randomId(); },
    async set(name, id, d) { data[name][id] = { ...(data[name][id] || {}), ...d }; save(); emit(name); },
    async replace(name, id, d) { data[name][id] = d; save(); emit(name); },
    async del(name, id) { delete data[name][id]; save(); emit(name); },
    async get(name, id) { return data[name][id] || null; },
    async getAll(name) { return Object.entries(data[name]).map(([id, v]) => ({ id, ...v })); },
    async bulkSet(name, records) { records.forEach(r => { const { id, ...d } = r; data[name][id] = d; }); save(); emit(name); }
  };
}
