import { textButton } from './dom.js';
import { t } from './i18n.js';

const LANGUAGE_NAMES = { es: 'Español', en: 'English' };
const GROUPS_WITH_TITLE = new Set(['general', 'limit']);
const MAX_LENGTH = 400;
// Valores de ejemplo para la vista previa; una variable que no está aquí se muestra con su nombre.
const SAMPLES = {
  user: 'ana',
  title: 'Canción de ejemplo',
  position: 3,
  count: 2,
  query: 'mi canción',
  original: 'Vídeo original',
  current: 'Canción actual',
  next: '1. Siguiente',
  volume: 70,
  votes: 1,
  needed: 3,
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function preview(text) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => SAMPLES[name] ?? name);
}

// `chat.sr.added` va en el grupo `sr`; los que cuelgan directamente de `chat` van en los generales.
function groupOf(key) {
  const parts = key.split('.');
  return parts.length >= 3 ? parts[1] : 'general';
}

function groupTitle(group) {
  return GROUPS_WITH_TITLE.has(group) ? t(`messages.group.${group}`) : `!${group}`;
}

// Editor de los mensajes del bot: texto por idioma, vista previa, activar o desactivar y restaurar.
export function createMessagesView({ send }) {
  const el = {
    locale: document.querySelector('#messages-locale'),
    search: document.querySelector('#messages-search'),
    botLanguage: document.querySelector('#messages-bot-language'),
    list: document.querySelector('#messages-list'),
    empty: document.querySelector('#messages-empty'),
  };

  let items = [];
  let botLanguage = null;
  const openGroups = new Set();
  let stale = false;

  const locale = () => el.locale.value;

  function matches(item, query) {
    if (!query) return true;

    const texts = item.forms.flatMap((form) => [form.defaults[locale()], form.custom[locale()] ?? '']);
    return [item.key, ...texts].some((text) => text.toLowerCase().includes(query));
  }

  function formEditor(item, form) {
    const wrapper = element('div', 'message-form-editor');
    const area = element('textarea');
    area.rows = 2;
    area.maxLength = MAX_LENGTH;
    area.value = form.custom[locale()] ?? form.defaults[locale()];
    area.setAttribute('aria-label', item.key);

    const shown = element('div', 'message-meta');
    const update = () => {
      shown.textContent = `${t('messages.preview')} ${preview(area.value)}`;
    };
    update();
    area.addEventListener('input', update);
    area.addEventListener('change', () => {
      send({ type: 'message.setText', locale: locale(), leaf: form.leaf, text: area.value });
    });

    if (form.form) wrapper.append(element('span', 'message-form', t(`messages.form.${form.form}`)));
    wrapper.append(area, shown);
    return wrapper;
  }

  function messageRow(item) {
    const row = element('div', `message${item.enabled ? '' : ' disabled'}`);
    const customized = item.forms.some((form) => form.custom.es !== undefined || form.custom.en !== undefined);

    const toggle = element('label', 'check');
    const box = element('input');
    box.type = 'checkbox';
    box.checked = item.enabled;
    box.addEventListener('change', () => send({ type: 'message.setEnabled', key: item.key, enabled: box.checked }));
    toggle.append(box, element('span', '', t('messages.enabled')));

    const head = element('div', 'message-head');
    head.append(toggle, element('span', 'message-key', item.key.replace(/^chat\./, '')));
    if (item.forms.some((form) => form.custom[locale()] !== undefined)) head.append(element('span', 'badge', t('messages.custom')));
    if (customized || !item.enabled) {
      head.append(textButton(t('messages.reset'), 'secondary', () => send({ type: 'message.reset', key: item.key })));
    }

    const meta = element('div', 'message-meta');
    meta.append(`${t('messages.params')} `);
    for (const name of item.params) meta.append(element('code', '', `{{${name}}}`));

    row.append(head, ...item.forms.map((form) => formEditor(item, form)));
    if (item.params.length > 0) row.append(meta);
    return row;
  }

  function render() {
    if (botLanguage) el.botLanguage.textContent = t('messages.botLanguage', { language: LANGUAGE_NAMES[botLanguage] });

    const query = el.search.value.trim().toLowerCase();
    const groups = new Map();
    for (const item of items.filter((candidate) => matches(candidate, query))) {
      const group = groupOf(item.key);
      groups.set(group, [...(groups.get(group) ?? []), item]);
    }

    el.list.replaceChildren(...[...groups].map(([group, groupItems]) => {
      const details = element('details', 'message-group');
      details.open = query !== '' || openGroups.has(group);
      details.addEventListener('toggle', () => {
        if (details.open) openGroups.add(group);
        else openGroups.delete(group);
      });
      details.append(element('summary', '', `${groupTitle(group)} (${groupItems.length})`), ...groupItems.map(messageRow));
      return details;
    }));
    el.empty.hidden = groups.size > 0;
    stale = false;
  }

  el.locale.addEventListener('change', render);
  el.search.addEventListener('input', render);
  // Si llegó un cambio mientras se escribía, se pinta al salir del cuadro de texto.
  el.list.addEventListener('focusout', () => {
    if (stale) render();
  });

  return {
    render,
    handleMessage(message) {
      if (message.type !== 'messages') return;

      items = message.data.items;
      if (botLanguage === null) {
        botLanguage = message.data.language;
        el.locale.value = botLanguage;
      }

      // No se pisa lo que se está escribiendo.
      if (document.activeElement?.tagName === 'TEXTAREA' && el.list.contains(document.activeElement)) {
        stale = true;
        return;
      }
      render();
    },
  };
}
