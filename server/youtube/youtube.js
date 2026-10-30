const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const SHORT_HOST = 'youtu.be';
const PATH_ID_PATTERN = /^\/(?:shorts|embed|live)\/([\w-]{11})(?:[/?]|$)/;
const TITLE_MAX_LENGTH = 200;
const TITLE_TIMEOUT_MS = 5000;

export function parseVideoId(input) {
  const text = String(input ?? '').trim();
  if (VIDEO_ID_PATTERN.test(text)) return text;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  let videoId = null;
  if (url.hostname === SHORT_HOST) {
    videoId = url.pathname.slice(1);
  } else if (WATCH_HOSTS.has(url.hostname)) {
    videoId = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : PATH_ID_PATTERN.exec(url.pathname)?.[1] ?? null;
  }

  return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

export async function fetchVideoTitle(videoId, fetchImpl = fetch) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`;

  try {
    const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(TITLE_TIMEOUT_MS) });
    if (!response.ok) return null;

    const data = await response.json();
    return typeof data.title === 'string' ? data.title.slice(0, TITLE_MAX_LENGTH) : null;
  } catch {
    return null;
  }
}

const SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';

// Devuelve el ID del primer vídeo incrustable, o null si no hay resultados.
// Lanza un error si la API falla (clave inválida, cuota agotada, red).
export async function searchVideoId(query, apiKey, fetchImpl = fetch) {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: '1',
    q: query,
    key: apiKey,
  });

  const response = await fetchImpl(`${SEARCH_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(TITLE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`youtube.search ${response.status}`);

  const data = await response.json();
  const videoId = data.items?.[0]?.id?.videoId;
  return typeof videoId === 'string' && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

const PLAYLIST_ID_PATTERN = /^[\w-]{10,64}$/;
const BARE_PLAYLIST_PATTERN = /^(?:PL|UU|FL|OL)[\w-]{10,62}$/;
const PLAYLIST_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlistItems';
const PLAYLIST_PAGE_SIZE = 50;
const PLAYLIST_MAX_PAGES = 20;
const UNAVAILABLE_TITLES = new Set(['Private video', 'Deleted video']);

// Devuelve el ID de la playlist si la entrada es una lista (URL con `list` sin vídeo concreto, o ID suelto).
// Una URL de vídeo que además lleva `list` se trata como vídeo.
export function parsePlaylistId(input) {
  const text = String(input ?? '').trim();
  if (BARE_PLAYLIST_PATTERN.test(text)) return text;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!WATCH_HOSTS.has(url.hostname)) return null;
  if (url.pathname === '/watch' && url.searchParams.has('v')) return null;

  const id = url.searchParams.get('list');
  return id && PLAYLIST_ID_PATTERN.test(id) ? id : null;
}

// Lee los vídeos de una playlist con playlistItems.list (1 unidad de cuota por página de 50).
// Descarta vídeos privados o eliminados. Lanza un error si la API falla.
export async function fetchPlaylistVideos(playlistId, apiKey, fetchImpl = fetch) {
  const videos = [];
  let pageToken = null;

  for (let page = 0; page < PLAYLIST_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      part: 'snippet',
      maxResults: String(PLAYLIST_PAGE_SIZE),
      playlistId,
      key: apiKey,
    });
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetchImpl(`${PLAYLIST_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(TITLE_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`youtube.playlist ${response.status}`);

    const data = await response.json();
    for (const item of data.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId;
      const title = item.snippet?.title;
      if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) continue;
      if (typeof title !== 'string' || UNAVAILABLE_TITLES.has(title)) continue;
      videos.push({ videoId, title: title.slice(0, TITLE_MAX_LENGTH) });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return videos;
}

const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const LIVE_STATES = new Set(['live', 'upcoming']);
const DURATION_PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

// Duración ISO 8601 de la API («PT3M33S») en segundos. Devuelve null si no es válida o es 0: los directos
// en vivo llegan como «P0D» y no tienen una duración que medir.
export function parseDuration(value) {
  const match = DURATION_PATTERN.exec(String(value ?? ''));
  if (!match) return null;

  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  const total = ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
  return total > 0 ? total : null;
}

// Título, si el vídeo se puede incrustar, su duración en segundos (null si se desconoce) y si es un directo
// (en vivo o programado), con videos.list (1 unidad de cuota). Devuelve null si el vídeo no
// existe o es privado. Lanza un error si la API falla (clave inválida, cuota agotada, red).
export async function fetchVideoInfo(videoId, apiKey, fetchImpl = fetch) {
  const params = new URLSearchParams({ part: 'snippet,status,contentDetails', id: videoId, key: apiKey });

  const response = await fetchImpl(`${VIDEOS_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(TITLE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`youtube.videos ${response.status}`);

  const item = (await response.json()).items?.[0];
  if (typeof item?.snippet?.title !== 'string') return null;

  return {
    title: item.snippet.title.slice(0, TITLE_MAX_LENGTH),
    embeddable: item.status?.embeddable !== false,
    duration: parseDuration(item.contentDetails?.duration),
    live: LIVE_STATES.has(item.snippet.liveBroadcastContent),
  };
}
