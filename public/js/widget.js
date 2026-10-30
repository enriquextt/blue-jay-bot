import { initI18n, t } from './i18n.js';

const RECONNECT_DELAY_MS = 2000;
const TICK_MS = 250;
const TEST_SECONDS = 8;
const DEFAULT_SHOW_SECONDS = 10;

const elements = {
  card: document.querySelector('#card'),
  title: document.querySelector('#title'),
  meta: document.querySelector('#meta'),
  bar: document.querySelector('#bar'),
  position: document.querySelector('#position'),
  duration: document.querySelector('#duration'),
};

let current = null;
// Último progreso recibido y cuándo llegó: entre mensajes la barra avanza sola.
let progress = null;
let receivedAt = 0;
let test = null;
// Hasta cuándo se muestra el widget tras un `!queue` o `!song`.
let shownUntil = 0;
// El primer estado tras conectar no cuenta como cambio de pista: al cargar el widget no debe aparecer.
let stateReceived = false;

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const rest = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function metaText({ artist, requestedBy }) {
  return [artist, requestedBy && t('widget.requestedBy', { user: requestedBy })].filter(Boolean).join(' · ');
}

// Lo que se muestra ahora: la tarjeta de prueba mientras dure, y si no, la canción real.
function view() {
  if (test) {
    const position = Math.min((Date.now() - test.startedAt) / 1000, TEST_SECONDS);
    return { title: t('widget.testTitle'), meta: t('widget.testArtist'), position, duration: TEST_SECONDS };
  }
  if (!current) return null;

  let position = 0;
  let duration = 0;
  if (progress?.id === current.id) {
    duration = progress.duration;
    position = progress.paused ? progress.position : progress.position + (Date.now() - receivedAt) / 1000;
  }
  return { title: current.title, meta: metaText(current), position: Math.min(position, duration || position), duration };
}

function render() {
  if (test && Date.now() - test.startedAt > TEST_SECONDS * 1000) test = null;

  const data = view();
  elements.card.hidden = !data;
  if (!data) return;

  elements.card.classList.toggle('shown', Boolean(test) || Date.now() < shownUntil);
  elements.card.classList.toggle('paused', progress?.id === current?.id && Boolean(progress?.paused));

  elements.title.textContent = data.title;
  elements.meta.textContent = data.meta;
  elements.bar.style.width = data.duration > 0 ? `${Math.min(100, (data.position / data.duration) * 100)}%` : '0%';
  elements.position.textContent = formatTime(data.position);
  // Sin duración (directos de YouTube) solo se muestra el tiempo transcurrido.
  elements.duration.textContent = data.duration > 0 ? formatTime(data.duration) : '';
}

function handleMessage(message) {
  switch (message.type) {
    case 'state':
      if (message.data.current?.id !== current?.id) {
        progress = null;
        // Al cambiar de pista (o empezar la siguiente) el widget se deja ver unos segundos.
        if (stateReceived && message.data.current) shownUntil = Date.now() + DEFAULT_SHOW_SECONDS * 1000;
      }
      stateReceived = true;
      current = message.data.current;
      break;
    case 'progress':
      progress = message.data;
      receivedAt = Date.now();
      break;
    case 'widget.test':
      test = { startedAt: Date.now() };
      break;
    case 'widget.show':
      shownUntil = Date.now() + (message.data?.seconds ?? DEFAULT_SHOW_SECONDS) * 1000;
      break;
  }
  render();
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/ws?view=widget`);

  socket.addEventListener('message', (event) => handleMessage(JSON.parse(event.data)));
  socket.addEventListener('close', () => setTimeout(connect, RECONNECT_DELAY_MS));
}

async function start() {
  const params = new URLSearchParams(location.search);
  // `?idle=0.3`: opacidad del widget cuando no se está mostrando (0 = invisible).
  const idle = Number(params.get('idle'));
  if (params.has('idle') && idle >= 0 && idle <= 1) elements.card.style.setProperty('--idle-opacity', idle);

  await initI18n(params.get('lang'));
  connect();
  setInterval(render, TICK_MS);
}

start();
