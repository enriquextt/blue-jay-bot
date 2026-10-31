// Reproductor de pistas de la biblioteca local. El audio lo sirve el servidor en /media/<id>;
// el cliente solo conoce el id de la pista, nunca su ruta.
export function createLocalPlayer({ element, onEnded, onUnavailable, onBlocked }) {
  element.addEventListener('ended', onEnded);
  element.addEventListener('error', () => {
    // Al vaciar el origen con stop() el navegador también puede avisar de un error.
    if (element.getAttribute('src')) onUnavailable();
  });

  return {
    load(id) {
      element.hidden = false;
      element.src = `/media/${encodeURIComponent(id)}`;
      element.play().catch((error) => {
        // El navegador exige un gesto del usuario antes de reproducir audio por sí solo.
        if (error.name === 'NotAllowedError') onBlocked();
      });
    },
    stop() {
      element.pause();
      element.removeAttribute('src');
      element.load();
      element.hidden = true;
    },
    pause() {
      element.pause();
    },
    resume() {
      element.play().catch((error) => {
        if (error.name === 'NotAllowedError') onBlocked();
      });
    },
    setVolume(volume) {
      element.volume = volume / 100;
    },
    progress() {
      return { position: element.currentTime, duration: element.duration, paused: element.paused };
    },
  };
}
