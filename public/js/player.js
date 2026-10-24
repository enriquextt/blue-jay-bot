const PLAYER_ID = 'player';
const UNAVAILABLE_ERROR_CODES = new Set([2, 5, 100, 101, 150]);

let apiReady = null;

function loadYouTubeApi() {
  if (!apiReady) {
    apiReady = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = resolve;
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.append(script);
    });
  }
  return apiReady;
}

export async function createPlayer({ onEnded, onUnavailable }) {
  await loadYouTubeApi();

  let player = null;
  const controller = {
    load(videoId) {
      player.loadVideoById(videoId);
    },
    stop() {
      player.stopVideo();
    },
  };

  return new Promise((resolve) => {
    player = new YT.Player(PLAYER_ID, {
      playerVars: { autoplay: 1, playsinline: 1 },
      events: {
        onReady: () => resolve(controller),
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.ENDED) onEnded();
        },
        onError: (event) => {
          if (UNAVAILABLE_ERROR_CODES.has(event.data)) onUnavailable();
        },
      },
    });
  });
}
