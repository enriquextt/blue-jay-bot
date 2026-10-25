const MAX_QUERY_LENGTH = 100;
const MIN_QUERY_LENGTH = 3;
const NOISE_WORDS = /\b(official|oficial|video|vídeo|videoclip|music|audio|lyrics?|letra|visuali[sz]er|clip|hd|hq|4k|remaster(?:ed)?|live|en vivo|mv)\b/i;
const BRACKETED = /[([{][^)\]}]*[)\]}]/g;
const FEATURING = /\s*[([]?\b(?:feat\.?|ft\.?|featuring)\b.*$/i;

const plain = (text) => text.replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();

// Frases de búsqueda a partir del título de un vídeo de YouTube: se quita lo que no es del nombre de la
// canción ("(Official Video)", "[HD]", "| Canal", "- Topic") y se ofrece una variante sin "feat. …".
// La primera es la más completa, así que es la más exigente.
export function searchQueries(title) {
  let text = String(title ?? '')
    .replace(BRACKETED, (group) => (NOISE_WORDS.test(group) ? ' ' : group))
    .replace(/\s+[|•·]\s+.*$/, '')
    .replace(/\s+-\s+topic$/i, '')
    .replace(/\s*(?:[-–—]\s*)?\b(?:official|oficial)\b.*$/i, '')
    .replace(/\s*[-–—]\s*(?:lyrics?|letra|audio|video|vídeo)\b.*$/i, '');
  text = text.trim();

  const variants = [plain(text), plain(text.replace(FEATURING, ''))];
  return [...new Set(variants)].filter((query) => query.length >= MIN_QUERY_LENGTH);
}

// Mejor pista de la biblioteca para el título de un vídeo, o null. Usa la búsqueda estricta de `!sr`: un
// título corto necesita que coincida también el artista o el álbum, así que ante la duda no sustituye nada.
export function findLocalMatch({ library, title, exclude = () => false }) {
  if (!library || library.status().count === 0) return null;

  for (const query of searchQueries(title)) {
    const { items } = library.search(query.slice(0, MAX_QUERY_LENGTH), { limit: 1, strict: true, exclude });
    if (items[0]) return items[0];
  }
  return null;
}
