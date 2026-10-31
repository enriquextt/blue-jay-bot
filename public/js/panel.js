import { confirmOnSecondClick, iconButton, textButton, titleSpan, trackLabel } from './dom.js';
import { createDiagnosticsView } from './diagnostics-view.js';
import { createHistoryView } from './history-view.js';
import { currentLocale, initI18n, setLocale, t } from './i18n.js';
import { icon } from './icons.js';
import { createLocalPlayer } from './local-player.js';
import { createMessagesView } from './messages-view.js';
import { createPlayer } from './player.js';
import { createPlaylistsView } from './playlists-view.js';
import { createSettingsView } from './settings-view.js';
import { createWidgetEditorView } from './widget-editor-view.js';

const RECONNECT_DELAY_MS = 2000;
const PROGRESS_INTERVAL_MS = 1000;
const NEXT_TRACK_DELAY_MS = 1000;
const NOTICE_DURATION_MS = 4000;
const VOLUME_SEND_INTERVAL_MS = 100;
const SEARCH_DEBOUNCE_MS = 250;

const elements = {
  connection: document.querySelector('#connection'),
  language: document.querySelector('#language'),
  addForm: document.querySelector('#add-form'),
  addInput: document.querySelector('#add-input'),
  next: document.querySelector('#next'),
  pause: document.querySelector('#pause'),
  nowShuffle: document.querySelector('#now-shuffle'),
  nowFavorite: document.querySelector('#now-favorite'),
  nowBan: document.querySelector('#now-ban'),
  volume: document.querySelector('#volume'),
  volumeValue: document.querySelector('#volume-value'),
  nowTitle: document.querySelector('#now-title'),
  queue: document.querySelector('#queue'),
  queueEmpty: document.querySelector('#queue-empty'),
  queueClear: document.querySelector('#queue-clear'),
  queueClearLabel: document.querySelector('#queue-clear span'),
  queueSaveForm: document.querySelector('#queue-save-form'),
  queueSaveName: document.querySelector('#queue-save-name'),
  queueSave: document.querySelector('#queue-save'),
  notices: document.querySelector('#notices'),
  baseListForm: document.querySelector('#baselist-form'),
  baseListInput: document.querySelector('#baselist-input'),
  baseListStart: document.querySelector('#baselist-start'),
  baseListShuffle: document.querySelector('#baselist-shuffle'),
  baseListStop: document.querySelector('#baselist-stop'),
  baseListClear: document.querySelector('#baselist-clear'),
  baseListClearLabel: document.querySelector('#baselist-clear span'),
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
  countLibrary: document.querySelector('#count-library'),
  playerFrame: document.querySelector('.player-frame'),
  localAudio: document.querySelector('#local-audio'),
  libraryForm: document.querySelector('#library-form'),
  libraryFolder: document.querySelector('#library-folder'),
  libraryRescan: document.querySelector('#library-rescan'),
  libraryInclude: document.querySelector('#library-include'),
  libraryStatus: document.querySelector('#library-status'),
  librarySearch: document.querySelector('#library-search'),
  libraryResults: document.querySelector('#library-results'),
  libraryEmpty: document.querySelector('#library-empty'),
  libraryPager: document.querySelector('#library-pager'),
  libraryPrev: document.querySelector('#library-prev'),
  libraryNext: document.querySelector('#library-next'),
  libraryShowing: document.querySelector('#library-showing'),
};

const TAB_STORAGE_KEY = 'blueJay.tab';

let state = { current: null, queue: [], volume: 50, paused: false, fallback: { active: false, mode: 'sequential', includeLibrary: false } };
let baseListData = { items: [], banned: [] };
let libraryStatus = { configured: false, folderName: null, status: 'none', count: 0 };
let libraryResults = { items: [], total: 0, limit: 50 };
let libraryOffset = 0;
let localPlayer = null;
let diagnostics = null;
let searchTimer = null;
let connection = 'connecting';
let socket = null;
const views = [];
let player = null;
let loadedId = null;
let appliedPaused = false;
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

function favoriteLabel(favorite) {
  return t(favorite ? 'track.unfavorite' : 'track.favorite');
}

function setFavoriteButton(button, favorite) {
  button.replaceChildren(icon('star', { filled: favorite }));
  button.classList.toggle('active', favorite);
  button.title = favoriteLabel(favorite);
  button.setAttribute('aria-label', favoriteLabel(favorite));
}

function renderNow() {
  const { current } = state;
  elements.nowTitle.textContent = current ? trackLabel(current) : t('now.empty');
  elements.next.disabled = !current;

  const pauseLabel = document.createElement('span');
  pauseLabel.textContent = t(state.paused ? 'now.resume' : 'now.pause');
  elements.pause.replaceChildren(icon(state.paused ? 'play' : 'pause'), pauseLabel);
  elements.pause.disabled = !current;

  // Aleatorio: la lista base suena en orden aleatorio; al soltarlo vuelve al orden de la lista.
  const shuffling = state.fallback.active && state.fallback.mode === 'shuffle';
  elements.nowShuffle.setAttribute('aria-pressed', String(shuffling));
  elements.nowShuffle.title = t('now.shuffle');
  elements.nowShuffle.setAttribute('aria-label', t('now.shuffle'));

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

function favoriteButton(track) {
  const button = iconButton({
    name: 'star',
    label: favoriteLabel(track.favorite),
    onClick: () => send({ type: 'favorite.set', id: track.id, favorite: !track.favorite }),
  });
  setFavoriteButton(button, track.favorite === true);
  return button;
}

function banButton(track) {
  return iconButton({
    name: 'ban',
    label: t('track.ban'),
    className: 'danger',
    onClick: () => send({ type: 'ban.add', id: track.id }),
  });
}

function durationSpan(seconds) {
  const total = Math.round(seconds);
  const span = document.createElement('span');
  span.className = 'duration';
  span.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  return span;
}

function renderQueue() {
  elements.queue.replaceChildren(...state.queue.map((track) => {
    const item = document.createElement('li');
    item.dataset.id = track.id;
    item.append(
      titleSpan(trackLabel(track)),
      favoriteButton(track),
      banButton(track),
      textButton(t('queue.remove'), 'danger', () => send({ type: 'queue.remove', id: track.id })),
    );
    return item;
  }));
  elements.queueEmpty.hidden = state.queue.length > 0;
  elements.queueClear.disabled = state.queue.length === 0;
  elements.queueSave.disabled = !state.current && state.queue.length === 0;
  elements.countQueue.textContent = state.queue.length;
}

function renderBaseList() {
  const { items, banned } = baseListData;
  const { active, mode } = state.fallback;

  elements.baseList.replaceChildren(...items.map((track) => {
    const item = document.createElement('li');
    item.append(
      titleSpan(trackLabel(track)),
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
      titleSpan(trackLabel(entry)),
      textButton(t('banned.unban'), '', () => send({ type: 'ban.remove', key: entry.key })),
    );
    return item;
  }));
  elements.bannedEmpty.hidden = banned.length > 0;

  elements.countBaseList.textContent = items.length;
  elements.countBanned.textContent = banned.length;
}

function renderLibrary() {
  const { configured, folderName, status, count } = libraryStatus;
  const statusText = {
    none: t('library.status.none'),
    scanning: t('library.status.scanning', { folder: folderName }),
    ready: `${t('library.status.ready', { folder: folderName })} ${t('library.count', { count })}`,
    error: t('library.status.error'),
  }[status];
  elements.libraryStatus.textContent = statusText;
  elements.libraryRescan.disabled = !configured;
  elements.libraryInclude.checked = state.fallback.includeLibrary;
  elements.libraryInclude.disabled = !configured;
  elements.librarySearch.disabled = !configured;
  elements.countLibrary.textContent = count;

  const { items, total, limit } = libraryResults;
  elements.libraryResults.replaceChildren(...items.map((track) => {
    const item = document.createElement('li');
    item.append(
      titleSpan(trackLabel(track)),
      ...(track.duration ? [durationSpan(track.duration)] : []),
      iconButton({
        name: 'plus',
        label: t('library.addToQueue'),
        onClick: () => send({ type: 'library.queue', id: track.id }),
      }),
      iconButton({
        name: 'listAdd',
        label: t('library.addToBaseList'),
        onClick: () => send({ type: 'library.addToBaseList', id: track.id }),
      }),
      favoriteButton(track),
      banButton(track),
    );
    return item;
  }));
  elements.libraryEmpty.hidden = !configured || items.length > 0;
  elements.libraryPager.hidden = total <= limit;
  elements.libraryPrev.disabled = libraryOffset === 0;
  elements.libraryNext.disabled = libraryOffset + limit >= total;
  elements.libraryShowing.textContent = t('library.showing', { from: libraryOffset + 1, to: libraryOffset + items.length, total });
}

function requestSearch() {
  if (libraryStatus.configured) {
    send({ type: 'library.search', query: elements.librarySearch.value.trim(), offset: libraryOffset });
  }
}

function goToLibraryPage(offset) {
  libraryOffset = Math.max(0, offset);
  requestSearch();
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

// Pausa o reanuda el reproductor que suena cuando el servidor cambia el estado de pausa.
function syncPaused() {
  if (state.paused === appliedPaused) return;

  appliedPaused = state.paused;
  const active = state.current?.source === 'local' ? localPlayer : player;
  if (state.paused) active?.pause();
  else active?.resume();
}

function syncPlayer() {
  player?.setVolume(state.volume);
  localPlayer?.setVolume(state.volume);

  const { current } = state;
  const wanted = current?.id ?? null;
  if (wanted === loadedId) {
    syncPaused();
    return;
  }

  // El reproductor de YouTube puede no estar listo todavía: start() vuelve a llamar cuando lo esté.
  const isLocal = current?.source === 'local';
  if (current && !isLocal && !player) return;
  if (isLocal && !localPlayer) return;

  loadedId = wanted;
  player?.stop();
  localPlayer?.stop();
  elements.playerFrame.hidden = isLocal;

  if (isLocal) {
    localPlayer.load(current.localId);
  } else if (current) {
    player.load(current.videoId);
  }

  // Una pista nueva empieza sonando; si el servidor la tiene en pausa (panel recién abierto), se pausa.
  appliedPaused = false;
  syncPaused();
}

// El progreso solo lo conoce el reproductor de este panel: se lo pasa al servidor para el widget de OBS.
function reportProgress() {
  if (!loadedId) return;

  const active = state.current?.source === 'local' ? localPlayer : player;
  const progress = active?.progress();
  if (!progress || !Number.isFinite(progress.position) || !Number.isFinite(progress.duration)) return;
  send({ type: 'playback.progress', id: loadedId, ...progress });
}

function handleMessage(message) {
  for (const view of views) view.handleMessage(message);

  switch (message.type) {
    case 'state':
      state = message.data;
      renderNow();
      renderQueue();
      renderBaseList();
      renderLibrary();
      renderVolume();
      syncPlayer();
      break;
    case 'baselist':
      baseListData = message.data;
      renderBaseList();
      requestSearch();
      break;
    case 'library':
      libraryStatus = message.data;
      renderLibrary();
      requestSearch();
      break;
    case 'library.results':
      // Se descartan respuestas de una búsqueda o una página anterior a la que se mira ahora.
      if (message.query !== elements.librarySearch.value.trim() || message.offset !== libraryOffset) break;
      // Si la lista se encogió (reescaneo, veto) y esta página ya no existe, se vuelve a la última.
      if (message.items.length === 0 && message.total > 0) {
        goToLibraryPage(Math.floor((message.total - 1) / message.limit) * message.limit);
        break;
      }
      libraryResults = message;
      renderLibrary();
      break;
    case 'notice':
      showNotice(t(message.key, message.params));
      break;
    case 'error':
      showNotice(t(message.key), 'error');
      renderQueue();
      for (const view of views) view.render();
      break;
  }
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}/ws`);

  socket.addEventListener('open', () => {
    connection = 'open';
    renderStatus();
    diagnostics.refresh();
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
  confirmOnSecondClick(elements.baseListClear, elements.baseListClearLabel, {
    labelKey: 'baselist.clear',
    confirmKey: 'baselist.clearConfirm',
    onConfirm: () => send({ type: 'baselist.clear' }),
  });
}

function setupQueueEvents() {
  confirmOnSecondClick(elements.queueClear, elements.queueClearLabel, {
    labelKey: 'queue.clear',
    confirmKey: 'queue.clearConfirm',
    onConfirm: () => send({ type: 'queue.clear' }),
  });
  elements.queueSaveForm.addEventListener('submit', (event) => {
    event.preventDefault();
    send({ type: 'playlist.saveQueue', name: elements.queueSaveName.value.trim() });
    elements.queueSaveName.value = '';
  });
}

function setupLibraryEvents() {
  elements.libraryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    send({ type: 'library.setFolder', path: elements.libraryFolder.value.trim() });
  });
  elements.libraryRescan.addEventListener('click', () => send({ type: 'library.rescan' }));
  elements.libraryInclude.addEventListener('change', () => {
    send({ type: 'baselist.includeLibrary', enabled: elements.libraryInclude.checked });
  });
  elements.libraryPrev.addEventListener('click', () => goToLibraryPage(libraryOffset - libraryResults.limit));
  elements.libraryNext.addEventListener('click', () => goToLibraryPage(libraryOffset + libraryResults.limit));
  elements.librarySearch.addEventListener('input', () => {
    libraryOffset = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(requestSearch, SEARCH_DEBOUNCE_MS);
  });
}

// Los botones con texto llevan el icono delante; el texto va en un <span> para que i18n no lo borre.
const BUTTON_ICONS = {
  '#next': 'skipNext',
  '#now-shuffle': 'shuffle',
  '#baselist-start': 'play',
  '#baselist-shuffle': 'shuffle',
  '#baselist-stop': 'stop',
  '#baselist-clear': 'trash',
  '#queue-clear': 'trash',
  '#queue-save': 'bookmark',
  '#library-rescan': 'refresh',
};

function setupIcons() {
  for (const [selector, name] of Object.entries(BUTTON_ICONS)) {
    document.querySelector(selector).prepend(icon(name));
  }
  elements.nowBan.replaceChildren(icon('ban'));
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
    renderLibrary();
    for (const view of views) view.render();
  });

  elements.addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    send({ type: 'queue.add', url: elements.addInput.value.trim() });
    elements.addInput.value = '';
  });

  elements.next.addEventListener('click', () => send({ type: 'playback.next' }));
  elements.pause.addEventListener('click', () => send({ type: 'playback.pause', paused: !state.paused }));
  elements.nowShuffle.addEventListener('click', () => {
    const shuffling = elements.nowShuffle.getAttribute('aria-pressed') === 'true';
    send({ type: 'baselist.start', mode: shuffling ? 'sequential' : 'shuffle' });
  });
  elements.nowFavorite.addEventListener('click', () => {
    if (state.current) send({ type: 'favorite.set', id: state.current.id, favorite: !state.current.favorite });
  });
  elements.nowBan.addEventListener('click', () => {
    if (state.current) send({ type: 'ban.add', id: state.current.id });
  });

  setupBaseListEvents();
  setupQueueEvents();
  setupLibraryEvents();

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

// Pausa breve antes de pasar a la siguiente pista. Si mientras tanto cambia la pista (por ejemplo, con "siguiente"),
// el servidor ignora el aviso porque el id ya no es el de la que suena.
function reportEnded() {
  const id = loadedId;
  if (!id) return;

  setTimeout(() => send({ type: 'playback.ended', id }), NEXT_TRACK_DELAY_MS);
}

async function start() {
  await initI18n();
  diagnostics = createDiagnosticsView({ send, connectionText: () => t(CONNECTION_KEYS[connection]) });
  views.push(
    diagnostics,
    createSettingsView({ send, showNotice }),
    createHistoryView({ send }),
    createPlaylistsView({ send }),
    createMessagesView({ send }),
    createWidgetEditorView({ send, showNotice }),
  );
  setupIcons();
  setupEvents();
  setupTabs();
  setupSortable();
  renderStatus();
  renderNow();
  renderQueue();
  renderBaseList();
  renderLibrary();
  for (const view of views) view.render();
  connect();
  setInterval(reportProgress, PROGRESS_INTERVAL_MS);

  localPlayer = createLocalPlayer({
    element: elements.localAudio,
    onEnded: reportEnded,
    onUnavailable: () => {
      if (loadedId) send({ type: 'playback.unavailable', id: loadedId });
    },
    onBlocked: () => showNotice(t('errors.autoplayBlocked'), 'error'),
  });
  syncPlayer();

  try {
    player = await createPlayer({
      onEnded: reportEnded,
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
