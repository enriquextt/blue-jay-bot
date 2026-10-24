import { randomUUID } from 'node:crypto';

const DEFAULT_VOLUME = 50;

export class PlaybackQueue {
  #items = [];
  #current = null;
  #volume = DEFAULT_VOLUME;

  add({ videoId, title, requestedBy = null }) {
    const track = { id: randomUUID(), source: 'youtube', videoId, title, requestedBy };
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

  move(id, toIndex) {
    const index = this.#items.findIndex((track) => track.id === id);
    if (index === -1) return false;

    const [track] = this.#items.splice(index, 1);
    const target = Math.min(Math.max(toIndex, 0), this.#items.length);
    this.#items.splice(target, 0, track);
    return true;
  }

  advance() {
    this.#current = this.#items.shift() ?? null;
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

  snapshot() {
    return { current: this.#current, queue: [...this.#items], volume: this.#volume };
  }
}
