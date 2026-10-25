import { createJsonFile } from '../storage/json-file.js';
import { parseEntry, toEntry, trackKey } from '../tracks.js';

export class Blacklist {
  #file;
  #entries = new Map();

  constructor({ path = null, log } = {}) {
    this.#file = createJsonFile(path, { log });
  }

  async load() {
    const stored = await this.#file.read([]);
    if (!Array.isArray(stored)) return;

    for (const raw of stored) {
      const entry = parseEntry(raw);
      if (entry) this.#entries.set(trackKey(entry), entry);
    }
  }

  has(track) {
    return this.#entries.has(trackKey(track));
  }

  hasKey(key) {
    return this.#entries.has(key);
  }

  add(track) {
    const entry = toEntry(track);
    const key = trackKey(entry);
    if (this.#entries.has(key)) return false;

    this.#entries.set(key, entry);
    this.#save();
    return true;
  }

  remove(key) {
    if (!this.#entries.delete(key)) return false;

    this.#save();
    return true;
  }

  // Cada entrada lleva su `key`, que es lo que el panel envía para quitar el veto.
  list() {
    return [...this.#entries].map(([key, entry]) => ({ key, ...entry }));
  }

  flush() {
    return this.#file.flush();
  }

  #save() {
    this.#file.write([...this.#entries.values()]);
  }
}
