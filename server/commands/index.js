import { findLocalMatch } from '../library/title-match.js';
import { titleWithSubtitle, trackLabel as label } from '../tracks.js';
import { parseVideoId } from '../youtube/youtube.js';

const PREFIX = '!';
const QUEUE_PREVIEW_SIZE = 10;
const TITLE_PREVIEW_LENGTH = 40;
const NOTE_PREVIEW_LENGTH = 120;
const MAX_VOLUME = 100;
const MAX_SEARCH_LENGTH = 100;
const LINK_PATTERN = /^https?:\/\//i;

function preview(title, maxLength = TITLE_PREVIEW_LENGTH) {
  return title.length > maxLength ? `${title.slice(0, maxLength - 1)}…` : title;
}

export function createCommands({
  queue,
  blacklist = null,
  library = null,
  fetchTitle,
  searchVideo = null,
  getVideoInfo = null,
  settings = null,
  history = null,
  t,
  onChange,
  onShowWidget = () => {},
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

  // Anota la petición en el historial. `track` es la pista pedida si ya se eligió una.
  function record({ message, command, input, kind }, outcome, track = null) {
    history?.logRequest({ platform: message.platform, user: message.user, command, input, kind, outcome, track });
  }

  // Rechaza la petición: la anota con su motivo y devuelve la respuesta del chat.
  function reject(request, outcome, key, params = {}) {
    record(request, outcome);
    return t(key, { user: request.message.user, ...params });
  }

  // Devuelve el motivo del rechazo si el chat no acepta peticiones o el usuario o la cola han llegado al límite.
  function checkOpen(request) {
    if (!settings) return null;

    const { chatEnabled, limits } = settings.get();
    if (!chatEnabled) return reject(request, 'disabled', 'chat.requestsDisabled');

    if (limits.user.enabled && queue.activeRequests(requesterKey(request.message)) >= limits.user.max) {
      return reject(request, 'limit_user', 'chat.limit.user', { count: limits.user.max });
    }
    if (limits.global.enabled && queue.activeRequests() >= limits.global.max) {
      return reject(request, 'limit_global', 'chat.limit.global', { count: limits.global.max });
    }
    return null;
  }

  // Añade la pista a la cola y la anota en el historial con su resultado.
  function add(request, entry, outcome = 'accepted') {
    const track = queue.add({ ...entry, requestedBy: requesterKey(request.message) });
    record(request, outcome, track);
    onChange();
    return track;
  }

  // Añade la pista a la cola y responde con su posición.
  function enqueue(request, entry) {
    const user = request.message.user;
    const title = label(entry);
    const track = add(request, entry);

    const { current, queue: pending } = queue.snapshot();
    if (current.id === track.id) return t('chat.sr.playingNow', { user, title });
    return t('chat.sr.added', { user, title, position: pending.findIndex((item) => item.id === track.id) + 1 });
  }

  // Con la clave de YouTube, mira antes de encolar los datos del vídeo. Con el máximo de Ajustes activado,
  // rechaza los directos y los vídeos que duran más. Con `checkEmbeddable` (enlaces, no resultados de búsqueda), si existe pero no se puede
  // incrustar, lo sustituye por la pista de la biblioteca que coincida con su título o rechaza la petición.
  // Devuelve la respuesta del chat (null si ese mensaje está desactivado) o undefined si hay que seguir como
  // siempre, incluida una API caída.
  async function checkVideo(request, videoId, { checkEmbeddable }) {
    if (!getVideoInfo || !settings) return undefined;

    const { localFallback, maxDuration } = settings.get();
    const limitDuration = maxDuration.enabled;
    if (!limitDuration && !(checkEmbeddable && localFallback)) return undefined;

    let info;
    try {
      info = await getVideoInfo(videoId);
    } catch {
      return undefined;
    }
    if (!info) return undefined;

    // Un directo no tiene fin: no cabe en ninguna duración máxima.
    if (limitDuration && info.live) return reject(request, 'live', 'chat.sr.live', { title: info.title });
    if (limitDuration && info.duration > maxDuration.minutes * 60) {
      return reject(request, 'too_long', 'chat.sr.tooLong', { title: info.title, minutes: maxDuration.minutes });
    }
    if (info.embeddable || !checkEmbeddable || !localFallback) return undefined;

    const match = findLocalMatch({ library, title: info.title, exclude: (track) => blacklist?.has(track) ?? false });
    if (!match) return reject(request, 'unavailable', 'chat.sr.unavailable', { title: info.title });

    add(request, match, 'replaced');
    return t('chat.sr.replaced', { user: request.message.user, original: info.title, title: label(match) });
  }

  async function sr(message, args) {
    const user = message.user;
    if (!args) return t('chat.sr.usage', { user });

    let videoId = parseVideoId(args);
    const isLink = videoId !== null || LINK_PATTERN.test(args);
    const request = { message, command: 'sr', input: args, kind: isLink ? 'link' : 'search' };

    const closed = checkOpen(request);
    if (closed) return closed;

    if (!videoId) {
      if (isLink) return reject(request, 'invalid_url', 'chat.sr.invalid');

      // La biblioteca local tiene prioridad: solo se pregunta a YouTube si no hay coincidencia.
      const local = findLocal(args);
      if (local) return enqueue(request, local);

      if (!searchVideo) return reject(request, 'search_disabled', 'chat.sr.searchDisabled');

      const query = args.slice(0, MAX_SEARCH_LENGTH);
      try {
        videoId = await searchVideo(query);
      } catch {
        return reject(request, 'search_failed', 'chat.sr.searchFailed');
      }
      if (!videoId) return reject(request, 'not_found', 'chat.sr.notFound', { query });
    }

    if (blacklist?.has({ videoId })) return reject(request, 'banned', 'chat.sr.banned');

    const reply = await checkVideo(request, videoId, { checkEmbeddable: isLink });
    if (reply !== undefined) return reply;

    const title = (await fetchTitle(videoId)) ?? videoId;
    return enqueue(request, { videoId, title });
  }

  // Pide una pista solo de la biblioteca local, buscando por título, artista, álbum, comentario o descripción.
  function local(message, args) {
    const user = message.user;
    if (!args) return t('chat.local.usage', { user });

    const request = { message, command: 'local', input: args, kind: 'local' };
    const closed = checkOpen(request);
    if (closed) return closed;

    if (!library || library.status().count === 0) return reject(request, 'library_disabled', 'chat.local.disabled');

    const found = findLocal(args);
    if (!found) return reject(request, 'not_found', 'chat.local.notFound', { query: args.slice(0, MAX_SEARCH_LENGTH) });
    return enqueue(request, found);
  }

  // Información de la canción que suena. En las pistas locales añade las etiquetas del archivo.
  function song() {
    const { current } = queue.snapshot();
    onShowWidget();
    if (!current) return t('chat.song.none');

    const tags = current.source === 'local' ? library?.tags(current.localId) : null;
    const note = tags?.notes[0];
    const details = [
      current.artist && t('chat.song.artist', { artist: current.artist }),
      tags?.album && t('chat.song.album', { album: tags.album }),
      note && t('chat.song.note', { note: preview(note, NOTE_PREVIEW_LENGTH) }),
    ].filter(Boolean);

    const title = titleWithSubtitle(current.title, tags?.subtitle);
    if (details.length === 0) return t('chat.song.playing', { title });
    return t('chat.song.details', { title, details: details.join(' · ') });
  }

  function showQueue() {
    onShowWidget();
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
    song,
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
