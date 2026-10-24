import { currentLocale, initI18n, setLocale, t } from './i18n.js';
import { createPlayer } from './player.js';

const RECONNECT_DELAY_MS = 2000;
const NOTICE_DURATION_MS = 4000;
const VOLUME_SEND_INTERVAL_MS = 100;
const CLEAR_CONFIRM_MS = 3000;

const elements = {
  connection: document.querySelector('#connection'),
  language: document.querySelector('#language'),
  addForm: document.querySelector('#add-form'),
  addInput: document.querySelector('#add-input'),
  next: document.querySelector('#next'),
  nowFavorite: document.querySelector('#now-favorite'),
  nowBan: document.querySelector('#now-ban'),
  volume: document.querySelector('#volume'),
  volumeValue: document.querySelector('#volume-value'),
  nowTitle: document.querySelector('#now-title'),
  queue: document.querySelector('#queue'),
  queueEmpty: document.querySelector('#queue-empty'),
  notices: document.querySelector('#notices'),
  baseListForm: document.querySelector('#baselist-form'),
  baseListInput: document.querySelector('#baselist-input'),
  baseListStart: document.querySelector('#baselist-start'),
  baseListShuffle: document.querySelector('#baselist-shuffle'),
  baseListStop: document.querySelector('#baselist-stop'),
  baseListClear: document.querySelector('#baselist-clear'),
  baseListStatus: document.querySelector('#baselist-status'),
  baseListCount: document.querySelector('#baselist-count'),
  baseList: document.querySelector('#baselist'),
  baseListEmpty: document.querySelector('#baselist-empty'),
  banned: document.querySelector('#banned'),
  bannedEmpty: document.querySelector('#banned-empty'),
  tabs: [...document.querySelectorAll('[role="tab"]')],
  countQueue: document.querySelector('#count-queue'),
  countBaseList: document.querySelector('#count-baselist'),
  countBanned: document.querySelector('#count-banned'),
};

const TAB_STORAGE_KEY = 'blueJay.tab';

let state = { current: null, queue: [], volume: 50, fallback: { active: false, mode: 'sequential' } };
let baseListData = { items: [], banned: [] };
let connection = 'connecting';
let socket = null;
let player = null;
let loadedId = null;
let adjustingVolume = false;
let lastVolumeSent = 0;
let clearTimer = null;

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

function favoriteLabel(favorite) {
  return t(favorite ? 'track.unfavorite' : 'track.favorite');
}

function setFavoriteButton(button, favorite) {
  button.textContent = favorite ? '★' : '☆';
  button.classList.toggle('active', favorite);
  button.title = favoriteLabel(favorite);
  button.setAttribute('aria-label', favoriteLabel(favorite));
}

function renderNow() {
  const { current } = state;
  elements.nowTitle.textContent = current?.title ?? t('now.empty');
  elements.next.disabled = !current;

  setFavoriteButton(elements.nowFavorite, current?.favorite === true);
  elements.nowFavorite.disabled = !current;
  elements.nowBan.title = t('track.ban');
  elements.nowBan.setAttribute('aria-label', t('track.ban'));
  elements.nowBan.disabled = !current;
}

function renderVolume() {
  if (!adjustingVolume) elements.volume.value = state.volume;
  elements.volumeValue.textContent = `${elements.volume.value}%`;
}

// Botón con símbolo y texto accesible (título y aria-label).
function iconButton({ symbol, label, className = '', onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon ${className}`.trim();
  button.textContent = symbol;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function favoriteButton(track) {
  const button = iconButton({
    symbol: '☆',
    label: favoriteLabel(track.favorite),
    onClick: () => send({ type: 'favorite.set', id: track.id, favorite: !track.favorite }),
  });
  setFavoriteButton(button, track.favorite === true);
  return button;
}

function banButton(track) {
  return iconButton({
    symbol: '⛔',
    label: t('track.ban'),
    className: 'danger',
    onClick: () => send({ type: 'ban.add', id: track.id }),
  });
}

function textButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function titleSpan(title) {
  const span = document.createElement('span');
  span.className = 'track-title';
  span.textContent = title;
  span.title = title;
  return span;
}

function renderQueue() {
  elements.queue.replaceChildren(...state.queue.map((track) => {
    const item = document.createElement('li');
    item.dataset.id = track.id;
    item.append(
      titleSpan(track.title),
      favoriteButton(track),
      banButton(track),
      textButton(t('queue.remove'), 'danger', () => send({ type: 'queue.remove', id: track.id })),
    );
    return item;
  }));
  elements.queueEmpty.hidden = state.queue.length > 0;
  elements.countQueue.textContent = state.queue.length;
}

function renderBaseList() {
  const { items, banned } = baseListData;
  const { active, mode } = state.fallback;

  elements.baseList.replaceChildren(...items.map((track) => {
    const item = document.createElement('li');
    item.append(
      titleSpan(track.title),
      favoriteButton(track),
      banButton(track),
      textButton(t('track.remove'), 'danger', () => send({ type: 'baselist.remove', id: track.id })),
    );
    return item;
  }));
  elements.baseListEmpty.hidden = items.length > 0;
  elements.baseListCount.textContent = t('baselist.count', { count: items.length });
  elements.baseListClear.disabled = items.length === 0;

  elements.baseListStart.setAttribute('aria-pressed', String(active && mode === 'sequential'));
  elements.baseListShuffle.setAttribute('aria-pressed', String(active && mode === 'shuffle'));
  elements.baseListStop.disabled = !active;
  elements.baseListStatus.textContent = t(active ? `baselist.status.${mode}` : 'baselist.status.inactive');

  elements.banned.replaceChildren(...banned.map((entry) => {
    const item = document.createElement('li');
    item.append(
      titleSpan(entry.title),
      textButton(t('banned.unban'), '', () => send({ type: 'ban.remove', videoId: entry.videoId })),
    );
    return item;
  }));
  elements.bannedEmpty.hidden = banned.length > 0;

  elements.countBaseList.textContent = items.length;
  elements.countBanned.textContent = banned.length;
}

function savedTab() {
  try {
    const name = localStorage.getItem(TAB_STORAGE_KEY);
    return elements.tabs.some((tab) => tab.dataset.tab === name) ? name : null;
  } catch {
    return null;
  }
}

function selectTab(name, { focus = false } = {}) {
  for (const tab of elements.tabs) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
    if (selected && focus) tab.focus();
  }

  try {
    localStorage.setItem(TAB_STORAGE_KEY, name);
  } catch {
    // Sin almacenamiento disponible: la pestaña solo dura esta sesión.
  }
}

function setupTabs() {
  elements.tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      const last = elements.tabs.length - 1;
      const target = {
        ArrowRight: index === last ? 0 : index + 1,
        ArrowLeft: index === 0 ? last : index - 1,
        Home: 0,
        End: last,
      }[event.key];
      if (target === undefined) return;

      event.preventDefault();
      selectTab(elements.tabs[target].dataset.tab, { focus: true });
    });
  });

  selectTab(savedTab() ?? elements.tabs[0].dataset.tab);
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
      renderBaseList();
      renderVolume();
      syncPlayer();
      break;
    case 'baselist':
      baseListData = message.data;
      renderBaseList();
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

function setupBaseListEvents() {
  elements.baseListForm.addEventListener('submit', (event) => {
    event.preventDefault();
    send({ type: 'baselist.add', url: elements.baseListInput.value.trim() });
    elements.baseListInput.value = '';
  });
  elements.baseListStart.addEventListener('click', () => send({ type: 'baselist.start', mode: 'sequential' }));
  elements.baseListShuffle.addEventListener('click', () => send({ type: 'baselist.start', mode: 'shuffle' }));
  elements.baseListStop.addEventListener('click', () => send({ type: 'baselist.stop' }));
  elements.baseListClear.addEventListener('click', () => {
    // Doble pulsación en lugar de confirm() nativo.
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
      elements.baseListClear.textContent = t('baselist.clear');
      send({ type: 'baselist.clear' });
      return;
    }

    elements.baseListClear.textContent = t('baselist.clearConfirm');
    clearTimer = setTimeout(() => {
      clearTimer = null;
      elements.baseListClear.textContent = t('baselist.clear');
    }, CLEAR_CONFIRM_MS);
  });
}

function setupEvents() {
  elements.language.value = currentLocale();
  elements.language.addEventListener('change', () => setLocale(elements.language.value));

  window.addEventListener('localechange', () => {
    elements.language.value = currentLocale();
    renderStatus();
    renderNow();
    renderQueue();
    renderBaseList();
  });

  elements.addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    send({ type: 'queue.add', url: elements.addInput.value.trim() });
    elements.addInput.value = '';
  });

  elements.next.addEventListener('click', () => send({ type: 'playback.next' }));
  elements.nowFavorite.addEventListener('click', () => {
    if (state.current) send({ type: 'favorite.set', id: state.current.id, favorite: !state.current.favorite });
  });
  elements.nowBan.addEventListener('click', () => {
    if (state.current) send({ type: 'ban.add', id: state.current.id });
  });

  setupBaseListEvents();

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
  setupTabs();
  setupSortable();
  renderStatus();
  renderNow();
  renderQueue();
  renderBaseList();
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
