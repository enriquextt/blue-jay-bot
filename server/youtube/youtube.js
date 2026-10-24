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
