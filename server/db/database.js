import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

// Cada elemento es una migración; la posición + 1 es la versión que queda en `PRAGMA user_version`.
// Nunca se edita una migración ya publicada: se añade otra al final.
const MIGRATIONS = [
  `
  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE request_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    platform TEXT NOT NULL,
    user TEXT NOT NULL,
    command TEXT NOT NULL,
    input TEXT NOT NULL,
    kind TEXT NOT NULL,
    outcome TEXT NOT NULL,
    source TEXT,
    video_id TEXT,
    local_id TEXT,
    title TEXT,
    artist TEXT
  );
  CREATE INDEX request_history_created_at ON request_history (created_at);

  CREATE TABLE play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    played_at INTEGER NOT NULL,
    origin TEXT NOT NULL,
    requested_by TEXT,
    source TEXT NOT NULL,
    video_id TEXT,
    local_id TEXT,
    title TEXT NOT NULL,
    artist TEXT
  );
  CREATE INDEX play_history_played_at ON play_history (played_at);

  CREATE TABLE playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    track_key TEXT NOT NULL,
    source TEXT NOT NULL,
    video_id TEXT,
    local_id TEXT,
    title TEXT NOT NULL,
    artist TEXT,
    UNIQUE (playlist_id, track_key)
  );
  `,
];

function migrate(db) {
  const applied = db.pragma('user_version', { simple: true });

  MIGRATIONS.slice(applied).forEach((sql, index) => {
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${applied + index + 1}`);
    })();
  });
}

// Abre (o crea) la base de datos y aplica las migraciones pendientes. Sin ruta, vive solo en memoria.
export function openDatabase(path = null) {
  if (path) mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path ?? ':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
