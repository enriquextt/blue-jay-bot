import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Archivo JSON con escritura atómica (temporal + renombrar). Sin ruta, no persiste nada.
export function createJsonFile(path, { log = () => {} } = {}) {
  let pending = Promise.resolve();

  return {
    async read(fallback) {
      if (!path) return fallback;

      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') log('storage.readFailed', error);
        return fallback;
      }
    },

    // Las escrituras se encadenan para que un guardado lento no pise a uno posterior.
    write(data) {
      if (!path) return pending;

      const json = JSON.stringify(data, null, 2);
      pending = pending
        .then(async () => {
          await mkdir(dirname(path), { recursive: true });
          const temporary = `${path}.tmp`;
          await writeFile(temporary, json);
          await rename(temporary, path);
        })
        .catch((error) => log('storage.writeFailed', error));
      return pending;
    },

    flush() {
      return pending;
    },
  };
}
