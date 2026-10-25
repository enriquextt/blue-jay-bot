import { EventEmitter } from 'node:events';
import { fromColumns, toColumns } from '../db/columns.js';
import { trackKey } from '../tracks.js';

export const MAX_PLAYLISTS = 100;
export const MAX_ITEMS = 2000;
export const NAME_MAX_LENGTH = 60;

// Listas de reproducción creadas por el usuario, guardadas en SQLite. Una pista no se repite dentro de una lista.
export class Playlists extends EventEmitter {
  #db;
  #now;

  constructor({ db, now = Date.now }) {
    super();
    this.#db = db;
    this.#now = now;
  }

  list() {
    return this.#db
      .prepare(`
        SELECT p.id, p.name, count(i.id) AS count
        FROM playlists p LEFT JOIN playlist_items i ON i.playlist_id = p.id
        GROUP BY p.id ORDER BY p.id
      `)
      .all();
  }

  // Nombre y pistas de una lista (cada una con el `id` que usa para quitarla), o null si no existe.
  get(id) {
    const playlist = this.#db.prepare('SELECT id, name FROM playlists WHERE id = ?').get(id);
    if (!playlist) return null;

    const rows = this.#db.prepare('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY id').all(id);
    const items = rows.flatMap((row) => {
      const entry = fromColumns(row);
      return entry ? [{ id: row.id, ...entry }] : [];
    });
    return { ...playlist, items };
  }

  // Devuelve el id de la lista nueva, o null si el nombre no es válido o ya hay demasiadas listas.
  create(name) {
    const clean = this.#cleanName(name);
    if (!clean) return null;

    const { count } = this.#db.prepare('SELECT count(*) AS count FROM playlists').get();
    if (count >= MAX_PLAYLISTS) return null;

    const { lastInsertRowid } = this.#db
      .prepare('INSERT INTO playlists (name, created_at) VALUES (?, ?)')
      .run(clean, this.#now());
    this.emit('change');
    return Number(lastInsertRowid);
  }

  rename(id, name) {
    const clean = this.#cleanName(name);
    if (!clean) return false;

    const { changes } = this.#db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(clean, id);
    if (changes > 0) this.emit('change');
    return changes > 0;
  }

  remove(id) {
    const { changes } = this.#db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    if (changes > 0) this.emit('change');
    return changes > 0;
  }

  // Añade pistas sin repetir las que ya están y hasta el límite. Devuelve cuántas entraron, o null si la lista no existe.
  addTracks(id, tracks) {
    if (!this.#db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(id)) return null;

    const insert = this.#db.prepare(`
      INSERT OR IGNORE INTO playlist_items (playlist_id, track_key, source, video_id, local_id, title, artist)
      VALUES (@playlist_id, @track_key, @source, @video_id, @local_id, @title, @artist)
    `);
    const count = this.#db.prepare('SELECT count(*) AS count FROM playlist_items WHERE playlist_id = ?');

    const add = this.#db.transaction(() => {
      let added = 0;
      for (const track of tracks) {
        if (count.get(id).count >= MAX_ITEMS) break;
        added += insert.run({ playlist_id: id, track_key: trackKey(track), ...toColumns(track) }).changes;
      }
      return added;
    });

    const added = add();
    if (added > 0) this.emit('change');
    return added;
  }

  removeItem(itemId) {
    const { changes } = this.#db.prepare('DELETE FROM playlist_items WHERE id = ?').run(itemId);
    if (changes > 0) this.emit('change');
    return changes > 0;
  }

  // Pista de una entrada de lista, o null si ya no existe.
  itemTrack(itemId) {
    const row = this.#db.prepare('SELECT * FROM playlist_items WHERE id = ?').get(itemId);
    return row ? fromColumns(row) : null;
  }

  #cleanName(name) {
    if (typeof name !== 'string') return null;

    const clean = name.trim().slice(0, NAME_MAX_LENGTH);
    return clean || null;
  }
}
