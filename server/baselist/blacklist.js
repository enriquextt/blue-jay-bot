import { createJsonFile } from '../storage/json-file.js';

const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

export class Blacklist {
  #file;
  #entries = new Map();

  constructor({ path = null, log } = {}) {
    this.#file = createJsonFile(path, { log });
  }

  async load() {
    const stored = await this.#file.read([]);
    if (!Array.isArray(stored)) return;

    for (const entry of stored) {
      if (VIDEO_ID_PATTERN.test(entry?.videoId) && typeof entry.title === 'string') {
        this.#entries.set(entry.videoId, { videoId: entry.videoId, title: entry.title });
      }
    }
  }

  has(videoId) {
    return this.#entries.has(videoId);
  }

  add({ videoId, title }) {
    if (this.#entries.has(videoId)) return false;

    this.#entries.set(videoId, { videoId, title });
    this.#save();
    return true;
  }

  remove(videoId) {
    if (!this.#entries.delete(videoId)) return false;

    this.#save();
    return true;
  }

  list() {
    return [...this.#entries.values()];
  }

  flush() {
    return this.#file.flush();
  }

  #save() {
    this.#file.write(this.list());
  }
}
