import { currentLocale, initI18n, setLocale, t } from './i18n.js';
import { createPlayer } from './player.js';

const RECONNECT_DELAY_MS = 2000;
const NOTICE_DURATION_MS = 4000;
const VOLUME_SEND_INTERVAL_MS = 100;

const elements = {
  connection: document.querySelector('#connection'),
  language: document.querySelector('#language'),
  addForm: document.querySelector('#add-form'),
  addInput: document.querySelector('#add-input'),
  next: document.querySelector('#next'),
  volume: document.querySelector('#volume'),
  volumeValue: document.querySelector('#volume-value'),
  nowTitle: document.querySelector('#now-title'),
  queue: document.querySelector('#queue'),
  queueEmpty: document.querySelector('#queue-empty'),
  notices: document.querySelector('#notices'),
};

let state = { current: null, queue: [], volume: 50 };
let connection = 'connecting';
let socket = null;
let player = null;
let loadedId = null;
let adjustingVolume = false;
let lastVolumeSent = 0;

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function showNotice(text, kind = 'info') {
  const notice = document.createElement('div');
  notice.className = `notice ${kind}`;
  notice.textContent = text;
  elements.notices.append(notice);
  setTimeout(() => notice.remove(), NOTICE_DURATION_MS);
}

const CONNECTION_KEYS = {
  connecting: 'connection.connecting',
  open: 'connection.online',
  offline: 'connection.offline',
};

function renderStatus() {
  elements.connection.textContent = t(CONNECTION_KEYS[connection]);
}

function renderNow() {
  elements.nowTitle.textContent = state.current?.title ?? t('now.empty');
  elements.next.disabled = !state.current;
}

function renderVolume() {
  if (!adjustingVolume) elements.volume.value = state.volume;
  elements.volumeValue.textContent = `${elements.volume.value}%`;
}

function renderQueue() {
  elements.queue.replaceChildren(...state.queue.map((track) => {
    const item = document.createElement('li');
    item.dataset.id = track.id;

    const title = document.createElement('span');
    title.className = 'track-title';
    title.textContent = track.title;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = t('queue.remove');
    remove.addEventListener('click', () => send({ type: 'queue.remove', id: track.id }));

    item.append(title, remove);
    return item;
  }));
  elements.queueEmpty.hidden = state.queue.length > 0;
}

function syncPlayer() {
  if (!player) return;

  player.setVolume(state.volume);

  const wanted = state.current?.id ?? null;
  if (wanted === loadedId) return;

  loadedId = wanted;
  if (state.current) {
    player.load(state.current.videoId);
  } else {
    player.stop();
  }
}

function handleMessage(message) {
  switch (message.type) {
    case 'state':
      state = message.data;
      renderNow();
      renderQueue();
      renderVolume();
      syncPlayer();
      break;
    case 'notice':
      showNotice(t(message.key, message.params));
      break;
    case 'error':
      showNotice(t(message.key), 'error');
      renderQueue();
      break;
  }
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}/ws`);

  socket.addEventListener('open', () => {
    connection = 'open';
    renderStatus();
  });

  socket.addEventListener('close', () => {
    connection = 'offline';
    renderStatus();
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  socket.addEventListener('message', (event) => handleMessage(JSON.parse(event.data)));
}

function setupEvents() {
  elements.language.value = currentLocale();
  elements.language.addEventListener('change', () => setLocale(elements.language.value));

  window.addEventListener('localechange', () => {
    elements.language.value = currentLocale();
    renderStatus();
    renderNow();
    renderQueue();
  });

  elements.addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    send({ type: 'queue.add', url: elements.addInput.value.trim() });
    elements.addInput.value = '';
  });

  elements.next.addEventListener('click', () => send({ type: 'playback.next' }));

  const sendVolume = () => send({ type: 'playback.volume', volume: Number(elements.volume.value) });
  elements.volume.addEventListener('pointerdown', () => { adjustingVolume = true; });
  elements.volume.addEventListener('input', () => {
    elements.volumeValue.textContent = `${elements.volume.value}%`;
    if (Date.now() - lastVolumeSent < VOLUME_SEND_INTERVAL_MS) return;
    lastVolumeSent = Date.now();
    sendVolume();
  });
  elements.volume.addEventListener('blur', () => { adjustingVolume = false; });
  elements.volume.addEventListener('change', () => {
    adjustingVolume = false;
    sendVolume();
  });
}

function setupSortable() {
  Sortable.create(elements.queue, {
    animation: 150,
    onEnd: (event) => {
      send({ type: 'queue.move', id: event.item.dataset.id, toIndex: event.newIndex });
    },
  });
}

async function start() {
  await initI18n();
  setupEvents();
  setupSortable();
  renderStatus();
  renderNow();
  renderQueue();
  connect();

  try {
    player = await createPlayer({
      onEnded: () => {
        if (loadedId) send({ type: 'playback.ended', id: loadedId });
      },
      onUnavailable: () => {
        if (loadedId) send({ type: 'playback.unavailable', id: loadedId });
      },
    });
    syncPlayer();
  } catch {
    showNotice(t('errors.playerUnavailable'), 'error');
  }
}

start();
