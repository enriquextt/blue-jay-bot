import { randomUUID } from 'node:crypto';
import { toEntry, trackKey } from '../tracks.js';

const DEFAULT_VOLUME = 50;

export class PlaybackQueue {
  #items = [];
  #current = null;
  #paused = false;
  #volume = DEFAULT_VOLUME;
  #fallback;
  #onPlay;

  // `fallback` devuelve la entrada de una pista (ver `toEntry`) cuando la cola se vacía, o null si no hay nada que poner.
  // `onPlay(pista)` se llama cada vez que una pista empieza a sonar.
  constructor({ fallback = () => null, onPlay = () => {} } = {}) {
    this.#fallback = fallback;
    this.#onPlay = onPlay;
  }

  // Recupera la cola guardada: pistas con su origen y quien las pidió (ver `PlayerState`). No cuenta como empezar a sonar.
  restore({ current = null, queue = [], volume = null }) {
    const revive = ({ requestedBy, origin, ...entry }) => ({ id: randomUUID(), origin, requestedBy, ...toEntry(entry) });

    this.#current = current ? revive(current) : null;
    this.#items = queue.map(revive);
    if (volume !== null) this.#volume = volume;
  }

  add({ requestedBy = null, ...entry }) {
    const track = { id: randomUUID(), origin: 'request', requestedBy, ...toEntry(entry) };
    this.#items.push(track);
    if (!this.#current) this.advance();
    return track;
  }

  remove(id) {
    if (this.#current?.id === id) {
      this.advance();
      return true;
    }

    const index = this.#items.findIndex((track) => track.id === id);
    if (index === -1) return false;

    this.#items.splice(index, 1);
    return true;
  }

  // Quita de la cola todas las apariciones de la pista; si suena ahora, pasa a la siguiente.
  removeByKey(key) {
    let removed = 0;
    this.#items = this.#items.filter((track) => {
      if (trackKey(track) !== key) return true;
      removed += 1;
      return false;
    });

    if (this.#current && trackKey(this.#current) === key) {
      this.advance();
      removed += 1;
    }
    return removed;
  }

  find(id) {
    if (this.#current?.id === id) return this.#current;
    return this.#items.find((track) => track.id === id) ?? null;
  }

  move(id, toIndex) {
    const index = this.#items.findIndex((track) => track.id === id);
    if (index === -1) return false;

    const [track] = this.#items.splice(index, 1);
    const target = Math.min(Math.max(toIndex, 0), this.#items.length);
    this.#items.splice(target, 0, track);
    return true;
  }

  advance() {
    this.#current = this.#items.shift() ?? this.#nextFromFallback();
    this.#paused = false;
    if (this.#current) this.#onPlay(this.#current);
    return this.#current;
  }

  // Pausa o reanuda la pista que suena. Devuelve false si no hay nada que pausar o el estado ya era ese.
  setPaused(paused) {
    if (!this.#current || this.#paused === paused) return false;

    this.#paused = paused;
    return true;
  }

  // Cambia la pista que suena por otra, conservando su origen y quien la pidió (por ejemplo, un vídeo que no se
  // puede reproducir por su versión local). Devuelve la pista nueva, o null si `id` ya no es la que suena.
  replaceCurrent(id, entry) {
    if (this.#current?.id !== id) return null;

    const { origin, requestedBy } = this.#current;
    this.#current = { id: randomUUID(), origin, requestedBy, ...toEntry(entry) };
    this.#paused = false;
    this.#onPlay(this.#current);
    return this.#current;
  }

  // Vacía las canciones pendientes; la que suena no se interrumpe.
  clear() {
    const cleared = this.#items.length;
    this.#items = [];
    return cleared;
  }

  // Peticiones sin sonar todavía más la que suena ahora, de un usuario o de todos. Cuentan contra los límites.
  activeRequests(requestedBy = null) {
    const active = this.#current ? [this.#current, ...this.#items] : this.#items;
    return active.filter((track) => track.origin === 'request' && (requestedBy === null || track.requestedBy === requestedBy)).length;
  }

  finish(id) {
    if (this.#current?.id !== id) return false;

    this.advance();
    return true;
  }

  lastRequestBy(requestedBy) {
    return this.#items.findLast((track) => track.requestedBy === requestedBy)
      ?? (this.#current?.requestedBy === requestedBy ? this.#current : null);
  }

  setVolume(volume) {
    this.#volume = volume;
  }

  #nextFromFallback() {
    const entry = this.#fallback();
    if (!entry) return null;

    return { id: randomUUID(), origin: 'base', requestedBy: null, ...toEntry(entry) };
  }

  snapshot() {
    return { current: this.#current, queue: [...this.#items], volume: this.#volume, paused: this.#paused };
  }
}
