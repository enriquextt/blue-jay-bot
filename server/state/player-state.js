import { MODES } from '../baselist/base-list.js';
import { parseEntry, toEntry } from '../tracks.js';

const KEY = 'player';
const MAX_QUEUE = 5000;
const ORIGINS = ['request', 'base'];

// Una pista de la cola tal como se guarda: su entrada más quien la pidió y de dónde salió.
function toSaved(track) {
  return { ...toEntry(track), origin: track.origin, requestedBy: track.requestedBy ?? null };
}

function parseSaved(raw) {
  const entry = parseEntry(raw);
  if (!entry) return null;

  return {
    ...entry,
    origin: ORIGINS.includes(raw.origin) ? raw.origin : 'request',
    requestedBy: typeof raw.requestedBy === 'string' ? raw.requestedBy : null,
  };
}

// Lo que sobrevive a un reinicio: la cola, la canción actual, el volumen y el estado de la lista base.
export class PlayerState {
  #kv;

  constructor({ kv }) {
    this.#kv = kv;
  }

  save({ current, queue, volume, fallback }) {
    this.#kv.set(KEY, {
      current: current ? toSaved(current) : null,
      queue: queue.map(toSaved),
      volume,
      fallback: { active: fallback.active, mode: fallback.mode, includeLibrary: fallback.includeLibrary },
    });
  }

  // Devuelve el estado guardado ya validado, o null si no hay nada guardado.
  load() {
    const stored = this.#kv.get(KEY);
    if (typeof stored !== 'object' || stored === null) return null;

    const queue = Array.isArray(stored.queue) ? stored.queue.slice(0, MAX_QUEUE).map(parseSaved).filter(Boolean) : [];
    const volume = Number.isInteger(stored.volume) && stored.volume >= 0 && stored.volume <= 100 ? stored.volume : null;

    return {
      current: stored.current ? parseSaved(stored.current) : null,
      queue,
      volume,
      fallback: {
        active: stored.fallback?.active === true,
        mode: MODES.includes(stored.fallback?.mode) ? stored.fallback.mode : 'sequential',
        includeLibrary: stored.fallback?.includeLibrary === true,
      },
    };
  }
}
