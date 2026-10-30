import { currentLocale, t } from './i18n.js';

const LIMIT_SCOPES = ['user', 'global'];

// Ajustes guardados en el servidor: si el chat acepta peticiones y los límites de peticiones activas.
export function createSettingsView({ send, showNotice = () => {} }) {
  // Casillas de ajustes simples: el valor de `data-setting` es el nombre del ajuste (`chatEnabled`, `localFallback`).
  const boxes = [...document.querySelectorAll('[data-setting]')];
  const chatStatus = document.querySelector('#chat-status');
  const topbarToggle = document.querySelector('#chat-toggle');
  const limits = Object.fromEntries(LIMIT_SCOPES.map((scope) => [scope, {
    enabled: document.querySelector(`#limit-${scope}-enabled`),
    max: document.querySelector(`#limit-${scope}-max`),
  }]));
  const duration = {
    enabled: document.querySelector('#duration-enabled'),
    minutes: document.querySelector('#duration-minutes'),
  };
  let settings = null;

  function render() {
    if (!settings) return;

    for (const box of boxes) box.checked = settings[box.dataset.setting];
    chatStatus.textContent = t(settings.chatEnabled ? 'settings.chatOn' : 'settings.chatOff');
    topbarToggle.classList.toggle('off', !settings.chatEnabled);

    duration.enabled.checked = settings.maxDuration.enabled;
    duration.minutes.disabled = !settings.maxDuration.enabled;
    if (document.activeElement !== duration.minutes) duration.minutes.value = settings.maxDuration.minutes;

    for (const scope of LIMIT_SCOPES) {
      const { enabled, max } = settings.limits[scope];
      limits[scope].enabled.checked = enabled;
      limits[scope].max.disabled = !enabled;
      // No se pisa lo que se está escribiendo.
      if (document.activeElement !== limits[scope].max) limits[scope].max.value = max;
    }
  }

  for (const box of boxes) {
    box.addEventListener('change', () => send({ type: 'settings.update', [box.dataset.setting]: box.checked }));
  }
  duration.enabled.addEventListener('change', () => {
    send({ type: 'settings.update', maxDuration: { enabled: duration.enabled.checked } });
  });
  duration.minutes.addEventListener('change', () => {
    send({ type: 'settings.update', maxDuration: { minutes: Number(duration.minutes.value) } });
  });
  for (const scope of LIMIT_SCOPES) {
    limits[scope].enabled.addEventListener('change', () => {
      send({ type: 'settings.update', limits: { [scope]: { enabled: limits[scope].enabled.checked } } });
    });
    limits[scope].max.addEventListener('change', () => {
      send({ type: 'settings.update', limits: { [scope]: { max: Number(limits[scope].max.value) } } });
    });
  }

  // La dirección sale del origen desde el que se abre el panel, así que sirve tal cual para OBS en el mismo equipo.
  const widgetUrl = document.querySelector('#widget-url');
  const renderWidgetUrl = () => {
    widgetUrl.value = `${location.origin}/widget.html?lang=${currentLocale()}`;
  };
  renderWidgetUrl();
  window.addEventListener('localechange', renderWidgetUrl);
  document.querySelector('#widget-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(widgetUrl.value);
      showNotice(t('settings.widgetCopied'));
    } catch {
      widgetUrl.select();
      showNotice(t('settings.widgetCopyFailed'), 'error');
    }
  });
  document.querySelector('#widget-test').addEventListener('click', () => send({ type: 'widget.test' }));

  return {
    render,
    handleMessage(message) {
      if (message.type !== 'settings') return;
      settings = message.data;
      render();
    },
  };
}
