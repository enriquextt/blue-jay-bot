const MAX_QUERY_LENGTH = 100;
const MIN_QUERY_LENGTH = 3;
// En la segunda pasada se tolera una palabra sin coincidencia por cada tantas de la consulta (mínimo una).
const WORDS_PER_MISSING = 4;
const NOISE_WORDS = /\b(official|oficial|video|vídeo|videoclip|music|audio|lyrics?|letra|visuali[sz]er|clip|hd|hq|amv|sub|español|4k|remaster(?:ed)?|live|en vivo|mv)\b/i;
const BRACKETED = /[([{][^)\]}]*[)\]}]/g;
const FEATURING = /\s*[([]?\b(?:feat\.?|ft\.?|featuring|amv|sub|español)\b.*$/i;

const plain = (text) => text.replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();

// Frases de búsqueda a partir del título de un vídeo de YouTube: se quita lo que no es del nombre de la
// canción ("(Official Video)", "[HD]", "- Topic"); lo que sigue a un "|" se conserva, porque `plain` solo quita el símbolo y se ofrece una variante sin "feat. …".
// La primera es la más completa, así que es la más exigente.
export function searchQueries(title) {
  let text = String(title ?? '')
    .replace(BRACKETED, (group) => (NOISE_WORDS.test(group) ? ' ' : group))
    .replace(/\s+-\s+topic$/i, '')
    .replace(/\s*(?:[-–—]\s*)?\b(?:official|oficial)\b.*$/i, '')
    .replace(/\s*[-–—]\s*(?:lyrics?|letra|audio|video|amv|sub|español|vídeo)\b.*$/i, '');
  text = text.trim();

  const variants = [plain(text), plain(text.replace(FEATURING, ''))];
  return [...new Set(variants)].filter((query) => query.length >= MIN_QUERY_LENGTH);
}

// Mejor pista de la biblioteca para el título de un vídeo, o null. Usa la búsqueda estricta de `!sr`: un
// título corto necesita que coincida también el artista o el álbum, así que ante la duda no sustituye nada.
export function findLocalMatch({ library, title, exclude = () => false }) {
  if (!library || library.status().count === 0) return null;
  // Primero se exige que coincidan todas las palabras; si ninguna variante lo logra, se toleran palabras sin
  // coincidencia (típico de un sufijo del vídeo que no es ruido conocido), una por cada 4 de la consulta.
  const queries = searchQueries(title).map((query) => query.slice(0, MAX_QUERY_LENGTH));
  for (const lenient of [false, true]) {
    for (const query of queries) {
      const allowMissing = lenient ? Math.max(1, Math.floor(query.split(' ').length / WORDS_PER_MISSING)) : 0;
      const { items } = library.search(query, { limit: 1, strict: true, allowMissing, exclude });
      if (items[0]) return items[0];
    }
  }
  return null;
}
