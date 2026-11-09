// Tutorial de bienvenida: diapositivas deslizables con mini-maquetas de la propia app.
export const TUTORIAL_KEY = 'donde-esta-tutorial-v1';

const SLIDES = [
  {
    title: '¡Bienvenidos!',
    text: 'Esta app es la <b>memoria de la casa</b>: apuntáis dónde guardáis las cosas y luego las encontráis en segundos. Es la misma para los cuatro.',
    demo: `<div class="tut-hero"><img src="icons/icon-192.png" alt=""><div class="tut-bubble">¿Dónde están los pasaportes?</div><div class="tut-bubble ans">📍 Salón › Taquillón</div></div>`
  },
  {
    title: '1. Guardar algo',
    text: 'Pulsa el botón <b class="tut-plus">＋</b> de abajo, escribe qué es y, si quieres, hazle una <b>foto</b>.',
    demo: `<div class="tut-phone">
      <div class="tut-row"><span class="tut-photo">📷</span><span class="tut-input">Carnet de conducir</span></div>
      <div class="tut-place">📍 <b>Elegir sitio…</b><small>Planta → habitación → mueble → cajón</small></div>
      <div class="tut-btn">Guardar</div></div>`
  },
  {
    title: '2. Elegir el sitio',
    text: 'Ve tocando de fuera hacia dentro: <b>planta, habitación, mueble y cajón</b>. ¿El mueble o el cajón no está? Créalo en ese momento con <b>＋</b>. Cuando llegues, toca <b>«Aquí»</b>.',
    demo: `<div class="tut-phone">
      <div class="tut-crumbs"><span>🏠 Casa</span>›<span>Planta baja</span>›<span class="on">Entrada</span></div>
      <div class="tut-list"><div>🗄️ Mueble de la entrada <span>›</span></div><div class="add">＋ Nuevo mueble en Entrada</div></div>
      <div class="tut-btn">Aquí: <b>Entrada</b></div></div>`
  },
  {
    title: '3. Buscar',
    text: 'En <b>🔎 Buscar</b> escribe o dicta con el <b>🎤</b>. Da igual poner tildes, plurales o preguntar «¿dónde está…?». También vale buscar por sitio: «taquillón» te dice todo lo que hay dentro.',
    demo: `<div class="tut-phone">
      <div class="tut-search">🔎 carnet</div>
      <div class="tut-answer"><small>Carnet de conducir</small><b>📍 Entrada › Mueble de la entrada</b></div></div>`
  },
  {
    title: '4. Mantenerlo al día',
    text: 'Abre una cosa y usa sus botones. Así la app nunca miente:',
    demo: `<div class="tut-actions">
      <div><b>📦 Lo he cambiado de sitio</b><small>Se guarda dónde estaba antes</small></div>
      <div><b>🤝 Lo he prestado</b><small>Apunta a quién</small></div>
      <div><b>🗑️ Lo hemos tirado</b><small>Pasa a la lista «Tirado» para que nadie lo busque</small></div></div>`
  },
  {
    title: '5. Explorar y avisos',
    text: '<b>🏠 Lugares</b> enseña qué hay en cada habitación, mueble o caja. En <b>📋 Listas</b> están las cosas prestadas, las tiradas y las que caducan pronto. Si pones fecha de caducidad (pasaporte, DNI, garantías), la app <b>avisa 60 días antes</b>.',
    demo: `<div class="tut-actions"><div class="alert"><b>⏰ Revisa esto</b><small>Pasaporte de Nuria — caduca en 40 días</small></div><div class="lent"><b>🤝 1 prestada</b><small>Taladro → vecino</small></div></div>`
  },
  {
    title: 'Trucos',
    titleFirst: true,
    text: '',
    demo: `<ul class="tut-tips">
      <li><span>🏷️</span><div><b>Etiquetas QR para el trastero.</b> Abre una caja o mueble en Lugares → «Etiqueta QR», imprímela y pégala. Al escanearla ves lo que hay dentro.</div></li>
      <li><span>⚡</span><div><b>Muchas cosas en el mismo sitio:</b> después de guardar una, pulsa «Guardar otra cosa en el mismo sitio».</div></li>
      <li><span>📸</span><div><b>Las fotos ayudan mucho</b> con cajas y cosas parecidas.</div></li>
      <li><span>👨‍👩‍👧‍👦</span><div><b>Invita a la familia</b> desde ⚙️ Ajustes → «Enviar invitación». El código es el mismo para todos.</div></li>
      <li><span>📶</span><div><b>Funciona sin cobertura</b> (garaje, bodega). Se sincroniza sola después.</div></li>
    </ul>`
  }
];

export function openTutorial({ onDone } = {}) {
  const root = document.createElement('div');
  root.id = 'tutorial';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Tutorial');
  root.innerHTML = `
    <button class="tut-skip" data-tut="close">Saltar</button>
    <div class="tut-track">${SLIDES.map((s, i) => `
      <section class="tut-slide" data-i="${i}">
        ${s.titleFirst ? `<h2 class="first">${s.title}</h2>` : ''}
        <div class="tut-demo">${s.demo}</div>
        ${s.titleFirst ? '' : `<h2>${s.title}</h2>`}
        ${s.text ? `<p>${s.text}</p>` : ''}
      </section>`).join('')}
    </div>
    <div class="tut-foot">
      <div class="tut-dots">${SLIDES.map((_, i) => `<button data-tut="go" data-i="${i}" aria-label="Paso ${i + 1}"></button>`).join('')}</div>
      <div class="tut-nav">
        <button class="btn ghost" data-tut="prev">Atrás</button>
        <button class="btn primary" data-tut="next">Siguiente</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('noscroll');
  const track = root.querySelector('.tut-track');
  const dots = [...root.querySelectorAll('.tut-dots button')];
  const prev = root.querySelector('[data-tut=prev]');
  const next = root.querySelector('[data-tut=next]');
  let idx = 0;
  const update = () => {
    dots.forEach((d, i) => d.classList.toggle('on', i === idx));
    prev.style.visibility = idx === 0 ? 'hidden' : 'visible';
    next.textContent = idx === SLIDES.length - 1 ? '¡Empezar!' : 'Siguiente';
    root.querySelector('.tut-skip').style.visibility = idx === SLIDES.length - 1 ? 'hidden' : 'visible';
  };
  const go = i => { idx = Math.max(0, Math.min(SLIDES.length - 1, i)); track.scrollTo({ left: idx * track.clientWidth, behavior: 'smooth' }); update(); };
  const close = () => {
    try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch {}
    root.classList.add('out');
    setTimeout(() => { root.remove(); document.body.classList.remove('noscroll'); onDone?.(); }, 200);
  };
  track.addEventListener('scroll', () => {
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (i !== idx) { idx = i; update(); }
  }, { passive: true });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-tut]'); if (!b) return;
    e.stopPropagation();
    const a = b.dataset.tut;
    if (a === 'close') close();
    else if (a === 'prev') go(idx - 1);
    else if (a === 'next') idx === SLIDES.length - 1 ? close() : go(idx + 1);
    else if (a === 'go') go(+b.dataset.i);
  });
  const onKey = e => {
    if (!document.body.contains(root)) return document.removeEventListener('keydown', onKey);
    if (e.key === 'ArrowRight') go(idx + 1); else if (e.key === 'ArrowLeft') go(idx - 1); else if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  update();
}

export const tutorialSeen = () => { try { return localStorage.getItem(TUTORIAL_KEY) === '1'; } catch { return true; } };
