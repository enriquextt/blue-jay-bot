export const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
export const LOCAL_ID_PATTERN = /^[a-f0-9]{24}$/;
export const TITLE_MAX_LENGTH = 200;

// Clave que identifica una pista aunque cambie su id interno: la comparten la cola,
// la lista base y la lista negra. Sin `source` se asume YouTube.
export function trackKey(track) {
  return track.source === 'local' ? `local:${track.localId}` : `youtube:${track.videoId}`;
}

// Campos que identifican y describen una pista, sin los datos propios de la cola.
export function toEntry(track) {
  if (track.source === 'local') {
    return { source: 'local', localId: track.localId, title: track.title, artist: track.artist ?? null };
  }
  return { source: 'youtube', videoId: track.videoId, title: track.title };
}

// Valida una entrada leída de disco. Devuelve la entrada normalizada o null.
export function parseEntry(raw) {
  if (typeof raw?.title !== 'string') return null;

  const title = raw.title.slice(0, TITLE_MAX_LENGTH);
  if (raw.source === 'local') {
    if (!LOCAL_ID_PATTERN.test(raw.localId)) return null;
    const artist = typeof raw.artist === 'string' ? raw.artist.slice(0, TITLE_MAX_LENGTH) : null;
    return { source: 'local', localId: raw.localId, title, artist };
  }

  if (!VIDEO_ID_PATTERN.test(raw.videoId)) return null;
  return { source: 'youtube', videoId: raw.videoId, title };
}
