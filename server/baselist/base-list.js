import { randomUUID } from 'node:crypto';
import { createJsonFile } from '../storage/json-file.js';
import { parseEntry, toEntry, trackKey } from '../tracks.js';

export const MAX_ITEMS = 2000;
export const MODES = ['sequential', 'shuffle'];

// Lista base única: se reproduce cuando la cola de peticiones queda vacía.
// Puede mezclar pistas de YouTube y de la carpeta local, y opcionalmente toda la biblioteca.
export class BaseList {
  #file;
  #library;
  #isBanned;
  #items = [];
  #active = false;
  #mode = 'sequential';
  #includeLibrary = false;
  #order = [];
  #lastPlayedKey = null;

  // `library` ofrece all() y find(id); `isBanned(key)` descarta pistas vetadas de la biblioteca.
  constructor({ path = null, log, library = null, isBanned = () => false } = {}) {
    this.#file = createJsonFile(path, { log });
    this.#library = library;
    this.#isBanned = isBanned;
  }

  async load() {
    const stored = await this.#file.read([]);
    if (!Array.isArray(stored)) return;

    for (const raw of stored) {
      const entry = parseEntry(raw);
      if (!entry || this.#items.some((item) => trackKey(item) === trackKey(entry))) continue;

      this.#items.push({ id: randomUUID(), ...entry, favorite: raw.favorite === true });
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

  isFavorite(key) {
    return this.#items.some((item) => trackKey(item) === key && item.favorite);
  }

  // Devuelve cuántas pistas se añadieron de verdad (sin duplicados y hasta el límite).
  addMany(entries) {
    let added = 0;
    for (const entry of entries) {
      if (this.#items.length >= MAX_ITEMS) break;
      if (this.#findByKey(trackKey(entry))) continue;

      this.#insert({ ...toEntry(entry), favorite: false });
      added += 1;
    }
    if (added > 0) this.#save();
    return added;
  }

  isFull() {
    return this.#items.length >= MAX_ITEMS;
  }

  // Marca o desmarca un favorito. Si la pista no está en la lista base y se marca, entra en ella.
  setFavorite(track, favorite) {
    const existing = this.#findByKey(trackKey(track));
    if (existing) {
      if (existing.favorite === favorite) return true;
      existing.favorite = favorite;
    } else if (favorite) {
      if (this.isFull()) return false;
      this.#insert({ ...toEntry(track), favorite: true });
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

  removeByKey(key) {
    const index = this.#items.findIndex((item) => trackKey(item) === key);
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
    this.#lastPlayedKey = null;
  }

  stop() {
    this.#active = false;
    this.#order = [];
  }

  setIncludeLibrary(enabled) {
    this.#includeLibrary = enabled;
    this.#order = [];
  }

  status() {
    return { active: this.#active, mode: this.#mode, includeLibrary: this.#includeLibrary };
  }

  // Siguiente pista de la lista base, o null si está parada o no hay nada que poner.
  next() {
    if (!this.#active) return null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      while (this.#order.length > 0) {
        const key = this.#order.shift();
        const entry = this.#resolve(key);
        if (!entry) continue;

        this.#lastPlayedKey = key;
        return entry;
      }
      this.#order = this.#buildOrder();
      if (this.#order.length === 0) return null;
    }
    return null;
  }

  flush() {
    return this.#file.flush();
  }

  #findByKey(key) {
    return this.#items.find((item) => trackKey(item) === key) ?? null;
  }

  #insert(entry) {
    const item = { id: randomUUID(), ...entry };
    this.#items.push(item);
    this.#order.push(trackKey(item));
  }

  // Pista reproducible para una clave, o null si ya no existe, está vetada o su archivo no está en la biblioteca.
  #resolve(key) {
    if (this.#isBanned(key)) return null;

    const item = this.#findByKey(key);
    if (item?.source === 'local') {
      const track = this.#library?.find(item.localId);
      return track ? toEntry(track) : null;
    }
    if (item) return toEntry(item);

    if (this.#includeLibrary && key.startsWith('local:')) {
      const track = this.#library?.find(key.slice('local:'.length));
      return track ? toEntry(track) : null;
    }
    return null;
  }

  #buildOrder() {
    const keys = this.list().map(trackKey);

    if (this.#includeLibrary && this.#library) {
      const seen = new Set(keys);
      for (const track of this.#library.all()) {
        const key = trackKey(track);
        if (!seen.has(key)) keys.push(key);
      }
    }
    if (this.#mode === 'sequential') return keys;

    for (let i = keys.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    // Evita repetir la última canción al empezar un ciclo nuevo.
    if (keys.length > 1 && keys[0] === this.#lastPlayedKey) [keys[0], keys[1]] = [keys[1], keys[0]];
    return keys;
  }

  #save() {
    this.#file.write(this.#items.map((item) => ({ ...toEntry(item), favorite: item.favorite })));
  }
}
