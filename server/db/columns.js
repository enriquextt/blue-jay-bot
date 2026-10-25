import { parseEntry, toEntry } from '../tracks.js';

// Una pista (ver `toEntry`) como columnas de las tablas de historial y listas, y de vuelta.
export function toColumns(track) {
  const entry = toEntry(track);
  return {
    source: entry.source,
    video_id: entry.videoId ?? null,
    local_id: entry.localId ?? null,
    title: entry.title,
    artist: entry.artist ?? null,
  };
}

// Devuelve la entrada normalizada, o null si la fila no tiene una pista válida (por ejemplo, una petición rechazada).
export function fromColumns(row) {
  if (!row.source) return null;

  return parseEntry({
    source: row.source,
    videoId: row.video_id,
    localId: row.local_id,
    title: row.title,
    artist: row.artist,
  });
}
