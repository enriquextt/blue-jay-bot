import { randomUUID } from 'node:crypto';

const DEFAULT_VOLUME = 50;

export class PlaybackQueue {
  #items = [];
  #current = null;
  #volume = DEFAULT_VOLUME;
  #fallback;

  // `fallback` devuelve { videoId, title } cuando la cola se vacía, o null si no hay nada que poner.
  constructor({ fallback = () => null } = {}) {
    this.#fallback = fallback;
  }

  add({ videoId, title, requestedBy = null }) {
    const track = { id: randomUUID(), source: 'youtube', origin: 'request', videoId, title, requestedBy };
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

  // Quita de la cola todas las apariciones del vídeo; si suena ahora, pasa a la siguiente.
  removeByVideoId(videoId) {
    let removed = 0;
    this.#items = this.#items.filter((track) => {
      if (track.videoId !== videoId) return true;
      removed += 1;
      return false;
    });

    if (this.#current?.videoId === videoId) {
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
    return this.#current;
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

    return { id: randomUUID(), source: 'youtube', origin: 'base', videoId: entry.videoId, title: entry.title, requestedBy: null };
  }

  snapshot() {
    return { current: this.#current, queue: [...this.#items], volume: this.#volume };
  }
}
