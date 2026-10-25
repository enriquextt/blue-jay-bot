// Pares clave-valor en JSON sobre la tabla `kv`: para ajustes y para el estado que sobrevive a un reinicio.
export function createKv(db) {
  const select = db.prepare('SELECT value FROM kv WHERE key = ?');
  const upsert = db.prepare(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );

  return {
    get(key, fallback = null) {
      const row = select.get(key);
      if (!row) return fallback;

      try {
        return JSON.parse(row.value);
      } catch {
        return fallback;
      }
    },

    set(key, value) {
      upsert.run(key, JSON.stringify(value));
    },
  };
}
