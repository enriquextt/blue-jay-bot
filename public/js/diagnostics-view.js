import { t } from './i18n.js';

// Estado del sistema que el servidor informa a petición: sin claves ni rutas, solo si las cosas existen y funcionan.
export function createDiagnosticsView({ send, connectionText }) {
  const list = document.querySelector('#diagnostics');
  let data = null;

  function row(label, value) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    return [term, description];
  }

  function uptimeText(seconds) {
    return t('diagnostics.uptimeValue', { hours: Math.floor(seconds / 3600), minutes: Math.floor((seconds % 3600) / 60) });
  }

  function render() {
    if (!data) return list.replaceChildren();

    list.replaceChildren(
      ...row(t('diagnostics.websocket'), connectionText()),
      ...row(t('diagnostics.panels'), String(data.panels)),
      ...row(t('diagnostics.widgets'), data.widgets > 0 ? String(data.widgets) : t('diagnostics.widgetsNone')),
      ...row(t('diagnostics.youtubeKey'), t(data.youtubeKey ? 'diagnostics.youtubeKeyOn' : 'diagnostics.youtubeKeyOff')),
      ...row(t('diagnostics.twitch'), t(`diagnostics.twitchStatus.${data.twitch}`)),
      ...row(t('diagnostics.version'), data.version),
      ...row(t('diagnostics.uptime'), uptimeText(data.uptime)),
    );
  }

  const refresh = () => send({ type: 'diagnostics.get' });
  document.querySelector('#diagnostics-refresh').addEventListener('click', refresh);

  return {
    render,
    refresh,
    handleMessage(message) {
      if (message.type !== 'diagnostics') return;
      data = message.data;
      render();
    },
  };
}
