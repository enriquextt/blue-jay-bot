// Utilidades compartidas por las herramientas de etiquetas ID3 de tools/.
import { readFile } from 'fs/promises';
import { basename, extname, resolve, sep } from 'path';
import NodeID3 from 'node-id3';

// Campos que el mapeo puede definir. title/artist/album/subtitle son texto plano;
// comment y description son los títulos alternos (ver mapping-enrevision.json).
export const FIELDS = ['title', 'artist', 'album', 'subtitle', 'comment', 'description'];

// Lee las etiquetas de un archivo y las devuelve en la forma que usa el mapeo.
export function readTags(file) {
  const t = NodeID3.read(file) || {};
  return {
    title: t.title,
    artist: t.artist,
    album: t.album,
    year: t.year || t.recordingTime,
    track: t.trackNumber,
    subtitle: t.subtitle,
    comment: typeof t.comment === 'object' ? t.comment?.text : t.comment,
    description: t.userDefinedText?.find(u => u.description === 'DESCRIPTION')?.value,
  };
}

// Convierte una entrada del mapeo en el objeto que espera NodeID3.update.
// Solo incluye los campos definidos, para no tocar el resto de frames.
// Un valor `null` borra el frame (node-id3 elimina los frames con texto vacío).
export function buildTags(entry) {
  const tags = {};
  for (const key of ['title', 'artist', 'album', 'subtitle']) {
    if (entry[key] === null) tags[key] = '';
    else if (entry[key]) tags[key] = entry[key];
  }
  if (entry.comment === null) tags.comment = { language: 'eng', text: '' };
  else if (entry.comment) tags.comment = { language: 'eng', text: entry.comment };
  if (entry.description) {
    // node-id3 usa `value` (no `text`) dentro de userDefinedText.
    tags.userDefinedText = [{ description: 'DESCRIPTION', value: entry.description }];
  }
  return tags;
}

// Valida que el nombre sea un .mp3 plano dentro de `dir` (la carpeta de música no es confiable).
export function resolveMp3(dir, filename) {
  if (basename(filename) !== filename || extname(filename).toLowerCase() !== '.mp3') {
    throw new Error(`Nombre de archivo no válido: ${filename}`);
  }
  const root = resolve(dir);
  const file = resolve(root, filename);
  if (!file.startsWith(root + sep)) {
    throw new Error(`Ruta fuera de la carpeta: ${filename}`);
  }
  return file;
}

export async function loadMapping(path) {
  const mapping = JSON.parse(await readFile(path, 'utf8'));
  for (const [filename, entry] of Object.entries(mapping)) {
    for (const key of Object.keys(entry)) {
      if (!FIELDS.includes(key)) throw new Error(`Campo desconocido "${key}" en ${filename}`);
    }
  }
  return mapping;
}
