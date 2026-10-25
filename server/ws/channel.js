import { WebSocket } from 'ws';
import { MODES } from '../baselist/base-list.js';
import { toEntry, trackKey } from '../tracks.js';
import { parsePlaylistId, parseVideoId } from '../youtube/youtube.js';

const MAX_URL_LENGTH = 500;
const MAX_ID_LENGTH = 64;
const MAX_VOLUME = 100;
const MAX_PATH_LENGTH = 1024;
const MAX_QUERY_LENGTH = 100;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createChannel({ wss, queue, baseList, blacklist, library, getState, fetchTitle, listPlaylist = null }) {
  const clients = new Set();

  function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const socket of clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  function broadcastState() {
    broadcast({ type: 'state', data: getState() });
  }

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

  function sendError(socket, key) {
    send(socket, { type: 'error', key });
  }

  function isId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
  }

  async function handleCommand(socket, command, { isLocal }) {
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

      case 'playback.ended': {
        if (!isId(command.id)) return sendError(socket, 'errors.invalidMessage');
        if (queue.finish(command.id)) broadcastState();
        return;
      }

      case 'playback.unavailable': {
        if (!isId(command.id)) return sendError(socket, 'errors.invalidMessage');

        const { current } = queue.snapshot();
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
    const isLocal = LOOPBACK_ADDRESSES.has(request.socket.remoteAddress);
    clients.add(socket);
    send(socket, { type: 'state', data: getState() });
    send(socket, baseListMessage());
    send(socket, libraryMessage());

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

  return { broadcastState };
}
