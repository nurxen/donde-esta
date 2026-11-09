import { DEFAULT_PLACES, DEFAULT_CATEGORIES } from './config.js';
import { isConfigured, householdIdFromCode, createFirebaseStore, createLocalStore } from './store.js';
import { openTutorial, tutorialSeen } from './tutorial.js';

const VERSION = '1.1.0';
const SESSION_KEY = 'donde-esta-session';
const RECENT_KEY = 'donde-esta-recent-places';

// ───────────────────────── Estado ─────────────────────────
const S = {
  store: null, session: null,
  places: {}, items: {}, household: {},
  loaded: { places: false, items: false },
  q: '', prefillName: '', form: null, picker: null,
  photoCache: {}, installEvt: null, listTab: 'prestado', listCat: ''
};

const $ = sel => document.querySelector(sel);
const view = $('#view');

// ───────────────────────── Utilidades ─────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const now = () => Date.now();
const me = () => S.session?.me || 'Alguien';

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.innerHTML = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function fail(err) {
  console.error(err);
  toast('⚠️ ' + esc(friendlyError(err)), 5000);
}
function friendlyError(err) {
  const code = err?.code || '';
  if (code.includes('permission-denied')) return 'Sin permiso en Firebase. ¿Has publicado las reglas de Firestore (firestore.rules)?';
  if (code.includes('operation-not-allowed') || code.includes('admin-restricted')) return 'Activa el acceso "Anónimo" en Firebase → Authentication → Método de acceso.';
  if (code.includes('unavailable') || code.includes('network')) return 'Sin conexión. Inténtalo cuando tengas internet.';
  if (code.includes('api-key') || code.includes('invalid-api-key')) return 'La configuración de Firebase (js/config.js) no es correcta.';
  if (code.includes('resource-exhausted')) return 'Se ha superado el límite gratuito de Firebase por hoy.';
  return err?.message || String(err);
}

function timeAgo(ts) {
  if (!ts) return '';
  const d = (now() - ts) / 1000;
  if (d < 60) return 'hace un momento';
  if (d < 3600) return `hace ${Math.round(d / 60)} min`;
  if (d < 86400) return `hace ${Math.round(d / 3600)} h`;
  if (d < 172800) return 'ayer';
  if (d < 30 * 86400) return `hace ${Math.round(d / 86400)} días`;
  return fmtDate(ts);
}
const fmtDate = ts => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDay = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
function daysUntil(iso) {
  if (!iso) return null;
  const t = new Date(iso + 'T12:00:00'); const today = new Date(); today.setHours(12, 0, 0, 0);
  return Math.round((t - today) / 86400000);
}
function expiryText(iso) {
  const d = daysUntil(iso);
  if (d === null) return '';
  if (d < 0) return `caducó hace ${-d} día${d === -1 ? '' : 's'}`;
  if (d === 0) return 'caduca hoy';
  if (d < 60) return `caduca en ${d} día${d === 1 ? '' : 's'}`;
  if (d < 365) return `caduca en ${Math.round(d / 30)} meses`;
  return `caduca el ${fmtDay(iso)}`;
}

function getRecentPlaces() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } }
function pushRecentPlace(id) {
  const r = [id, ...getRecentPlaces().filter(x => x !== id)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(r));
}

// ───────────────────────── Lugares ─────────────────────────
const TYPE_LABEL = { floor: 'planta', room: 'habitación', furniture: 'mueble', spot: 'hueco' };
const CHILD_TYPE = { root: 'floor', floor: 'room', room: 'furniture', furniture: 'spot', spot: 'spot' };
const ADD_LABEL = {
  floor: 'Nueva planta', room: 'Nueva habitación o zona', furniture: 'Nuevo mueble',
  spot: 'Nuevo cajón, estante o caja'
};
const TYPE_ICON = { floor: '🏢', room: '🚪', furniture: '🗄️', spot: '📥' };
const placeIcon = p => p?.icon || TYPE_ICON[p?.type] || '📍';

function childrenOf(parentId) {
  return Object.values(S.places)
    .filter(p => (p.parentId || null) === (parentId || null))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'es'));
}
function pathOf(id) {
  const out = []; const seen = new Set();
  let p = S.places[id];
  while (p && !seen.has(p.id)) { out.unshift(p); seen.add(p.id); p = S.places[p.parentId]; }
  return out;
}
function pathText(id, { withFloor = false } = {}) {
  let path = pathOf(id);
  if (!withFloor && path.length > 1 && path[0].type === 'floor') path = path.slice(1);
  return path.map(p => p.name).join(' › ') || 'Sin sitio';
}
function descendantIds(id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) childrenOf(out[i]).forEach(c => out.push(c.id));
  return out;
}
const activeItems = () => Object.values(S.items).filter(i => i.status !== 'tirado');
function itemsIn(id, deep = false) {
  const ids = new Set(deep ? descendantIds(id) : [id]);
  return activeItems().filter(i => ids.has(i.placeId)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
function placeSummary(id) {
  const subs = childrenOf(id).length; const n = itemsIn(id, true).length;
  const parts = [];
  if (subs) parts.push(`${subs} sitio${subs === 1 ? '' : 's'}`);
  parts.push(n ? `${n} cosa${n === 1 ? '' : 's'}` : 'vacío');
  return parts.join(' · ');
}
function crumbsHtml(id, { links = true, withFloor = true } = {}) {
  let path = pathOf(id);
  if (!withFloor && path.length > 1 && path[0].type === 'floor') path = path.slice(1);
  if (!path.length) return '<span class="muted">Sin sitio</span>';
  return path.map(p => links
    ? `<a href="#/lugar/${p.id}">${esc(p.name)}</a>`
    : `<span>${esc(p.name)}</span>`).join('<span class="sep">›</span>');
}

// ───────────────────────── Búsqueda ─────────────────────────
const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'mi', 'mis', 'tu', 'tus', 'su', 'sus',
  'nuestro', 'nuestra', 'nuestros', 'nuestras', 'y', 'a', 'al', 'en', 'con', 'para', 'por', 'que', 'donde', 'esta', 'estan']);
function queryTokens(q) {
  let s = norm(q).replace(/[¿?¡!.,;:"]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(donde|que)\s+(esta|estan|he|hemos|has|habeis|guarde|guardaste|guardamos|puse|pusimos|tengo|tenemos|deje|dejamos)\s+((guardad|puest|dejad)[oa]s?\s+)?/, '');
  return s.split(' ').filter(t => t && !STOP.has(t));
}
function tokenIn(hay, t) {
  if (hay.includes(t)) return true;
  if (t.length > 3 && t.endsWith('es') && hay.includes(t.slice(0, -2))) return true;
  if (t.length > 3 && t.endsWith('s') && hay.includes(t.slice(0, -1))) return true;
  return false;
}
function search(q) {
  const tokens = queryTokens(q);
  if (!tokens.length) return { items: [], places: [] };
  const items = [];
  for (const it of Object.values(S.items)) {
    const name = norm(it.name);
    const hay = [name, norm(it.category), norm(it.notes), norm(it.lentTo), norm(pathText(it.placeId, { withFloor: true }))].join(' | ');
    if (!tokens.every(t => tokenIn(hay, t))) continue;
    let score = 0;
    tokens.forEach(t => { if (tokenIn(name, t)) score += 5; if (name.startsWith(t)) score += 3; });
    if (it.status === 'tirado') score -= 20;
    items.push({ it, score });
  }
  items.sort((a, b) => b.score - a.score || (b.it.updatedAt || 0) - (a.it.updatedAt || 0));
  const places = Object.values(S.places).filter(p => tokens.every(t => tokenIn(norm(p.name), t)));
  return { items: items.map(x => x.it), places };
}

// ───────────────────────── Fotos ─────────────────────────
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la foto')); i.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function toJpeg(img, max, quality, square = false) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (square) {
    const side = Math.min(w, h);
    c.width = c.height = max;
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, max, max);
  } else {
    const k = Math.min(1, max / Math.max(w, h));
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    ctx.drawImage(img, 0, 0, c.width, c.height);
  }
  let q = quality, out = c.toDataURL('image/jpeg', q);
  while (out.length > 700000 && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
  return out;
}
async function processPhoto(file) {
  const img = await loadImage(file);
  return { full: toJpeg(img, 1280, 0.72), thumb: toJpeg(img, 160, 0.6, true) };
}
async function getPhoto(id) {
  if (!id) return null;
  if (S.photoCache[id]) return S.photoCache[id];
  try { const p = await S.store.get('photos', id); if (p?.data) S.photoCache[id] = p.data; return p?.data || null; }
  catch (e) { console.warn(e); return null; }
}

// ───────────────────────── Escritura ─────────────────────────
function write(promise) { Promise.resolve(promise).catch(fail); }
function historyEntry(text) { return { at: now(), by: me(), text }; }
function withHistory(item, text) { return [historyEntry(text), ...(item?.history || [])].slice(0, 40); }
function updateItem(id, data, histText) {
  const it = S.items[id];
  const patch = { ...data, updatedAt: now(), updatedBy: me() };
  if (histText) patch.history = withHistory(it, histText);
  S.items[id] = { ...it, ...patch }; // optimista
  write(S.store.set('items', id, patch));
}
function addPlace(parentId, name, type) {
  const id = S.store.newId('places');
  const siblings = childrenOf(parentId);
  const data = { name: name.trim(), type, parentId: parentId || null, order: siblings.length, createdAt: now(), createdBy: me() };
  S.places[id] = { id, ...data };
  write(S.store.set('places', id, data));
  return id;
}

// ───────────────────────── Router ─────────────────────────
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(qs || '') };
}
const ROOT_TABS = { '': 'home', lugares: 'lugares', nuevo: 'nuevo', listas: 'listas', ajustes: 'ajustes' };

function setTitle(t) { $('#title').textContent = t; }

// Pila de navegación propia: «‹» vuelve a la pantalla anterior de la app, o a la pantalla «padre» si no hay.
const navStack = [];
let replacing = false;
function go(hash, replace = false) {
  if (location.hash === hash) return route();
  if (replace) { replacing = true; location.replace(hash); } else location.hash = hash;
}
function onHashChange() {
  const h = location.hash || '#/';
  if (replacing) { replacing = false; navStack[Math.max(0, navStack.length - 1)] = h; }
  else if (navStack.length > 1 && navStack[navStack.length - 2] === h) navStack.pop();
  else navStack.push(h);
  route();
}
function logicalParent() {
  const { parts } = parseHash();
  if (parts[0] === 'lugar') { const p = S.places[parts[1]]; return p?.parentId ? '#/lugar/' + p.parentId : '#/lugares'; }
  if (parts[0] === 'editar') return '#/cosa/' + parts[1];
  return '#/';
}
function goBack() {
  if (navStack.length > 1) history.back(); else go(logicalParent(), true);
}

function route() {
  if (!S.session) return renderLogin();
  if (!S.loaded.places || !S.loaded.items) { view.innerHTML = '<div class="loading">Cargando la casa…</div>'; return; }
  closeSheet();
  const { parts, params } = parseHash();
  const root = parts[0] || '';
  const tab = ROOT_TABS[root] && parts.length <= 1 ? ROOT_TABS[root] : null;
  $('#tabbar').hidden = false;
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === (tab || (root === 'lugar' ? 'lugares' : ''))));
  $('#backBtn').hidden = !!tab && root !== 'nuevo';
  if (root === 'nuevo') $('#backBtn').hidden = false;
  $('#helpBtn').hidden = root !== '';
  S.current = { root, parts, params };
  window.scrollTo(0, 0);
  switch (root) {
    case '': return renderHome();
    case 'lugares': return renderPlaces();
    case 'lugar': return renderPlace(parts[1]);
    case 'cosa': return renderItem(parts[1]);
    case 'nuevo': return renderForm(null, params);
    case 'editar': return renderForm(parts[1], params);
    case 'listas': return renderLists();
    case 'ajustes': return renderSettings();
    default: location.hash = '#/';
  }
}
// Re-pinta cuando llegan cambios de otros miembros (sin romper formularios abiertos)
function refresh() {
  if (!S.session || !S.loaded.places || !S.loaded.items) return route();
  if (S.picker) renderPickerBody();
  const r = S.current?.root;
  if (r === 'nuevo' || r === 'editar') { updatePlaceButton(); return; }
  if (r === '' && $('#results')) return renderResults();
  if (r === 'ajustes') return;
  const y = window.scrollY; route(); window.scrollTo(0, y);
}

// ───────────────────────── Vistas: login ─────────────────────────
function renderLogin() {
  $('#tabbar').hidden = true; $('#backBtn').hidden = true; $('#helpBtn').hidden = true; setTitle('¿Dónde está?');
  const cfg = isConfigured();
  view.innerHTML = `
  <div class="login">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h2>¿Dónde está?</h2>
    <p class="muted">Todo lo que guardáis en casa, siempre localizado. Compartido por toda la familia.</p>
    ${cfg ? '' : `<div class="card warn"><b>Falta conectar Firebase.</b> Sigue la guía del README para compartir los datos con la familia. Mientras tanto puedes <b>probarla en modo demo</b> (los datos se quedan solo en este móvil).</div>`}
    <form id="loginForm" class="stack">
      <label>Código familiar
        <input name="code" type="password" autocomplete="off" minlength="6" required placeholder="El mismo para los 4">
        <small class="muted">Inventad uno largo (mín. 6 caracteres) y usadlo todos. Quien tenga el código puede ver la casa.</small>
      </label>
      <label>¿Quién eres?
        <input name="me" required maxlength="30" placeholder="Tu nombre" autocomplete="given-name">
      </label>
      ${cfg ? '<button class="btn primary big" type="submit">Entrar</button>'
            : '<button class="btn primary big" type="submit" name="demo" value="1">Probar en modo demo</button>'}
    </form>
  </div>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const code = String(f.get('code')).trim(), name = String(f.get('me')).trim();
    if (code.length < 6) return toast('El código debe tener al menos 6 caracteres');
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const hid = await householdIdFromCode(code);
      const mode = cfg ? 'firebase' : 'demo';
      const store = await makeStore(mode, hid);
      let hh = await store.getHousehold();
      if (!hh) {
        const ok = confirm('No existe ninguna casa con este código.\n\n¿Crear una casa nueva? Hazlo solo la primera vez: el resto de la familia debe entrar con exactamente el mismo código.');
        if (!ok) { btn.disabled = false; btn.textContent = cfg ? 'Entrar' : 'Probar en modo demo'; return; }
        await store.setHousehold({ name: 'Nuestra casa', createdAt: now(), createdBy: name, members: [name] });
        await seedPlaces(store);
      }
      await store.addMember(name);
      S.session = { hid, me: name, mode, code };
      localStorage.setItem(SESSION_KEY, JSON.stringify(S.session));
      S.store = store; startSync(); go('#/', true);
      if (!tutorialSeen()) openTutorial();
      toast(`¡Hola, ${esc(name)}!`);
    } catch (err) {
      fail(err); btn.disabled = false; btn.textContent = cfg ? 'Entrar' : 'Probar en modo demo';
    }
  });
}

async function seedPlaces(store) {
  const recs = [];
  const add = (node, parentId, type, order) => {
    const id = store.newId('places');
    recs.push({ id, name: node.name, type, icon: node.icon || null, parentId: parentId || null, order, createdAt: now(), createdBy: 'inicio' });
    (node.children || []).forEach((c, i) => add(c, id, CHILD_TYPE[type], i));
  };
  DEFAULT_PLACES.forEach((f, i) => add(f, null, 'floor', i));
  await store.bulkSet('places', recs);
}

async function makeStore(mode, hid) {
  const onStatus = st => { const d = $('#syncDot'); d.className = 'sync-dot ' + st; d.title = { ok: 'Sincronizado', pending: 'Guardando…', offline: 'Sin conexión (se guardará al volver)', error: 'Error de sincronización', demo: 'Modo demo: solo en este móvil' }[st] || ''; };
  return mode === 'firebase' ? createFirebaseStore(hid, onStatus) : createLocalStore(hid, onStatus);
}

function startSync() {
  S.loaded = { places: false, items: false };
  S.store.watchHousehold(h => { S.household = h; });
  S.store.watch('places', list => { S.places = Object.fromEntries(list.map(p => [p.id, p])); S.loaded.places = true; refresh(); });
  S.store.watch('items', list => { S.items = Object.fromEntries(list.map(i => [i.id, i])); S.loaded.items = true; refresh(); });
}

// ───────────────────────── Vistas: inicio / búsqueda ─────────────────────────
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

function renderHome() {
  setTitle(S.household?.name || '¿Dónde está?');
  view.innerHTML = `
    <div class="searchbox">
      <span class="search-ico">🔎</span>
      <input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="¿Qué estás buscando?" value="${esc(S.q)}">
      ${SpeechRec ? '<button class="mic" data-act="mic" aria-label="Buscar por voz">🎤</button>' : ''}
    </div>
    <div id="results"></div>`;
  const q = $('#q');
  q.addEventListener('input', () => { S.q = q.value; renderResults(); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') q.blur(); });
  renderResults();
}

function itemRow(it, { showPath = true, extra = '' } = {}) {
  const exp = it.expires && daysUntil(it.expires) < 60 && it.status !== 'tirado';
  return `<a class="row item-row ${it.status === 'tirado' ? 'dim' : ''}" href="#/cosa/${it.id}">
    ${it.thumb ? `<img class="thumb" src="${it.thumb}" alt="">` : `<span class="thumb ph">${catEmoji(it.category)}</span>`}
    <span class="row-main">
      <span class="row-title">${esc(it.name)}</span>
      ${showPath ? `<span class="row-sub">📍 ${esc(pathText(it.placeId))}</span>` : ''}${extra}
    </span>
    ${it.status === 'prestado' ? '<span class="badge amber">prestado</span>' : ''}
    ${it.status === 'tirado' ? '<span class="badge grey">tirado</span>' : ''}
    ${exp ? '<span class="badge red">⏰</span>' : ''}
  </a>`;
}
function placeRow(p, { href } = {}) {
  return `<a class="row" href="${href || '#/lugar/' + p.id}">
    <span class="thumb ph">${placeIcon(p)}</span>
    <span class="row-main"><span class="row-title">${esc(p.name)}</span>
    <span class="row-sub">${esc(p.parentId ? pathText(p.parentId, { withFloor: true }) + ' · ' : '')}${esc(placeSummary(p.id))}</span></span>
    <span class="chev">›</span></a>`;
}
function catEmoji(c) {
  const n = norm(c);
  const map = [['document', '🪪'], ['electr', '🔌'], ['cable', '🔌'], ['cargador', '🔌'], ['herramient', '🔧'], ['navidad', '🎄'], ['fiesta', '🎉'],
    ['ropa', '👕'], ['deporte', '⚽'], ['camping', '⛺'], ['viaje', '🧳'], ['medic', '💊'], ['papel', '📄'], ['garant', '📄'], ['recuerdo', '📸'],
    ['juguete', '🧸'], ['cocina', '🍽️'], ['jardin', '🌱'], ['llave', '🔑']];
  for (const [k, e] of map) if (n.includes(k)) return e;
  return '📦';
}

function renderResults() {
  const box = $('#results'); if (!box) return;
  const q = S.q.trim();
  if (!q) { box.innerHTML = dashboardHtml(); return; }
  const { items, places } = search(q);
  let html = '';
  if (items.length) {
    const top = items[0];
    if (top.status === 'tirado') {
      html += `<a class="card warn" href="#/cosa/${top.id}"><b>🗑️ ${esc(top.name)}</b><br>Lo marcasteis como tirado o donado ${esc(timeAgo(top.discardedAt))}. Ya no está en casa.</a>`;
    } else {
      html += `<a class="card answer" href="#/cosa/${top.id}">
        <div class="answer-q">${esc(top.name)}</div>
        <div class="answer-where">${top.status === 'prestado' ? `🤝 Prestado a <b>${esc(top.lentTo || '¿?')}</b><br><small>Su sitio:</small> ` : '📍 '}${crumbsHtml(top.placeId, { links: false, withFloor: false })}</div>
      </a>`;
    }
    html += `<h3 class="section">Cosas (${items.length})</h3><div class="list">${items.slice(0, 50).map(it => itemRow(it)).join('')}</div>`;
  }
  if (places.length) html += `<h3 class="section">Sitios</h3><div class="list">${places.slice(0, 20).map(p => placeRow(p)).join('')}</div>`;
  if (!items.length && !places.length) {
    html = `<div class="empty">
      <div class="empty-ico">🤷</div>
      <p>No encuentro <b>«${esc(q)}»</b>.</p>
      <p class="muted">Quizá está apuntado con otro nombre. Prueba con una palabra más corta.</p>
      <button class="btn primary" data-act="saveFromSearch">＋ Guardar «${esc(q)}» ahora</button>
    </div>`;
  }
  box.innerHTML = html;
}

function dashboardHtml() {
  const all = Object.values(S.items);
  const act = activeItems();
  let html = '';
  if (!all.length) {
    html += `<div class="card welcome">
      <h3>👋 ¡Empezamos!</h3>
      <p>Cada vez que guardéis algo importante, apuntadlo con el botón <b>＋</b>: pasaportes, tarjeta sanitaria, garantías, cosas del trastero…</p>
      <div class="actions"><a class="btn primary" href="#/nuevo">＋ Guardar la primera cosa</a><button class="btn" data-act="tutorial">📖 Cómo funciona</button></div>
    </div>`;
  }
  const expiring = act.filter(i => i.expires && daysUntil(i.expires) <= 60).sort((a, b) => a.expires.localeCompare(b.expires));
  if (expiring.length) {
    html += `<a class="card alert" href="#/listas?tab=caduca"><b>⏰ ${expiring.length === 1 ? 'Revisa esto' : `Revisa ${expiring.length} cosas`}</b>
      ${expiring.slice(0, 3).map(i => `<div>${esc(i.name)} — <span class="${daysUntil(i.expires) < 0 ? 'red-t' : ''}">${esc(expiryText(i.expires))}</span></div>`).join('')}</a>`;
  }
  const lent = act.filter(i => i.status === 'prestado');
  if (lent.length) {
    html += `<a class="card lent" href="#/listas?tab=prestado"><b>🤝 ${lent.length} prestad${lent.length === 1 ? 'a' : 'as'}</b>
      ${lent.slice(0, 3).map(i => `<div>${esc(i.name)} → ${esc(i.lentTo || '¿?')}</div>`).join('')}</a>`;
  }
  const recent = [...act].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);
  if (recent.length) {
    html += `<h3 class="section">Últimos movimientos</h3><div class="list">${recent.map(it => itemRow(it)).join('')}</div>`;
  }
  html += `<h3 class="section">Explorar la casa</h3><div class="grid">${childrenOf(null).map(f =>
    `<a class="tile" href="#/lugar/${f.id}"><span class="tile-ico">${placeIcon(f)}</span><span>${esc(f.name)}</span><small>${itemsIn(f.id, true).length} cosas</small></a>`).join('')}</div>`;
  return html;
}

// ───────────────────────── Vistas: lugares ─────────────────────────
function renderPlaces() {
  setTitle('Lugares');
  const floors = childrenOf(null);
  view.innerHTML = floors.map(f => `
    <section class="floor">
      <a class="floor-head" href="#/lugar/${f.id}"><span>${placeIcon(f)} ${esc(f.name)}</span><small>${itemsIn(f.id, true).length} cosas ›</small></a>
      <div class="grid">${childrenOf(f.id).map(r => `
        <a class="tile" href="#/lugar/${r.id}"><span class="tile-ico">${placeIcon(r)}</span><span>${esc(r.name)}</span><small>${esc(placeSummary(r.id))}</small></a>`).join('')}
        <button class="tile add" data-act="addChild" data-id="${f.id}"><span class="tile-ico">＋</span><span>Añadir</span></button>
      </div>
    </section>`).join('') + `<button class="btn ghost wide" data-act="addChild" data-id="">＋ Añadir planta</button>`;
}

function renderPlace(id) {
  const p = S.places[id];
  if (!p) { view.innerHTML = '<div class="empty"><p>Este sitio ya no existe.</p><a class="btn" href="#/lugares">Ver lugares</a></div>'; return; }
  setTitle(p.name);
  const kids = childrenOf(id);
  const here = itemsIn(id);
  const deep = itemsIn(id, true).filter(i => i.placeId !== id);
  const ct = CHILD_TYPE[p.type] || 'spot';
  view.innerHTML = `
    <div class="crumbs">${crumbsHtml(id)}</div>
    <div class="place-head">
      <span class="place-ico">${placeIcon(p)}</span>
      <div><h2>${esc(p.name)}</h2><span class="muted">${esc(TYPE_LABEL[p.type] || 'sitio')} · ${esc(placeSummary(id))}</span></div>
    </div>
    <div class="actions">
      <a class="btn primary" href="#/nuevo?lugar=${id}">＋ Guardar algo aquí</a>
      <button class="btn" data-act="addChild" data-id="${id}">＋ ${esc(ADD_LABEL[ct])}</button>
    </div>
    ${kids.length ? `<h3 class="section">Dentro hay</h3><div class="list">${kids.map(k => placeRow(k)).join('')}</div>` : ''}
    ${here.length ? `<h3 class="section">Guardado aquí (${here.length})</h3><div class="list">${here.map(it => itemRow(it, { showPath: false })).join('')}</div>` : ''}
    ${deep.length ? `<details class="section-d"><summary>Todo lo que hay dentro (${deep.length})</summary><div class="list">${deep.map(it => itemRow(it)).join('')}</div></details>` : ''}
    ${!kids.length && !here.length ? `<div class="empty small"><p class="muted">Aquí aún no hay nada apuntado.</p></div>` : ''}
    <div class="more-actions">
      <button class="btn ghost" data-act="renamePlace" data-id="${id}">✏️ Renombrar</button>
      <button class="btn ghost" data-act="iconPlace" data-id="${id}">😀 Icono</button>
      <button class="btn ghost" data-act="movePlace" data-id="${id}">↪️ Mover</button>
      <button class="btn ghost" data-act="qrPlace" data-id="${id}">🏷️ Etiqueta QR</button>
      <button class="btn ghost danger" data-act="deletePlace" data-id="${id}">🗑️ Borrar</button>
    </div>`;
}

// ───────────────────────── Vistas: cosa ─────────────────────────
function renderItem(id) {
  const it = S.items[id];
  if (!it) { view.innerHTML = '<div class="empty"><p>Esta cosa ya no existe.</p><a class="btn" href="#/">Volver</a></div>'; return; }
  setTitle(it.name);
  const d = daysUntil(it.expires);
  view.innerHTML = `
    ${it.thumb ? `<div class="hero"><img id="heroImg" src="${it.thumb}" alt="" data-act="zoom"></div>` : ''}
    <h2 class="item-name">${esc(it.name)}</h2>
    <div class="chips">
      ${it.category ? `<span class="chip">${catEmoji(it.category)} ${esc(it.category)}</span>` : ''}
      ${it.status === 'prestado' ? '<span class="badge amber">prestado</span>' : ''}
      ${it.status === 'tirado' ? '<span class="badge grey">tirado / donado</span>' : ''}
    </div>
    ${it.status === 'tirado' ? `<div class="card warn">Lo marcó como tirado o donado ${esc(it.discardedBy || '')} ${esc(timeAgo(it.discardedAt))}. Ya no está en casa.</div>` : ''}
    ${it.status === 'prestado' ? `<div class="card lent">🤝 Prestado a <b>${esc(it.lentTo || '¿?')}</b> ${esc(timeAgo(it.lentAt))}</div>` : ''}
    <div class="card where">
      <div class="where-label">${it.status === 'tirado' ? 'Estaba en' : 'Está en'}</div>
      <div class="crumbs big">${crumbsHtml(it.placeId)}</div>
    </div>
    ${it.expires ? `<div class="card ${d < 60 ? 'alert' : ''}">⏰ ${esc(expiryText(it.expires))} <span class="muted">(${esc(fmtDay(it.expires))})</span></div>` : ''}
    ${it.notes ? `<div class="card notes">${esc(it.notes).replace(/\n/g, '<br>')}</div>` : ''}
    <div class="actions grid2">
      ${it.status !== 'tirado' ? `<button class="btn primary" data-act="moveItem" data-id="${id}">📦 Lo he cambiado de sitio</button>` : ''}
      <a class="btn" href="#/editar/${id}">✏️ Editar</a>
      ${it.status === 'prestado' ? `<button class="btn" data-act="returnItem" data-id="${id}">✅ Ya está devuelto</button>`
        : it.status !== 'tirado' ? `<button class="btn" data-act="lendItem" data-id="${id}">🤝 Lo he prestado</button>` : ''}
      ${it.status === 'tirado' ? `<button class="btn primary" data-act="restoreItem" data-id="${id}">♻️ Sigue en casa</button>`
        : `<button class="btn" data-act="discardItem" data-id="${id}">🗑️ Lo hemos tirado</button>`}
    </div>
    ${it.status !== 'tirado' && it.placeId ? `<a class="btn ghost wide" href="#/nuevo?lugar=${it.placeId}">＋ Guardar otra cosa en el mismo sitio</a>` : ''}
    <p class="meta">Apuntado por <b>${esc(it.createdBy || '¿?')}</b> ${esc(timeAgo(it.createdAt))}${it.updatedBy && (it.updatedAt || 0) - (it.createdAt || 0) > 5000 ? ` · Último cambio: ${esc(it.updatedBy)} ${esc(timeAgo(it.updatedAt))}` : ''}</p>
    ${(it.history || []).length ? `<details class="section-d"><summary>Historial (${it.history.length})</summary><ul class="history">${it.history.map(h =>
      `<li><span>${esc(h.text)}</span><small>${esc(h.by)} · ${esc(timeAgo(h.at))}</small></li>`).join('')}</ul></details>` : ''}
    <button class="btn ghost danger wide" data-act="deleteItem" data-id="${id}">Borrar de la app</button>`;
  if (it.photoId) getPhoto(it.photoId).then(src => { const img = $('#heroImg'); if (src && img) img.src = src; });
}

// ───────────────────────── Vistas: formulario ─────────────────────────
function renderForm(id, params) {
  const it = id ? S.items[id] : null;
  if (id && !it) { location.hash = '#/'; return; }
  setTitle(it ? 'Editar' : 'Guardar algo');
  if (!S.form || S.form.id !== (id || null) || S.form._hash !== location.hash) {
    S.form = it ? { id, name: it.name, placeId: it.placeId, category: it.category || '', notes: it.notes || '', expires: it.expires || '',
      thumb: it.thumb || null, photoId: it.photoId || null, newFull: null, removePhoto: false }
      : { id: null, name: S.prefillName || '', placeId: params.get('lugar') || '', category: '', notes: '', expires: '', thumb: null, photoId: null, newFull: null, removePhoto: false };
    S.form._hash = location.hash;
    S.prefillName = '';
  }
  const f = S.form;
  const cats = [...new Set([...DEFAULT_CATEGORIES, ...Object.values(S.items).map(i => i.category).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'es'));
  view.innerHTML = `
  <form id="itemForm" class="stack" autocomplete="off">
    <div class="photo-pick">
      <div id="photoPreview" class="photo-prev" data-act="pickPhoto">${f.thumb ? `<img src="${f.thumb}" alt="">` : '<span>📷</span>'}</div>
      <div class="photo-btns">
        <button type="button" class="btn" data-act="pickPhoto">${f.thumb ? 'Cambiar foto' : 'Hacer o elegir foto'}</button>
        ${f.thumb ? '<button type="button" class="btn ghost" data-act="removePhoto">Quitar foto</button>' : '<small class="muted">Opcional. Ayuda mucho en el trastero.</small>'}
      </div>
      <input type="file" id="photoInput" accept="image/*" hidden>
    </div>
    <label>¿Qué es?
      <input name="name" required maxlength="80" value="${esc(f.name)}" placeholder="Ej. Pasaportes, carnet de conducir…" enterkeyhint="next">
    </label>
    <div id="dupHint"></div>
    <div class="label">¿Dónde lo guardas?</div>
    <button type="button" id="placeBtn" class="place-btn" data-act="pickPlace"></button>
    <label>Categoría <small class="muted">(opcional)</small>
      <input name="category" list="catList" maxlength="40" value="${esc(f.category)}" placeholder="Documentos, Navidad, Herramientas…">
      <datalist id="catList">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    </label>
    <details ${f.notes || f.expires ? 'open' : ''}>
      <summary>Más detalles</summary>
      <div class="stack">
        <label>Notas
          <textarea name="notes" rows="3" maxlength="1000" placeholder="Ej. dentro del sobre marrón, al fondo a la izquierda">${esc(f.notes)}</textarea>
        </label>
        <label>Caduca o hay que revisarlo el…
          <input type="date" name="expires" value="${esc(f.expires)}">
          <small class="muted">Útil para pasaportes, DNI, garantías, extintores… Te avisará en la pantalla de inicio.</small>
        </label>
      </div>
    </details>
    <button class="btn primary big" type="submit">${it ? 'Guardar cambios' : 'Guardar'}</button>
  </form>`;
  updatePlaceButton();
  const form = $('#itemForm');
  form.addEventListener('input', e => {
    const { name, value } = e.target; if (name && name in f) f[name] = value;
    if (name === 'name') dupCheck();
  });
  $('#photoInput').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    $('#photoPreview').innerHTML = '<span class="spin">⏳</span>';
    try { const { full, thumb } = await processPhoto(file); f.newFull = full; f.thumb = thumb; f.removePhoto = false; }
    catch (err) { fail(err); }
    renderForm(f.id, parseHash().params);
  });
  form.addEventListener('submit', e => { e.preventDefault(); saveForm(); });
  dupCheck();
}

function updatePlaceButton() {
  const b = $('#placeBtn'); if (!b || !S.form) return;
  const id = S.form.placeId;
  b.innerHTML = id && S.places[id]
    ? `<span class="pb-ico">${placeIcon(S.places[id])}</span><span class="pb-main"><span class="crumbs">${crumbsHtml(id, { links: false })}</span><small>Toca para cambiar</small></span>`
    : `<span class="pb-ico">📍</span><span class="pb-main"><b>Elegir sitio…</b><small>Planta → habitación → mueble → cajón</small></span>`;
  b.classList.toggle('missing', !(id && S.places[id]));
}

function dupCheck() {
  const box = $('#dupHint'); if (!box || !S.form) return;
  const n = norm(S.form.name).trim();
  if (n.length < 3) { box.innerHTML = ''; return; }
  const dup = Object.values(S.items).find(i => i.id !== S.form.id && i.status !== 'tirado' && norm(i.name) === n);
  box.innerHTML = dup ? `<div class="card warn small">Ya tenéis <b>${esc(dup.name)}</b> en ${esc(pathText(dup.placeId))}. <a href="#/cosa/${dup.id}">Ver o moverlo</a></div>` : '';
}

function saveForm() {
  const f = S.form;
  const name = f.name.trim();
  if (!name) return toast('Escribe qué es');
  if (!f.placeId || !S.places[f.placeId]) { toast('Elige dónde lo guardas'); return openPicker({ start: null, onPick: pid => { f.placeId = pid; updatePlaceButton(); } }); }
  const isNew = !f.id;
  const ts = now();
  const id = f.id || S.store.newId('items');
  const old = S.items[id];
  let photoId = f.photoId;
  if (f.removePhoto && photoId) { write(S.store.del('photos', photoId)); photoId = null; }
  if (f.newFull) {
    if (photoId) write(S.store.del('photos', photoId));
    photoId = S.store.newId('photos');
    S.photoCache[photoId] = f.newFull;
    write(S.store.replace('photos', photoId, { data: f.newFull, itemId: id, at: now() }));
  }
  const data = {
    name, placeId: f.placeId, category: f.category.trim(), notes: f.notes.trim(), expires: f.expires || '',
    thumb: f.removePhoto ? null : (f.thumb || null), photoId: photoId || null, updatedAt: ts, updatedBy: me()
  };
  if (isNew) {
    Object.assign(data, { status: 'guardado', createdAt: ts, createdBy: me(), history: [historyEntry('Guardado en ' + pathText(f.placeId))] });
  } else if (old.placeId !== f.placeId) {
    data.history = withHistory(old, `Movido de ${pathText(old.placeId)} a ${pathText(f.placeId)}`);
  }
  S.items[id] = { ...(old || {}), id, ...data };
  write(S.store.set('items', id, data));
  pushRecentPlace(f.placeId);
  S.form = null;
  toast(`✅ Guardado en <b>${esc(pathText(f.placeId))}</b>`);
  go('#/cosa/' + id, true);
}

// ───────────────────────── Selector de sitio (hoja) ─────────────────────────
function openPicker({ start, onPick, title = '¿Dónde lo guardas?', exclude = null, allowRoot = false }) {
  S.picker = { cur: start && S.places[start] ? start : null, filter: '', adding: false, onPick, title, exclude, allowRoot };
  const sh = $('#sheet');
  sh.innerHTML = `<div class="sheet-bg" data-act="pickerClose"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="icon-btn" data-act="pickerClose" aria-label="Cerrar">✕</button><h3>${esc(title)}</h3></div>
      <div class="sheet-search"><input id="pickerFilter" type="search" placeholder="Buscar un sitio…" autocomplete="off"></div>
      <div id="pickerCrumbs" class="crumbs picker-crumbs"></div>
      <div id="pickerBody" class="sheet-body"></div>
      <div id="pickerFoot" class="sheet-foot"></div>
    </div>`;
  sh.hidden = false; document.body.classList.add('noscroll');
  $('#pickerFilter').addEventListener('input', e => { S.picker.filter = e.target.value; renderPickerBody(); });
  renderPickerBody();
}
function closeSheet() { const sh = $('#sheet'); if (!sh.hidden) { sh.hidden = true; sh.innerHTML = ''; } S.picker = null; document.body.classList.remove('noscroll'); }

function renderPickerBody() {
  const P = S.picker; if (!P) return;
  if (P.cur && !S.places[P.cur]) P.cur = null;
  const excluded = P.exclude ? new Set(descendantIds(P.exclude)) : new Set();
  const cur = P.cur ? S.places[P.cur] : null;
  $('#pickerCrumbs').innerHTML = `<button data-act="pickerGo" data-id="">🏠 Casa</button>` +
    pathOf(P.cur).map(p => `<span class="sep">›</span><button data-act="pickerGo" data-id="${p.id}">${esc(p.name)}</button>`).join('');
  let html = '';
  const fq = P.filter.trim();
  if (fq) {
    const toks = queryTokens(fq);
    const found = Object.values(S.places).filter(p => !excluded.has(p.id) && toks.every(t => tokenIn(norm(p.name), t))).slice(0, 30);
    html += found.length ? `<div class="list">${found.map(p => `<button class="row" data-act="pickerGo" data-id="${p.id}" data-clear="1">
      <span class="thumb ph">${placeIcon(p)}</span><span class="row-main"><span class="row-title">${esc(p.name)}</span><span class="row-sub">${esc(p.parentId ? pathText(p.parentId, { withFloor: true }) : 'Planta')}</span></span><span class="chev">›</span></button>`).join('')}</div>`
      : `<p class="muted pad">No hay ningún sitio con ese nombre. Navega hasta donde esté y créalo con «＋».</p>`;
  } else {
    if (!cur) {
      const rec = getRecentPlaces().filter(id => S.places[id] && !excluded.has(id)).slice(0, 6);
      if (rec.length) html += `<h4>Usados hace poco</h4><div class="chip-wrap">${rec.map(id => `<button class="chip big" data-act="pickerChoose" data-id="${id}">${placeIcon(S.places[id])} ${esc(pathText(id))}</button>`).join('')}</div>`;
      html += `<h4>Elige planta</h4>`;
    } else html += `<h4>Dentro de ${esc(cur.name)}</h4>`;
    const kids = childrenOf(P.cur).filter(k => !excluded.has(k.id));
    if (cur && !kids.length) html += `<p class="muted small pad0">Aún no hay nada dentro. Puedes guardarlo aquí mismo o crear un sitio más concreto.</p>`;
    if (kids.length) html += `<div class="list">${kids.map(k => `<button class="row" data-act="pickerGo" data-id="${k.id}">
      <span class="thumb ph">${placeIcon(k)}</span><span class="row-main"><span class="row-title">${esc(k.name)}</span><span class="row-sub">${esc(placeSummary(k.id))}</span></span><span class="chev">›</span></button>`).join('')}</div>`;
    const ct = CHILD_TYPE[cur?.type || 'root'];
    html += P.adding
      ? `<form id="pickerAddForm" class="add-inline"><input id="pickerAddName" maxlength="50" placeholder="${esc(ADD_LABEL[ct])}…" enterkeyhint="done" required><button class="btn primary" type="submit">Añadir</button><button class="btn ghost" type="button" data-act="pickerAddCancel">✕</button></form>`
      : `<button class="row add-row" data-act="pickerAdd"><span class="thumb ph">＋</span><span class="row-main"><span class="row-title">${esc(ADD_LABEL[ct])}${cur ? ' en ' + esc(cur.name) : ''}</span></span></button>`;
  }
  $('#pickerBody').innerHTML = html;
  $('#pickerFoot').innerHTML = cur
    ? `<button class="btn primary big wide" data-act="pickerChoose" data-id="${cur.id}"><span>Aquí: </span><b>${esc(pathText(cur.id))}</b></button>`
    : P.allowRoot ? `<button class="btn primary big wide" data-act="pickerChoose" data-id="">Aquí: <b>Casa (nivel superior)</b></button>`
    : `<p class="muted center">Elige planta y habitación (y el mueble si quieres)</p>`;
  const addForm = $('#pickerAddForm');
  if (addForm) {
    const inp = $('#pickerAddName'); inp.focus();
    addForm.addEventListener('submit', e => {
      e.preventDefault();
      const name = inp.value.trim(); if (!name) return;
      const nid = addPlace(P.cur, name, CHILD_TYPE[cur?.type || 'root']);
      P.cur = nid; P.adding = false; renderPickerBody();
      toast(`Añadido «${esc(name)}»`);
    });
  }
}

// ───────────────────────── Listas ─────────────────────────
function renderLists() {
  setTitle('Listas');
  const tab = parseHash().params.get('tab') || S.listTab;
  S.listTab = tab;
  const act = activeItems();
  const lists = {
    prestado: { label: '🤝 Prestado', items: act.filter(i => i.status === 'prestado').sort((a, b) => (a.lentAt || 0) - (b.lentAt || 0)) },
    caduca: { label: '⏰ Caducidades', items: act.filter(i => i.expires).sort((a, b) => a.expires.localeCompare(b.expires)) },
    tirado: { label: '🗑️ Tirado', items: Object.values(S.items).filter(i => i.status === 'tirado').sort((a, b) => (b.discardedAt || 0) - (a.discardedAt || 0)) },
    todo: { label: '📦 Todo', items: act.sort((a, b) => a.name.localeCompare(b.name, 'es')) }
  };
  const L = lists[tab] || lists.prestado;
  let items = L.items;
  let extra = '';
  if (tab === 'todo') {
    const cats = [...new Set(act.map(i => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    if (cats.length) extra = `<div class="chip-wrap scroll"><button class="chip ${!S.listCat ? 'on' : ''}" data-act="listCat" data-cat="">Todas</button>${cats.map(c =>
      `<button class="chip ${S.listCat === c ? 'on' : ''}" data-act="listCat" data-cat="${esc(c)}">${catEmoji(c)} ${esc(c)}</button>`).join('')}</div>`;
    if (S.listCat) items = items.filter(i => i.category === S.listCat);
  }
  const rows = items.map(it => {
    if (tab === 'caduca') return itemRow(it, { extra: `<span class="row-sub ${daysUntil(it.expires) < 0 ? 'red-t' : ''}">⏰ ${esc(expiryText(it.expires))}</span>` });
    if (tab === 'prestado') return itemRow(it, { extra: `<span class="row-sub">🤝 ${esc(it.lentTo || '¿?')} · ${esc(timeAgo(it.lentAt))}</span>` });
    return itemRow(it);
  }).join('');
  view.innerHTML = `
    <div class="tabs">${Object.entries(lists).map(([k, v]) => `<a class="${k === tab ? 'on' : ''}" href="#/listas?tab=${k}">${v.label} <small>${v.items.length}</small></a>`).join('')}</div>
    ${extra}
    ${items.length ? `<div class="list">${rows}</div>` : `<div class="empty small"><p class="muted">${{
      prestado: 'No hay nada prestado.', caduca: 'Nada con fecha de caducidad. Añádela al guardar pasaportes, DNI, garantías…',
      tirado: 'Aquí aparecerá lo que marquéis como tirado o donado, para saber que ya no está.', todo: 'Aún no hay nada guardado.' }[tab]}</p></div>`}`;
}

// ───────────────────────── Ajustes ─────────────────────────
function renderSettings() {
  setTitle('Ajustes');
  const members = S.household?.members || [];
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  view.innerHTML = `
  <div class="stack">
    <button class="btn wide tut-open" data-act="tutorial">📖 Ver el tutorial de cómo funciona</button>
    <section class="card">
      <h3>👤 Tú</h3>
      <form id="meForm" class="row-form"><input name="me" value="${esc(me())}" maxlength="30" required><button class="btn">Cambiar</button></form>
      ${members.length ? `<p class="muted small">En esta casa: ${members.map(esc).join(', ')}</p>` : ''}
    </section>
    <section class="card">
      <h3>🏠 Casa</h3>
      <form id="houseForm" class="row-form"><input name="hname" value="${esc(S.household?.name || '')}" maxlength="40" placeholder="Nombre de la casa"><button class="btn">Guardar</button></form>
      <p class="muted small">${Object.keys(S.places).length} sitios · ${activeItems().length} cosas guardadas</p>
    </section>
    <section class="card">
      <h3>👨‍👩‍👧‍👦 Invitar a la familia</h3>
      <p class="small">Cada uno abre la app en su móvil y entra con el mismo código familiar.</p>
      <div class="code-box"><code id="codeTxt">••••••••</code><button class="btn ghost" data-act="showCode">Mostrar</button></div>
      <button class="btn primary wide" data-act="shareInvite">📤 Enviar invitación</button>
    </section>
    ${standalone ? '' : `<section class="card">
      <h3>📲 Instalar en el móvil</h3>
      ${S.installEvt ? '<button class="btn primary wide" data-act="install">Instalar app</button>' : ''}
      ${isIOS ? '<p class="small"><b>iPhone:</b> en Safari, toca el botón Compartir <b>⬆︎</b> y luego <b>«Añadir a pantalla de inicio»</b>.</p>'
              : '<p class="small"><b>Android:</b> en Chrome, menú <b>⋮</b> → <b>«Instalar aplicación»</b> o «Añadir a pantalla de inicio».</p>'}
    </section>`}
    <section class="card">
      <h3>💾 Copia de seguridad</h3>
      <label class="check"><input type="checkbox" id="expPhotos"> Incluir fotos (archivo más grande)</label>
      <div class="actions"><button class="btn" data-act="exportData">⬇️ Exportar</button><button class="btn" data-act="importData">⬆️ Importar</button></div>
      <input type="file" id="importInput" accept="application/json,.json" hidden>
    </section>
    <section class="card">
      <h3>ℹ️ Estado</h3>
      <p class="small">${S.session.mode === 'firebase' ? '☁️ Conectado a Firebase: los datos se comparten con toda la familia y funcionan sin conexión.' : '🧪 <b>Modo demo</b>: los datos solo están en este móvil.'}</p>
      <p class="muted small">Versión ${VERSION}</p>
      <button class="btn ghost danger wide" data-act="logout">Salir de esta casa en este móvil</button>
    </section>
  </div>`;
  $('#meForm').addEventListener('submit', e => {
    e.preventDefault(); const n = new FormData(e.target).get('me').trim(); if (!n) return;
    S.session.me = n; localStorage.setItem(SESSION_KEY, JSON.stringify(S.session)); write(S.store.addMember(n)); toast('Nombre cambiado');
  });
  $('#houseForm').addEventListener('submit', e => {
    e.preventDefault(); const n = new FormData(e.target).get('hname').trim();
    write(S.store.setHousehold({ name: n })); S.household = { ...S.household, name: n }; toast('Guardado');
  });
  $('#importInput').addEventListener('change', importData);
}

async function exportData() {
  const withPhotos = $('#expPhotos')?.checked;
  toast('Preparando copia…');
  try {
    const out = { app: 'donde-esta', version: VERSION, exportedAt: new Date().toISOString(), household: S.household,
      places: Object.values(S.places), items: Object.values(S.items), photos: withPhotos ? await S.store.getAll('photos') : [] };
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const name = `donde-esta-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { if (e.name !== 'AbortError') fail(e); }
}
async function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'donde-esta') throw new Error('Este archivo no es una copia de la app');
    if (!confirm(`Importar ${d.places.length} sitios y ${d.items.length} cosas${d.photos?.length ? ` y ${d.photos.length} fotos` : ''}?\n\nSe añadirán o actualizarán; no se borra nada.`)) return;
    toast('Importando…', 10000);
    const clean = arr => arr.map(({ id, ...r }) => ({ id, ...r }));
    await S.store.bulkSet('places', clean(d.places));
    await S.store.bulkSet('items', clean(d.items));
    if (d.photos?.length) await S.store.bulkSet('photos', clean(d.photos));
    toast('✅ Importado');
  } catch (err) { fail(err); }
  e.target.value = '';
}

// ───────────────────────── QR ─────────────────────────
async function loadQrLib() {
  if (window.qrcode) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el generador de QR (¿sin conexión?)'));
    document.head.appendChild(s);
  });
}
async function showQr(id) {
  const p = S.places[id]; if (!p) return;
  try { await loadQrLib(); } catch (e) { return fail(e); }
  const url = location.origin + location.pathname + '#/lugar/' + id;
  const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
  const sh = $('#sheet');
  sh.innerHTML = `<div class="sheet-bg" data-act="sheetClose"></div>
    <div class="sheet-panel qr-panel">
      <div class="sheet-head no-print"><button class="icon-btn" data-act="sheetClose">✕</button><h3>Etiqueta QR</h3></div>
      <div class="qr-label" id="qrLabel">
        <div class="qr-img">${qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div>
        <div class="qr-name">${placeIcon(p)} ${esc(p.name)}</div>
        <div class="qr-path">${esc(pathText(id, { withFloor: true }))}</div>
      </div>
      <p class="small muted no-print pad">Imprímela y pégala en la caja o el mueble. Al escanearla con la cámara se abre la lista de lo que hay dentro.</p>
      <div class="actions no-print pad"><button class="btn primary" data-act="printQr">🖨️ Imprimir</button></div>
    </div>`;
  sh.hidden = false; document.body.classList.add('noscroll');
}

// ───────────────────────── Acciones (delegación de clics) ─────────────────────────
const ACTIONS = {
  mic() {
    const r = new SpeechRec(); r.lang = 'es-ES'; r.interimResults = false;
    const b = document.querySelector('.mic'); b?.classList.add('rec');
    r.onresult = e => { S.q = e.results[0][0].transcript; const q = $('#q'); if (q) q.value = S.q; renderResults(); };
    r.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('No he podido escucharte'); };
    r.onend = () => b?.classList.remove('rec');
    try { r.start(); } catch { b?.classList.remove('rec'); }
  },
  saveFromSearch() { S.prefillName = S.q.trim().replace(/^¿?\s*d[oó]nde\s+(est[aá]n?|he\s+guardado)\s+(el|la|los|las|mi|mis)?\s*/i, '').replace(/\?$/, ''); S.prefillName = S.prefillName.charAt(0).toUpperCase() + S.prefillName.slice(1); S.form = null; S.q = ''; go('#/nuevo'); },
  pickPhoto() { $('#photoInput')?.click(); },
  removePhoto() { Object.assign(S.form, { thumb: null, newFull: null, removePhoto: true }); renderForm(S.form.id, parseHash().params); },
  pickPlace() { openPicker({ start: S.form.placeId, onPick: pid => { S.form.placeId = pid; updatePlaceButton(); } }); },
  pickerClose() { closeSheet(); },
  sheetClose() { closeSheet(); },
  pickerGo(el) {
    S.picker.cur = el.dataset.id || null; S.picker.adding = false;
    if (el.dataset.clear) { S.picker.filter = ''; $('#pickerFilter').value = ''; }
    renderPickerBody(); $('#pickerBody').scrollTop = 0;
  },
  pickerAdd() { S.picker.adding = true; renderPickerBody(); },
  pickerAddCancel() { S.picker.adding = false; renderPickerBody(); },
  pickerChoose(el) {
    const id = el.dataset.id || null; const cb = S.picker.onPick;
    closeSheet(); if (id) pushRecentPlace(id); cb(id);
  },
  moveItem(el) {
    const it = S.items[el.dataset.id];
    openPicker({ start: S.places[it.placeId]?.parentId || it.placeId, title: '¿Dónde está ahora?', onPick: pid => {
      if (!pid || pid === it.placeId) return;
      updateItem(it.id, { placeId: pid }, `Movido de ${pathText(it.placeId)} a ${pathText(pid)}`);
      toast(`📦 Ahora está en <b>${esc(pathText(pid))}</b>`); renderItem(it.id);
    } });
  },
  lendItem(el) {
    const who = prompt('¿A quién se lo has prestado?'); if (who === null) return;
    updateItem(el.dataset.id, { status: 'prestado', lentTo: who.trim() || '¿?', lentAt: now() }, `Prestado a ${who.trim() || '¿?'}`);
    renderItem(el.dataset.id);
  },
  returnItem(el) {
    const it = S.items[el.dataset.id];
    updateItem(it.id, { status: 'guardado', lentTo: '', lentAt: null }, `Devuelto por ${it.lentTo || '¿?'}`);
    renderItem(it.id); toast('✅ Devuelto. ¿Sigue en el mismo sitio? Si no, toca «Lo he cambiado de sitio».', 4000);
  },
  discardItem(el) {
    if (!confirm('¿Marcar como tirado o donado? Seguirá en la lista «Tirado» para que sepáis que ya no está.')) return;
    updateItem(el.dataset.id, { status: 'tirado', discardedAt: now(), discardedBy: me() }, 'Marcado como tirado o donado');
    renderItem(el.dataset.id);
  },
  restoreItem(el) { updateItem(el.dataset.id, { status: 'guardado' }, 'Recuperado: sigue en casa'); renderItem(el.dataset.id); },
  deleteItem(el) {
    const it = S.items[el.dataset.id];
    if (!confirm(`¿Borrar «${it.name}» de la app? No se puede deshacer.\n\n(Si lo habéis tirado, mejor usa «Lo hemos tirado».)`)) return;
    if (it.photoId) write(S.store.del('photos', it.photoId));
    delete S.items[it.id]; write(S.store.del('items', it.id));
    toast('Borrado'); go('#/', true);
  },
  zoom() { const img = $('#heroImg'); if (img) img.classList.toggle('zoomed'); },
  addChild(el) {
    const pid = el.dataset.id || null; const parent = S.places[pid];
    const type = CHILD_TYPE[parent?.type || 'root'];
    const name = prompt(`${ADD_LABEL[type]}${parent ? ' en ' + parent.name : ''}:`); if (!name?.trim()) return;
    addPlace(pid, name, type); toast(`Añadido «${esc(name.trim())}»`); refresh();
  },
  renamePlace(el) {
    const p = S.places[el.dataset.id]; const name = prompt('Nuevo nombre:', p.name); if (!name?.trim() || name === p.name) return;
    p.name = name.trim(); write(S.store.set('places', p.id, { name: p.name })); refresh();
  },
  iconPlace(el) {
    const p = S.places[el.dataset.id]; const ic = prompt('Escribe un emoji para este sitio (déjalo vacío para el de por defecto):', p.icon || '');
    if (ic === null) return; p.icon = ic.trim().slice(0, 4) || null; write(S.store.set('places', p.id, { icon: p.icon })); refresh();
  },
  movePlace(el) {
    const p = S.places[el.dataset.id];
    openPicker({ start: p.parentId, title: `¿Dentro de qué está «${p.name}»?`, exclude: p.id, allowRoot: p.type === 'floor', onPick: pid => {
      if ((pid || null) === (p.parentId || null)) return;
      p.parentId = pid || null; write(S.store.set('places', p.id, { parentId: p.parentId, order: childrenOf(pid).length }));
      toast('Movido'); refresh();
    } });
  },
  deletePlace(el) {
    const p = S.places[el.dataset.id];
    const kids = childrenOf(p.id).length; const n = activeItems().filter(i => descendantIds(p.id).includes(i.placeId)).length;
    if (kids || n) return toast(`No se puede borrar: dentro hay ${kids ? kids + ' sitio(s)' : ''}${kids && n ? ' y ' : ''}${n ? n + ' cosa(s)' : ''}. Muévelos o bórralos antes.`, 4500);
    if (!confirm(`¿Borrar «${p.name}»?`)) return;
    const parent = p.parentId; delete S.places[p.id]; write(S.store.del('places', p.id));
    go(parent ? '#/lugar/' + parent : '#/lugares', true);
  },
  qrPlace(el) { showQr(el.dataset.id); },
  tutorial() { openTutorial(); },
  printQr() { document.body.classList.add('print-qr'); window.print(); setTimeout(() => document.body.classList.remove('print-qr'), 500); },
  listCat(el) { S.listCat = el.dataset.cat; renderLists(); },
  showCode(el) { const c = $('#codeTxt'); const shown = c.dataset.shown === '1'; c.textContent = shown ? '••••••••' : S.session.code; c.dataset.shown = shown ? '0' : '1'; el.textContent = shown ? 'Mostrar' : 'Ocultar'; },
  async shareInvite() {
    const url = location.origin + location.pathname;
    const text = `Apunta aquí dónde guardamos las cosas de casa 🏠\n\n1. Abre ${url}\n2. Añádela a la pantalla de inicio\n3. Entra con el código familiar: ${S.session.code}`;
    try {
      if (navigator.share) await navigator.share({ title: '¿Dónde está?', text });
      else { await navigator.clipboard.writeText(text); toast('Invitación copiada. Pégala en WhatsApp.'); }
    } catch (e) { if (e.name !== 'AbortError') fail(e); }
  },
  async install() { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; renderSettings(); },
  exportData() { exportData(); },
  importData() { $('#importInput').click(); },
  logout() {
    if (!confirm('¿Salir de esta casa en este móvil? Los datos no se borran; podrás volver a entrar con el código.')) return;
    localStorage.removeItem(SESSION_KEY); location.hash = '#/'; location.reload();
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !ACTIONS[el.dataset.act]) return;
  e.preventDefault();
  try { const r = ACTIONS[el.dataset.act](el, e); if (r?.catch) r.catch(fail); } catch (err) { fail(err); }
});
$('#backBtn').addEventListener('click', goBack);
document.querySelector('#tabbar a[data-tab=home]').addEventListener('click', e => {
  if (S.current?.root === '' && S.q) { e.preventDefault(); S.q = ''; const q = $('#q'); if (q) q.value = ''; renderResults(); }
});
$('#helpBtn').addEventListener('click', () => openTutorial());
window.addEventListener('hashchange', onHashChange);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// ───────────────────────── Arranque ─────────────────────────
async function boot() {
  navStack.push(location.hash || '#/');
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(console.warn);
  }
  try { S.session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { S.session = null; }
  if (S.session && S.session.mode === 'firebase' && !isConfigured()) S.session = null;
  if (!S.session) return route();
  try {
    S.store = await makeStore(S.session.mode, S.session.hid);
    startSync(); route();
  } catch (e) {
    fail(e);
    view.innerHTML = `<div class="empty"><p>No se ha podido conectar.</p><p class="muted small">${esc(friendlyError(e))}</p><button class="btn primary" onclick="location.reload()">Reintentar</button></div>`;
  }
}
boot();
