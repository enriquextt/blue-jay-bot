import { WebSocket } from 'ws';
import { MODES } from '../baselist/base-list.js';
import { findLocalMatch } from '../library/title-match.js';
import { titleWithSubtitle, toEntry, trackKey, trackLabel } from '../tracks.js';
import { parsePlaylistId, parseVideoId } from '../youtube/youtube.js';
import { createCollectionCommands } from './collections.js';

const MAX_URL_LENGTH = 500;
const MAX_ID_LENGTH = 64;
const MAX_VOLUME = 100;
const MAX_PATH_LENGTH = 1024;
const MAX_QUERY_LENGTH = 100;
const MAX_SECONDS = 24 * 60 * 60;
const WIDGET_TEST_SECONDS = 8;
const WIDGET_SHOW_SECONDS = 10;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createChannel({
  wss,
  queue,
  baseList,
  blacklist,
  library,
  history,
  playlists,
  settings,
  messages,
  language,
  getState,
  fetchTitle,
  getVideoInfo = null,
  t,
  announce = () => {},
  listPlaylist = null,
  onStateChange = () => {},
}) {
  const clients = new Set();
  // Widgets de OBS (`/ws?view=widget`): solo leen el estado de reproducción, nunca mandan órdenes.
  const widgets = new Set();
  let progress = null;

  function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const socket of clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  function broadcastWidgets(message) {
    const payload = JSON.stringify(message);
    for (const socket of widgets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  // Hace visible el widget unos segundos (lo piden los comandos `!queue` y `!song`).
  function showWidget() {
    broadcastWidgets({ type: 'widget.show', data: { seconds: WIDGET_SHOW_SECONDS } });
  }

  // Lo que ve el widget de la canción actual: nada que no deba verse en directo (ni rutas ni ids internos).
  function widgetState() {
    const { current } = getState();
    if (!current) return { current: null };

    const requestedBy = current.requestedBy?.slice(current.requestedBy.indexOf(':') + 1) || null;
    // En las pistas locales el título lleva entre paréntesis el subtítulo del archivo, si lo tiene.
    const subtitle = current.source === 'local' ? library?.tags(current.localId)?.subtitle : null;
    return { current: { id: current.id, title: titleWithSubtitle(current.title, subtitle), artist: current.artist ?? null, requestedBy } };
  }

  function broadcastState() {
    const state = getState();
    broadcast({ type: 'state', data: state });
    // Al cambiar de canción el progreso anterior ya no vale.
    if (progress && progress.id !== state.current?.id) progress = null;
    broadcastWidgets({ type: 'state', data: widgetState() });
    onStateChange();
  }

  function notice(key, params) {
    broadcast({ type: 'notice', key, params });
  }

  const playlistsMessage = () => ({ type: 'playlists', data: playlists.list() });
  const settingsMessage = () => ({ type: 'settings', data: settings.get() });
  const messagesMessage = () => ({ type: 'messages', data: { language, items: messages.list() } });

  // El historial puede ser grande: solo se avisa del cambio y cada panel vuelve a pedir lo que está mirando.
  history.on('change', () => broadcast({ type: 'history.changed' }));
  playlists.on('change', () => broadcast(playlistsMessage()));
  settings.on('change', () => broadcast(settingsMessage()));
  messages.on('change', () => broadcast(messagesMessage()));

  function baseListMessage() {
    return { type: 'baselist', data: { items: baseList.list(), banned: blacklist.list() } };
  }

  function broadcastBaseList() {
    broadcast(baseListMessage());
  }

  function libraryMessage() {
    return { type: 'library', data: library.status() };
  }

  function broadcastLibrary() {
    broadcast(libraryMessage());
  }

  library.on('change', broadcastLibrary);

  function searchLibrary(socket, query) {
    const { items, total } = library.search(query, { exclude: (track) => blacklist.has(track) });
    send(socket, {
      type: 'library.results',
      query,
      total,
      items: items.map((track) => ({ ...track, id: track.localId, favorite: baseList.isFavorite(trackKey(track)) })),
    });
  }

  // Busca la pista en la cola, la canción actual, la lista base o la biblioteca local.
  function findTrack(id) {
    const track = queue.find(id) ?? baseList.find(id) ?? library.find(id);
    return track ? toEntry(track) : null;
  }

  async function addToBaseList(socket, url) {
    const playlistId = parsePlaylistId(url);
    if (playlistId) {
      if (!listPlaylist) return sendError(socket, 'errors.apiKeyMissing');

      let videos;
      try {
        videos = await listPlaylist(playlistId);
      } catch {
        return sendError(socket, 'errors.playlistFailed');
      }
      if (videos.length === 0) return sendError(socket, 'errors.playlistEmpty');

      const added = baseList.addMany(videos.filter((video) => !blacklist.has(video)));
      send(socket, { type: 'notice', key: 'notices.playlistImported', params: { added, total: videos.length } });
      return broadcastBaseList();
    }

    const videoId = parseVideoId(url);
    if (!videoId) return sendError(socket, 'errors.invalidUrl');
    if (blacklist.has({ videoId })) return sendError(socket, 'errors.trackBanned');
    if (baseList.isFull()) return sendError(socket, 'errors.baseListFull');

    const title = (await fetchTitle(videoId)) ?? videoId;
    baseList.addMany([{ videoId, title }]);
    return broadcastBaseList();
  }

  // Pista de la biblioteca que sustituye a una petición de YouTube que no se puede reproducir, o null.
  // Con la clave de YouTube se recupera el título cuando oEmbed no lo dio (suele pasar justo en esos vídeos).
  async function localReplacement(current) {
    if (current.origin !== 'request' || current.source !== 'youtube' || !settings.get().localFallback) return null;

    let title = current.title;
    if (title === current.videoId && getVideoInfo) {
      try {
        title = (await getVideoInfo(current.videoId))?.title ?? title;
      } catch {
        // Sin título no hay nada que buscar.
      }
    }
    if (title === current.videoId) return null;

    return findLocalMatch({ library, title, exclude: (track) => blacklist.has(track) });
  }

  // Pone la pista local donde sonaba la petición, y avisa en el panel y en el chat a quien la pidió.
  function replaceWithLocal(current, replacement) {
    if (!queue.replaceCurrent(current.id, replacement)) return false;

    const title = trackLabel(replacement);
    notice('notices.replacedByLocal', { title: current.title, replacement: title });

    const user = current.requestedBy?.slice(current.requestedBy.indexOf(':') + 1);
    const message = user && t('chat.sr.replaced', { user, original: current.title, title });
    if (message) announce(message);
    return true;
  }

  function sendError(socket, key) {
    send(socket, { type: 'error', key });
  }

  function isId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
  }

  // Segundos: un número finito entre 0 y un día (los directos de YouTube pueden no tener fin definido).
  function isTime(value) {
    return Number.isFinite(value) && value >= 0 && value <= MAX_SECONDS;
  }

  const collectionCommands = createCollectionCommands({
    queue,
    library,
    blacklist,
    history,
    playlists,
    settings,
    messages,
    findTrack,
    send,
    sendError,
    notice,
    broadcastState,
  });

  async function handleCommand(socket, command, { isLocal }) {
    if (typeof command?.type === 'string' && Object.hasOwn(collectionCommands, command.type)) {
      return collectionCommands[command.type](socket, command);
    }

    switch (command?.type) {
      case 'queue.add': {
        const url = command.url;
        if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return sendError(socket, 'errors.invalidUrl');

        const videoId = parseVideoId(url);
        if (!videoId) return sendError(socket, 'errors.invalidUrl');

        if (blacklist.has({ videoId })) return sendError(socket, 'errors.trackBanned');

        const title = (await fetchTitle(videoId)) ?? videoId;
        queue.add({ videoId, title });
        return broadcastState();
      }

      case 'queue.remove': {
        if (!isId(command.id) || !queue.remove(command.id)) return sendError(socket, 'errors.trackNotFound');
        return broadcastState();
      }

      case 'queue.move': {
        if (!isId(command.id) || !Number.isInteger(command.toIndex)) return sendError(socket, 'errors.invalidMessage');
        if (!queue.move(command.id, command.toIndex)) return sendError(socket, 'errors.trackNotFound');
        return broadcastState();
      }

      case 'playback.next': {
        queue.advance();
        return broadcastState();
      }

      case 'playback.volume': {
        if (!Number.isInteger(command.volume) || command.volume < 0 || command.volume > MAX_VOLUME) {
          return sendError(socket, 'errors.invalidMessage');
        }
        queue.setVolume(command.volume);
        return broadcastState();
      }

      case 'playback.progress': {
        const { id, position, duration, paused } = command;
        if (!isId(id) || !isTime(position) || !isTime(duration) || typeof paused !== 'boolean') {
          return sendError(socket, 'errors.invalidMessage');
        }

        // Solo vale el progreso de la canción que suena: un panel atrasado no pisa al otro.
        if (queue.snapshot().current?.id !== id) return;
        progress = { id, position: Math.min(position, duration), duration, paused };
        return broadcastWidgets({ type: 'progress', data: progress });
      }

      case 'widget.test': {
        // Tarjeta de prueba: solo la ve el widget y no toca la cola ni el historial.
        return broadcastWidgets({ type: 'widget.test', data: { duration: WIDGET_TEST_SECONDS } });
      }

      case 'playback.ended': {
        if (!isId(command.id)) return sendError(socket, 'errors.invalidMessage');
        if (queue.finish(command.id)) broadcastState();
        return;
      }

      case 'playback.unavailable': {
        if (!isId(command.id)) return sendError(socket, 'errors.invalidMessage');

        const { current } = queue.snapshot();
        if (current?.id === command.id) {
          const replacement = await localReplacement(current);
          if (replacement && replaceWithLocal(current, replacement)) return broadcastState();
        }
        if (!queue.finish(command.id)) return;

        // Un vídeo de la lista base que no se puede reproducir se retira para no volver a intentarlo.
        // Los archivos locales se conservan: pueden fallar por un problema pasajero del disco.
        if (current.origin === 'base' && current.source === 'youtube' && baseList.removeByKey(trackKey(current))) {
          broadcastBaseList();
        }

        broadcast({ type: 'notice', key: 'notices.skippedUnavailable', params: { title: current.title } });
        return broadcastState();
      }

      case 'baselist.add': {
        const url = command.url;
        if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return sendError(socket, 'errors.invalidUrl');
        return addToBaseList(socket, url);
      }

      case 'baselist.remove': {
        if (!isId(command.id) || !baseList.remove(command.id)) return sendError(socket, 'errors.trackNotFound');
        return broadcastBaseList();
      }

      case 'baselist.clear': {
        baseList.clear();
        return broadcastBaseList();
      }

      case 'baselist.start': {
        if (!MODES.includes(command.mode)) return sendError(socket, 'errors.invalidMessage');

        baseList.start(command.mode);
        if (!queue.snapshot().current) queue.advance();
        return broadcastState();
      }

      case 'baselist.stop': {
        baseList.stop();
        return broadcastState();
      }

      case 'favorite.set': {
        if (!isId(command.id) || typeof command.favorite !== 'boolean') return sendError(socket, 'errors.invalidMessage');

        const track = findTrack(command.id);
        if (!track) return sendError(socket, 'errors.trackNotFound');
        if (!baseList.setFavorite(track, command.favorite)) return sendError(socket, 'errors.baseListFull');

        broadcastBaseList();
        return broadcastState();
      }

      case 'ban.add': {
        if (!isId(command.id)) return sendError(socket, 'errors.invalidMessage');

        const track = findTrack(command.id);
        if (!track) return sendError(socket, 'errors.trackNotFound');

        const key = trackKey(track);
        blacklist.add(track);
        baseList.removeByKey(key);
        queue.removeByKey(key);
        broadcast({ type: 'notice', key: 'notices.banned', params: { title: track.title } });
        broadcastBaseList();
        return broadcastState();
      }

      case 'ban.remove': {
        if (typeof command.key !== 'string' || !blacklist.remove(command.key)) {
          return sendError(socket, 'errors.trackNotFound');
        }
        return broadcastBaseList();
      }

      case 'baselist.includeLibrary': {
        if (typeof command.enabled !== 'boolean') return sendError(socket, 'errors.invalidMessage');

        baseList.setIncludeLibrary(command.enabled);
        if (command.enabled && baseList.status().active && !queue.snapshot().current) queue.advance();
        return broadcastState();
      }

      case 'library.setFolder': {
        // La ruta de la carpeta solo la puede cambiar quien esté en el equipo del servidor.
        if (!isLocal) return sendError(socket, 'errors.localOnly');
        if (typeof command.path !== 'string' || command.path.length > MAX_PATH_LENGTH) {
          return sendError(socket, 'errors.invalidMessage');
        }

        try {
          await library.setFolder(command.path);
        } catch {
          return sendError(socket, 'errors.folderInvalid');
        }
        return;
      }

      case 'library.rescan': {
        library.scan();
        return;
      }

      case 'library.search': {
        if (typeof command.query !== 'string' || command.query.length > MAX_QUERY_LENGTH) {
          return sendError(socket, 'errors.invalidMessage');
        }
        return searchLibrary(socket, command.query);
      }

      case 'library.addToBaseList': {
        if (!isId(command.id)) return sendError(socket, 'errors.invalidMessage');

        const track = library.find(command.id);
        if (!track) return sendError(socket, 'errors.trackNotFound');
        if (blacklist.has(track)) return sendError(socket, 'errors.trackBanned');
        if (baseList.isFull()) return sendError(socket, 'errors.baseListFull');

        baseList.addMany([track]);
        return broadcastBaseList();
      }

      case 'library.queue': {
        if (!isId(command.id)) return sendError(socket, 'errors.invalidMessage');

        const track = library.find(command.id);
        if (!track) return sendError(socket, 'errors.trackNotFound');
        if (blacklist.has(track)) return sendError(socket, 'errors.trackBanned');

        queue.add(track);
        return broadcastState();
      }

      default:
        return sendError(socket, 'errors.invalidMessage');
    }
  }

  wss.on('connection', (socket, request) => {
    if (new URL(request.url, 'http://localhost').searchParams.get('view') === 'widget') {
      widgets.add(socket);
      send(socket, { type: 'state', data: widgetState() });
      if (progress) send(socket, { type: 'progress', data: progress });
      socket.on('close', () => widgets.delete(socket));
      return;
    }

    const isLocal = LOOPBACK_ADDRESSES.has(request.socket.remoteAddress);
    clients.add(socket);
    send(socket, { type: 'state', data: getState() });
    send(socket, baseListMessage());
    send(socket, libraryMessage());
    send(socket, playlistsMessage());
    send(socket, settingsMessage());
    send(socket, messagesMessage());
    send(socket, { type: 'history.changed' });

    socket.on('message', (raw) => {
      let command;
      try {
        command = JSON.parse(raw.toString());
      } catch {
        return sendError(socket, 'errors.invalidMessage');
      }

      handleCommand(socket, command, { isLocal }).catch(() => sendError(socket, 'errors.serverError'));
    });

    socket.on('close', () => clients.delete(socket));
  });

  return { broadcastState, showWidget };
}
