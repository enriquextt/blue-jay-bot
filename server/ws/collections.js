import { KINDS, OUTCOMES } from '../history/history.js';
import { LOCALES } from '../i18n/index.js';

const MAX_USER_FILTER_LENGTH = 50;
const MAX_NAME_LENGTH = 200;

const isCount = (value) => Number.isInteger(value) && value >= 0;
const isRowId = (value) => Number.isInteger(value) && value > 0;
const isOptionalCount = (value) => value === undefined || value === null || isCount(value);

// Comandos del WebSocket sobre los datos guardados en SQLite: historial, listas de reproducción y ajustes.
// Devuelve un objeto `{ tipo: (socket, comando) => … }`; el canal lo consulta antes de su propio `switch`.
export function createCollectionCommands({
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
}) {
  // Añade una pista guardada a la cola. Devuelve la clave del error, o null si entró.
  function queueEntry(entry) {
    if (blacklist.has(entry)) return 'errors.trackBanned';
    // Una pista local guardada puede haber desaparecido de la carpeta.
    if (entry.source === 'local' && !library.find(entry.localId)) return 'errors.trackNotFound';

    queue.add(entry);
    return null;
  }

  // Añade las pistas a una lista y avisa del resultado a todos los paneles.
  function saveToPlaylist(socket, id, tracks) {
    const added = playlists.addTracks(id, tracks);
    if (added === null) return sendError(socket, 'errors.playlistNotFound');

    const { name } = playlists.get(id);
    return notice(added > 0 ? 'notices.savedToPlaylist' : 'notices.alreadyInPlaylist', { name, added });
  }

  // Valida los filtros del historial; devuelve null si algo no es válido.
  function parseQuery(command) {
    const { kind, user = '', outcome = null, from = null, to = null, offset = 0, limit = 50 } = command;
    const valid = KINDS.includes(kind)
      && typeof user === 'string' && user.length <= MAX_USER_FILTER_LENGTH
      && (outcome === null || OUTCOMES.includes(outcome))
      && [from, to, offset, limit].every(isOptionalCount);
    return valid ? { kind, filters: { user: user.trim(), outcome, from, to, offset, limit } } : null;
  }

  return {
    'queue.clear': () => {
      queue.clear();
      return broadcastState();
    },

    'settings.update': (socket, command) => {
      if (!settings.update(command)) sendError(socket, 'errors.invalidMessage');
    },

    // `leaf` es la clave de la forma que se edita (por ejemplo `chat.when.position_one`). Un texto vacío vuelve al original.
    'message.setText': (socket, command) => {
      if (!LOCALES.includes(command.locale) || typeof command.leaf !== 'string' || typeof command.text !== 'string') {
        return sendError(socket, 'errors.invalidMessage');
      }
      if (!messages.setText(command.locale, command.leaf, command.text)) sendError(socket, 'errors.messageInvalid');
    },

    'message.setEnabled': (socket, command) => {
      if (!messages.setEnabled(command.key, command.enabled)) sendError(socket, 'errors.invalidMessage');
    },

    'message.reset': (socket, command) => {
      if (!messages.reset(command.key)) sendError(socket, 'errors.invalidMessage');
    },

    'history.query': (socket, command) => {
      const query = parseQuery(command);
      if (!query) return sendError(socket, 'errors.invalidMessage');

      const { total, items } = history.query(query.kind, query.filters);
      return send(socket, { type: 'history.results', kind: query.kind, seq: command.seq ?? null, total, items });
    },

    'history.delete': (socket, command) => {
      if (!KINDS.includes(command.kind) || !isRowId(command.id)) return sendError(socket, 'errors.invalidMessage');
      if (!history.delete(command.kind, command.id)) sendError(socket, 'errors.trackNotFound');
    },

    'history.clear': (socket, command) => {
      if (!KINDS.includes(command.kind)) return sendError(socket, 'errors.invalidMessage');
      history.clear(command.kind);
    },

    'history.queue': (socket, command) => {
      if (!KINDS.includes(command.kind) || !isRowId(command.id)) return sendError(socket, 'errors.invalidMessage');

      const entry = history.trackOf(command.kind, command.id);
      if (!entry) return sendError(socket, 'errors.trackNotFound');

      const error = queueEntry(entry);
      return error ? sendError(socket, error) : broadcastState();
    },

    'playlist.create': (socket, command) => {
      const id = playlists.create(command.name);
      if (id === null) return sendError(socket, 'errors.playlistInvalid');
      return send(socket, { type: 'playlist.created', id });
    },

    'playlist.rename': (socket, command) => {
      if (!isRowId(command.id) || typeof command.name !== 'string' || command.name.length > MAX_NAME_LENGTH) {
        return sendError(socket, 'errors.invalidMessage');
      }
      if (!playlists.rename(command.id, command.name)) sendError(socket, 'errors.playlistInvalid');
    },

    'playlist.remove': (socket, command) => {
      if (!isRowId(command.id)) return sendError(socket, 'errors.invalidMessage');
      if (!playlists.remove(command.id)) sendError(socket, 'errors.playlistNotFound');
    },

    'playlist.open': (socket, command) => {
      if (!isRowId(command.id)) return sendError(socket, 'errors.invalidMessage');

      const playlist = playlists.get(command.id);
      if (!playlist) return sendError(socket, 'errors.playlistNotFound');
      return send(socket, { type: 'playlist', data: playlist });
    },

    // Guarda la canción actual, de la cola, de la lista base o de la biblioteca (por su `id` de panel).
    'playlist.addTrack': (socket, command) => {
      if (!isRowId(command.id) || typeof command.trackId !== 'string') return sendError(socket, 'errors.invalidMessage');

      const track = findTrack(command.trackId);
      if (!track) return sendError(socket, 'errors.trackNotFound');
      return saveToPlaylist(socket, command.id, [track]);
    },

    'playlist.addFromHistory': (socket, command) => {
      if (!isRowId(command.id) || !KINDS.includes(command.kind) || !isRowId(command.itemId)) {
        return sendError(socket, 'errors.invalidMessage');
      }

      const track = history.trackOf(command.kind, command.itemId);
      if (!track) return sendError(socket, 'errors.trackNotFound');
      return saveToPlaylist(socket, command.id, [track]);
    },

    // Guarda la canción que suena y la cola en una lista nueva.
    'playlist.saveQueue': (socket, command) => {
      const { current, queue: pending } = queue.snapshot();
      const tracks = current ? [current, ...pending] : pending;
      if (tracks.length === 0) return sendError(socket, 'errors.queueEmpty');

      const id = playlists.create(command.name);
      if (id === null) return sendError(socket, 'errors.playlistInvalid');
      return saveToPlaylist(socket, id, tracks);
    },

    'playlist.removeItem': (socket, command) => {
      if (!isRowId(command.itemId)) return sendError(socket, 'errors.invalidMessage');
      if (!playlists.removeItem(command.itemId)) sendError(socket, 'errors.trackNotFound');
    },

    'playlist.queueItem': (socket, command) => {
      if (!isRowId(command.itemId)) return sendError(socket, 'errors.invalidMessage');

      const entry = playlists.itemTrack(command.itemId);
      if (!entry) return sendError(socket, 'errors.trackNotFound');

      const error = queueEntry(entry);
      return error ? sendError(socket, error) : broadcastState();
    },

    // Añade toda la lista a la cola; se saltan las pistas vetadas o que ya no están en la biblioteca.
    'playlist.queueAll': (socket, command) => {
      if (!isRowId(command.id)) return sendError(socket, 'errors.invalidMessage');

      const playlist = playlists.get(command.id);
      if (!playlist) return sendError(socket, 'errors.playlistNotFound');

      const added = playlist.items.filter((entry) => queueEntry(entry) === null).length;
      broadcastState();
      return notice('notices.playlistQueued', { name: playlist.name, added, total: playlist.items.length });
    },
  };
}
