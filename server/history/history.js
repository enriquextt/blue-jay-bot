import { EventEmitter } from 'node:events';
import { fromColumns, toColumns } from '../db/columns.js';

export const OUTCOMES = [
  'accepted',
  'replaced',
  'unavailable',
  'invalid_url',
  'not_found',
  'search_failed',
  'search_disabled',
  'library_disabled',
  'banned',
  'disabled',
  'limit_user',
  'limit_global',
];
export const KINDS = ['requests', 'plays'];

const MAX_ROWS = 10000;
const MAX_INPUT_LENGTH = 200;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

// Cada historial: tabla, columna de fecha y columna con el usuario por el que se filtra.
const TABLES = {
  requests: { table: 'request_history', dateColumn: 'created_at', userColumn: 'user' },
  plays: { table: 'play_history', dateColumn: 'played_at', userColumn: 'requested_by' },
};

// Dos historiales en SQLite: las peticiones que llegan del chat (con su resultado, incluidos los enlaces
// no válidos y los rechazos) y las canciones que han llegado a sonar. Cada uno guarda como máximo MAX_ROWS filas.
export class History extends EventEmitter {
  #db;
  #now;
  #insertRequest;
  #insertPlay;

  constructor({ db, now = Date.now }) {
    super();
    this.#db = db;
    this.#now = now;
    this.#insertRequest = db.prepare(`
      INSERT INTO request_history (created_at, platform, user, command, input, kind, outcome, source, video_id, local_id, title, artist)
      VALUES (@created_at, @platform, @user, @command, @input, @kind, @outcome, @source, @video_id, @local_id, @title, @artist)
    `);
    this.#insertPlay = db.prepare(`
      INSERT INTO play_history (played_at, origin, requested_by, source, video_id, local_id, title, artist)
      VALUES (@played_at, @origin, @requested_by, @source, @video_id, @local_id, @title, @artist)
    `);
  }

  // `track` es la pista pedida (null si la petición se rechazó antes de elegir una).
  logRequest({ platform, user, command, input, kind, outcome, track = null }) {
    this.#insertRequest.run({
      created_at: this.#now(),
      platform,
      user,
      command,
      input: String(input).slice(0, MAX_INPUT_LENGTH),
      kind,
      outcome,
      ...(track ? toColumns(track) : { source: null, video_id: null, local_id: null, title: null, artist: null }),
    });
    this.#trim('requests');
    this.emit('change');
  }

  logPlay(track) {
    this.#insertPlay.run({
      played_at: this.#now(),
      origin: track.origin ?? 'request',
      requested_by: track.requestedBy ?? null,
      ...toColumns(track),
    });
    this.#trim('plays');
    this.emit('change');
  }

  // Filtros opcionales: `user` (texto contenido en el usuario), `outcome` (solo peticiones) y `from` / `to`
  // (milisegundos, ambos incluidos). Devuelve las más recientes primero y el total que cumple los filtros.
  query(kind, { user = '', outcome = null, from = null, to = null, offset = 0, limit = DEFAULT_LIMIT } = {}) {
    const { table, dateColumn, userColumn } = TABLES[kind];
    const conditions = [];
    const params = [];

    if (user) {
      conditions.push(`instr(lower(${userColumn}), ?) > 0`);
      params.push(user.toLowerCase());
    }
    if (outcome && kind === 'requests') {
      conditions.push('outcome = ?');
      params.push(outcome);
    }
    if (from !== null) {
      conditions.push(`${dateColumn} >= ?`);
      params.push(from);
    }
    if (to !== null) {
      conditions.push(`${dateColumn} <= ?`);
      params.push(to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { total } = this.#db.prepare(`SELECT count(*) AS total FROM ${table} ${where}`).get(...params);
    const rows = this.#db
      .prepare(`SELECT * FROM ${table} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, Math.min(Math.max(limit, 1), MAX_LIMIT), Math.max(offset, 0));

    return { total, items: rows.map(kind === 'requests' ? this.#requestItem : this.#playItem) };
  }

  // Pista de una fila del historial, o null si no existe o no tiene pista.
  trackOf(kind, id) {
    const row = this.#db.prepare(`SELECT * FROM ${TABLES[kind].table} WHERE id = ?`).get(id);
    return row ? fromColumns(row) : null;
  }

  delete(kind, id) {
    const { changes } = this.#db.prepare(`DELETE FROM ${TABLES[kind].table} WHERE id = ?`).run(id);
    if (changes > 0) this.emit('change');
    return changes > 0;
  }

  clear(kind) {
    this.#db.prepare(`DELETE FROM ${TABLES[kind].table}`).run();
    this.emit('change');
  }

  #requestItem = (row) => ({
    id: row.id,
    createdAt: row.created_at,
    platform: row.platform,
    user: row.user,
    command: row.command,
    input: row.input,
    kind: row.kind,
    outcome: row.outcome,
    track: fromColumns(row),
  });

  #playItem = (row) => ({
    id: row.id,
    playedAt: row.played_at,
    origin: row.origin,
    requestedBy: row.requested_by,
    track: fromColumns(row),
  });

  #trim(kind) {
    const { table } = TABLES[kind];
    this.#db
      .prepare(`DELETE FROM ${table} WHERE id <= (SELECT max(id) FROM ${table}) - ?`)
      .run(MAX_ROWS);
  }
}
