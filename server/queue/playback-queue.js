import { randomUUID } from 'node:crypto';

export class PlaybackQueue {
  #items = [];
  #current = null;

  add({ videoId, title }) {
    const track = { id: randomUUID(), source: 'youtube', videoId, title };
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

  snapshot() {
    return { current: this.#current, queue: [...this.#items] };
  }
}
