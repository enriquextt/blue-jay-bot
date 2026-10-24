import { randomUUID } from 'node:crypto';
import { createJsonFile } from '../storage/json-file.js';

export const MAX_ITEMS = 2000;
export const MODES = ['sequential', 'shuffle'];

const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const TITLE_MAX_LENGTH = 200;

// Lista base única: se reproduce cuando la cola de peticiones queda vacía.
export class BaseList {
  #file;
  #items = [];
  #active = false;
  #mode = 'sequential';
  #order = [];
  #lastPlayedId = null;

  constructor({ path = null, log } = {}) {
    this.#file = createJsonFile(path, { log });
  }

  async load() {
    const stored = await this.#file.read([]);
    if (!Array.isArray(stored)) return;

    for (const entry of stored) {
      if (!VIDEO_ID_PATTERN.test(entry?.videoId) || typeof entry.title !== 'string') continue;
      if (this.#items.some((item) => item.videoId === entry.videoId)) continue;

      this.#items.push({
        id: randomUUID(),
        source: 'youtube',
        videoId: entry.videoId,
        title: entry.title.slice(0, TITLE_MAX_LENGTH),
        favorite: entry.favorite === true,
      });
    }
  }

  // Los favoritos van primero; dentro de cada grupo se conserva el orden de inserción.
  list() {
    return [
      ...this.#items.filter((item) => item.favorite),
      ...this.#items.filter((item) => !item.favorite),
    ];
  }

  find(id) {
    return this.#items.find((item) => item.id === id) ?? null;
  }

  isFavorite(videoId) {
    return this.#items.some((item) => item.videoId === videoId && item.favorite);
  }

  // Devuelve cuántas pistas se añadieron de verdad (sin duplicados y hasta el límite).
  addMany(entries) {
    let added = 0;
    for (const { videoId, title } of entries) {
      if (this.#items.length >= MAX_ITEMS) break;
      if (this.#items.some((item) => item.videoId === videoId)) continue;

      const item = { id: randomUUID(), source: 'youtube', videoId, title, favorite: false };
      this.#items.push(item);
      this.#order.push(item.id);
      added += 1;
    }
    if (added > 0) this.#save();
    return added;
  }

  isFull() {
    return this.#items.length >= MAX_ITEMS;
  }

  // Marca o desmarca un favorito. Si la canción no está en la lista base y se marca, entra en ella.
  setFavorite({ videoId, title }, favorite) {
    const existing = this.#items.find((item) => item.videoId === videoId);
    if (existing) {
      if (existing.favorite === favorite) return true;
      existing.favorite = favorite;
    } else if (favorite) {
      if (this.isFull()) return false;
      const item = { id: randomUUID(), source: 'youtube', videoId, title, favorite: true };
      this.#items.push(item);
      this.#order.push(item.id);
    } else {
      return true;
    }

    this.#save();
    return true;
  }

  remove(id) {
    const index = this.#items.findIndex((item) => item.id === id);
    if (index === -1) return false;

    this.#items.splice(index, 1);
    this.#save();
    return true;
  }

  removeByVideoId(videoId) {
    const index = this.#items.findIndex((item) => item.videoId === videoId);
    if (index === -1) return false;

    this.#items.splice(index, 1);
    this.#save();
    return true;
  }

  clear() {
    this.#items = [];
    this.#order = [];
    this.#save();
  }

  start(mode) {
    this.#mode = MODES.includes(mode) ? mode : 'sequential';
    this.#active = true;
    this.#order = [];
    this.#lastPlayedId = null;
  }

  stop() {
    this.#active = false;
    this.#order = [];
  }

  status() {
    return { active: this.#active, mode: this.#mode };
  }

  // Siguiente pista de la lista base, o null si está parada o vacía.
  next() {
    if (!this.#active) return null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      while (this.#order.length > 0) {
        const item = this.find(this.#order.shift());
        if (!item) continue;

        this.#lastPlayedId = item.id;
        return { videoId: item.videoId, title: item.title };
      }
      this.#order = this.#buildOrder();
      if (this.#order.length === 0) return null;
    }
    return null;
  }

  flush() {
    return this.#file.flush();
  }

  #buildOrder() {
    const ids = this.list().map((item) => item.id);
    if (this.#mode === 'sequential') return ids;

    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    // Evita repetir la última canción al empezar un ciclo nuevo.
    if (ids.length > 1 && ids[0] === this.#lastPlayedId) [ids[0], ids[1]] = [ids[1], ids[0]];
    return ids;
  }

  #save() {
    this.#file.write(this.#items.map(({ videoId, title, favorite }) => ({ videoId, title, favorite })));
  }
}
