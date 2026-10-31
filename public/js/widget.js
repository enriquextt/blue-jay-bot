import { initI18n, t } from './i18n.js';
import { templateValues } from './widget/format.js';
import { createRenderer } from './widget/render.js';

const RECONNECT_DELAY_MS = 2000;
const TICK_MS = 250;
const TEST_SECONDS = 8;
const DEFAULT_SHOW_SECONDS = 10;

let renderer = null;
// El layout del servidor y el que se dibuja ahora (el de una prueba con borrador es otro mientras dura).
let baseLayout = null;
let layoutJson = null;
let current = null;
// Último progreso recibido y cuándo llegó: entre mensajes la barra avanza sola.
let progress = null;
let receivedAt = 0;
let test = null;
// Hasta cuándo se muestra el widget tras un `!queue` o `!song`.
let shownUntil = 0;
// El primer estado tras conectar no cuenta como cambio de pista: al cargar el widget no debe aparecer.
let stateReceived = false;

// Solo se redibuja si cambió: cada guardado se envía a todos los widgets.
function applyLayout(layout) {
  const json = JSON.stringify(layout);
  if (json !== layoutJson) renderer.setLayout(layout);
  layoutJson = json;
}

const showMs = (seconds) => (renderer?.layout?.showSeconds ?? seconds ?? DEFAULT_SHOW_SECONDS) * 1000;

// Lo que se muestra ahora: la tarjeta de prueba mientras dure, y si no, la canción real.
function view() {
  if (test) {
    const position = Math.min((Date.now() - test.startedAt) / 1000, TEST_SECONDS);
    return { title: t('widget.testTitle'), artist: t('widget.testArtist'), position, duration: TEST_SECONDS };
  }
  if (!current) return null;

  let position = 0;
  let duration = 0;
  if (progress?.id === current.id) {
    duration = progress.duration;
    position = progress.paused ? progress.position : progress.position + (Date.now() - receivedAt) / 1000;
  }
  const requester = current.requestedBy && t('widget.requestedBy', { user: current.requestedBy });
  return { title: current.title, artist: current.artist, requester, position: Math.min(position, duration || position), duration };
}

function render() {
  if (!renderer?.layout) return;
  // La tarjeta de prueba se ve TEST_SECONDS y se quita cuando ha terminado también la animación de salida.
  const testEnd = test && test.startedAt + TEST_SECONDS * 1000;
  if (test && Date.now() > testEnd + renderer.timing.exit + TICK_MS) {
    const draft = test.layout;
    test = null;
    if (draft && baseLayout) applyLayout(baseLayout);
  }

  const data = view();
  renderer.update(data && { values: templateValues(data), fraction: data.duration > 0 ? Math.min(1, data.position / data.duration) : 0 }, {
    shown: Boolean(test && Date.now() < testEnd) || Date.now() < shownUntil,
    paused: progress?.id === current?.id && Boolean(progress?.paused),
  });
}

function handleMessage(message) {
  switch (message.type) {
    case 'widget.layout':
      baseLayout = message.data;
      if (!test?.layout) applyLayout(baseLayout);
      break;
    case 'state':
      if (message.data.current?.id !== current?.id) {
        progress = null;
        // Al cambiar de pista (o empezar la siguiente) el widget se deja ver unos segundos.
        if (stateReceived && message.data.current) shownUntil = Date.now() + showMs();
      }
      stateReceived = true;
      current = message.data.current;
      break;
    case 'progress':
      progress = message.data;
      receivedAt = Date.now();
      break;
    case 'widget.test':
      // Con un borrador del editor (`layout`) la prueba lo dibuja, sin guardarlo, mientras dura.
      test = { startedAt: Date.now(), layout: message.data?.layout ?? null };
      if (test.layout) applyLayout(test.layout);
      break;
    case 'widget.show':
      shownUntil = Date.now() + showMs(message.data?.seconds);
      break;
  }
  render();
}

function connect(layoutId) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const query = new URLSearchParams({ view: 'widget' });
  if (layoutId) query.set('layout', layoutId);
  const socket = new WebSocket(`${protocol}://${location.host}/ws?${query}`);

  socket.addEventListener('message', (event) => handleMessage(JSON.parse(event.data)));
  socket.addEventListener('close', () => setTimeout(() => connect(layoutId), RECONNECT_DELAY_MS));
}

async function start() {
  const params = new URLSearchParams(location.search);
  // `?idle=0.3`: opacidad del widget cuando no se está mostrando (0 = invisible); si falta, la del layout.
  const idle = Number(params.get('idle'));
  const idleOpacity = params.has('idle') && idle >= 0 && idle <= 1 ? idle : null;

  renderer = createRenderer(document.querySelector('#root'), { idleOpacity });
  window.addEventListener('resize', renderer.fit);

  await initI18n(params.get('lang'));
  // `?layout=<id>`: qué layout dibuja esta fuente de navegador; sin él, el activo.
  connect(params.get('layout'));
  setInterval(render, TICK_MS);
}

start();
