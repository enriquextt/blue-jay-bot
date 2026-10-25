import { parseVideoId } from '../youtube/youtube.js';

const PREFIX = '!';
const QUEUE_PREVIEW_SIZE = 10;
const TITLE_PREVIEW_LENGTH = 40;
const MAX_VOLUME = 100;
const MAX_SEARCH_LENGTH = 100;
const LINK_PATTERN = /^https?:\/\//i;

// Texto con el que el chat nombra una pista: las locales llevan el artista.
function label(track) {
  return track.artist ? `${track.artist} - ${track.title}` : track.title;
}

function preview(title) {
  return title.length > TITLE_PREVIEW_LENGTH ? `${title.slice(0, TITLE_PREVIEW_LENGTH - 1)}…` : title;
}

export function createCommands({
  queue,
  blacklist = null,
  library = null,
  fetchTitle,
  searchVideo = null,
  t,
  onChange,
  voteSkipThreshold = 3,
}) {
  let votes = { trackId: null, voters: new Set() };

  function requesterKey({ platform, user }) {
    return `${platform}:${user.toLowerCase()}`;
  }

  // Mejor coincidencia de la biblioteca local, o null si no hay biblioteca o nada que se parezca.
  // La búsqueda es estricta: un título o nota de menos de 10 caracteres exige que también coincida el
  // artista o el álbum, para que un texto corto del chat no acabe en la pista equivocada.
  function findLocal(query) {
    if (!library) return null;

    const { items } = library.search(query.slice(0, MAX_SEARCH_LENGTH), {
      limit: 1,
      strict: true,
      exclude: (track) => blacklist?.has(track) ?? false,
    });
    return items[0] ?? null;
  }

  // Añade la pista a la cola y responde con su posición.
  function enqueue(message, entry) {
    const user = message.user;
    const title = label(entry);
    const track = queue.add({ ...entry, requestedBy: requesterKey(message) });
    onChange();

    const { current, queue: pending } = queue.snapshot();
    if (current.id === track.id) return t('chat.sr.playingNow', { user, title });
    return t('chat.sr.added', { user, title, position: pending.findIndex((item) => item.id === track.id) + 1 });
  }

  async function sr(message, args) {
    const user = message.user;
    if (!args) return t('chat.sr.usage', { user });

    let videoId = parseVideoId(args);
    if (!videoId) {
      if (LINK_PATTERN.test(args)) return t('chat.sr.invalid', { user });

      // La biblioteca local tiene prioridad: solo se pregunta a YouTube si no hay coincidencia.
      const local = findLocal(args);
      if (local) return enqueue(message, local);

      if (!searchVideo) return t('chat.sr.searchDisabled', { user });

      const query = args.slice(0, MAX_SEARCH_LENGTH);
      try {
        videoId = await searchVideo(query);
      } catch {
        return t('chat.sr.searchFailed', { user });
      }
      if (!videoId) return t('chat.sr.notFound', { user, query });
    }

    if (blacklist?.has({ videoId })) return t('chat.sr.banned', { user });

    const title = (await fetchTitle(videoId)) ?? videoId;
    return enqueue(message, { videoId, title });
  }

  // Pide una pista solo de la biblioteca local, buscando por título, artista, álbum, comentario o descripción.
  function local(message, args) {
    const user = message.user;
    if (!args) return t('chat.local.usage', { user });
    if (!library || library.status().count === 0) return t('chat.local.disabled', { user });

    const found = findLocal(args);
    if (!found) return t('chat.local.notFound', { user, query: args.slice(0, MAX_SEARCH_LENGTH) });
    return enqueue(message, found);
  }

  function showQueue() {
    const { current, queue: pending } = queue.snapshot();
    if (!current) return t('chat.queue.empty');

    const currentTitle = preview(label(current));
    if (pending.length === 0) return t('chat.queue.onlyCurrent', { current: currentTitle });

    const next = pending
      .slice(0, QUEUE_PREVIEW_SIZE)
      .map((track, index) => `${index + 1}. ${preview(label(track))}`)
      .join(' · ');
    return t('chat.queue.summary', { current: currentTitle, next });
  }

  function when(message) {
    const key = requesterKey(message);
    const { current, queue: pending } = queue.snapshot();

    if (current?.requestedBy === key) return t('chat.when.playing', { user: message.user, title: label(current) });

    const index = pending.findIndex((track) => track.requestedBy === key);
    if (index === -1) return t('chat.when.none', { user: message.user });

    // Cuenta la canción que suena y las pendientes que van antes.
    return t('chat.when.position', { user: message.user, title: label(pending[index]), count: index + 1 });
  }

  function skip(message) {
    if (!message.isMod) return t('chat.noPermission', { user: message.user });

    const { current } = queue.snapshot();
    if (!current) return t('chat.skip.nothing');

    queue.advance();
    onChange();
    return t('chat.skip.done', { title: label(current) });
  }

  function voteSkip(message) {
    const { current } = queue.snapshot();
    if (!current) return t('chat.voteskip.nothing');

    if (votes.trackId !== current.id) votes = { trackId: current.id, voters: new Set() };

    const key = requesterKey(message);
    if (votes.voters.has(key)) return t('chat.voteskip.already', { user: message.user });
    votes.voters.add(key);

    if (votes.voters.size >= voteSkipThreshold) {
      queue.advance();
      onChange();
      return t('chat.voteskip.skipped', { needed: voteSkipThreshold, title: label(current) });
    }
    return t('chat.voteskip.voted', { user: message.user, votes: votes.voters.size, needed: voteSkipThreshold });
  }

  function wrongSong(message) {
    const track = queue.lastRequestBy(requesterKey(message));
    if (!track) return t('chat.wrongsong.none', { user: message.user });

    queue.remove(track.id);
    onChange();
    return t('chat.wrongsong.removed', { user: message.user, title: label(track) });
  }

  function volume(message, args) {
    if (!args) return t('chat.volume.current', { volume: queue.snapshot().volume });
    if (!message.isMod) return t('chat.noPermission', { user: message.user });

    const value = Number(args);
    if (!/^\d{1,3}$/.test(args) || value > MAX_VOLUME) return t('chat.volume.invalid', { user: message.user });

    queue.setVolume(value);
    onChange();
    return t('chat.volume.set', { volume: value });
  }

  const handlers = {
    sr,
    local,
    queue: showQueue,
    when,
    skip,
    voteskip: voteSkip,
    wrongsong: wrongSong,
    volume,
  };

  // Devuelve el texto de respuesta, o null si el mensaje no es un comando conocido.
  return {
    async handle(message) {
      const text = String(message.text ?? '').trim();
      if (!text.startsWith(PREFIX)) return null;

      const [name, ...rest] = text.slice(PREFIX.length).split(/\s+/);
      const handler = Object.hasOwn(handlers, name.toLowerCase()) ? handlers[name.toLowerCase()] : null;
      return handler ? handler(message, rest.join(' ')) : null;
    },
  };
}
