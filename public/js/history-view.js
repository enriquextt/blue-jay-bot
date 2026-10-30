import { confirmOnSecondClick, iconButton, titleSpan, trackLabel } from './dom.js';
import { currentLocale, t } from './i18n.js';

const PAGE_SIZE = 50;
const FILTER_DEBOUNCE_MS = 250;
const OUTCOMES = [
  'accepted',
  'replaced',
  'unavailable',
  'invalid_url',
  'not_found',
  'search_failed',
  'search_disabled',
  'library_disabled',
  'banned',
  'disabled',
  'limit_user',
  'limit_global',
  'too_long',
  'live',
];
// Qué resultados se destacan en rojo (algo falló) o en ámbar (se rechazó); el resto es normal.
const OUTCOME_TONE = { accepted: 'ok', replaced: 'ok', invalid_url: 'error', search_failed: 'error' };

// Las fechas del filtro son del día local: desde las 00:00 del primer día hasta el último milisegundo del segundo.
function dayBound(value, endOfDay) {
  if (!value) return null;

  const [year, month, day] = value.split('-').map(Number);
  const date = endOfDay ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day);
  return date.getTime();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Historial de peticiones del chat (con su resultado) y de canciones reproducidas, con filtros.
export function createHistoryView({ send }) {
  const el = {
    kinds: [...document.querySelectorAll('[data-history-kind]')],
    user: document.querySelector('#history-user'),
    outcome: document.querySelector('#history-outcome'),
    from: document.querySelector('#history-from'),
    to: document.querySelector('#history-to'),
    target: document.querySelector('#history-target'),
    clear: document.querySelector('#history-clear'),
    clearLabel: document.querySelector('#history-clear span'),
    list: document.querySelector('#history-list'),
    empty: document.querySelector('#history-empty'),
    showing: document.querySelector('#history-showing'),
    more: document.querySelector('#history-more'),
  };

  let kind = 'requests';
  let result = { items: [], total: 0 };
  let playlists = [];
  let limit = PAGE_SIZE;
  let seq = 0;
  let timer = null;

  function request() {
    seq += 1;
    send({
      type: 'history.query',
      kind,
      seq,
      user: el.user.value.trim(),
      outcome: kind === 'requests' && el.outcome.value ? el.outcome.value : null,
      from: dayBound(el.from.value, false),
      to: dayBound(el.to.value, true),
      limit,
    });
  }

  // Un filtro nuevo vuelve a la primera página.
  function refilter() {
    limit = PAGE_SIZE;
    request();
  }

  function time(milliseconds) {
    return new Date(milliseconds).toLocaleString(currentLocale(), { dateStyle: 'short', timeStyle: 'short' });
  }

  function outcomeBadge(outcome) {
    return element('span', `outcome ${OUTCOME_TONE[outcome] ?? 'warn'}`, t(`history.outcome.${outcome}`));
  }

  // Añadir a la cola y guardar en la lista elegida; solo las filas que tienen pista (las rechazadas no).
  function rowActions(item) {
    if (!item.track) return [];

    const save = iconButton({
      name: 'bookmark',
      label: t('history.saveToPlaylist'),
      onClick: () => send({ type: 'playlist.addFromHistory', id: Number(el.target.value), kind, itemId: item.id }),
    });
    save.disabled = !el.target.value;

    return [
      iconButton({
        name: 'plus',
        label: t('history.addToQueue'),
        onClick: () => send({ type: 'history.queue', kind, id: item.id }),
      }),
      save,
    ];
  }

  function requestRow(item) {
    const text = element('div', 'history-text');
    text.append(
      titleSpan(item.track ? trackLabel(item.track) : item.input),
      element('small', 'history-meta', [
        time(item.createdAt),
        `${item.user} (${item.platform})`,
        t(`history.kind.${item.kind}`),
        ...(item.track ? [`«${item.input}»`] : []),
      ].join(' · ')),
    );
    return [text, outcomeBadge(item.outcome)];
  }

  function playRow(item) {
    const text = element('div', 'history-text');
    text.append(
      titleSpan(trackLabel(item.track)),
      element('small', 'history-meta', [
        time(item.playedAt),
        t(`history.origin.${item.origin}`),
        ...(item.requestedBy ? [t('history.by', { user: item.requestedBy })] : []),
      ].join(' · ')),
    );
    return [text];
  }

  function renderPlaylists() {
    const previous = el.target.value;
    const options = playlists.map((playlist) => {
      const option = element('option', '', playlist.name);
      option.value = playlist.id;
      return option;
    });
    if (options.length === 0) {
      const option = element('option', '', t('history.noPlaylists'));
      option.value = '';
      options.push(option);
    }

    el.target.replaceChildren(...options);
    el.target.value = playlists.some((playlist) => String(playlist.id) === previous) ? previous : options[0].value;
    el.target.disabled = playlists.length === 0;
  }

  function render() {
    renderPlaylists();

    for (const button of el.kinds) button.setAttribute('aria-pressed', String(button.dataset.historyKind === kind));
    el.outcome.hidden = kind !== 'requests';

    // Las opciones llevan el texto del idioma actual; se conserva la elegida.
    const chosen = el.outcome.value;
    const all = element('option', '', t('history.allOutcomes'));
    all.value = '';
    el.outcome.replaceChildren(all, ...OUTCOMES.map((outcome) => {
      const option = element('option', '', t(`history.outcome.${outcome}`));
      option.value = outcome;
      return option;
    }));
    el.outcome.value = chosen;

    const { items, total } = result;
    el.list.replaceChildren(...items.map((item) => {
      const row = element('li', 'history-row');
      const content = kind === 'requests' ? requestRow(item) : playRow(item);
      row.append(
        ...content,
        ...rowActions(item),
        iconButton({
          name: 'trash',
          label: t('history.delete'),
          className: 'danger',
          onClick: () => send({ type: 'history.delete', kind, id: item.id }),
        }),
      );
      return row;
    }));

    el.empty.hidden = items.length > 0;
    el.clear.disabled = total === 0 && items.length === 0;
    el.showing.hidden = items.length === 0;
    el.showing.textContent = t('history.showing', { shown: items.length, total });
    el.more.hidden = items.length >= total;
  }

  for (const button of el.kinds) {
    button.addEventListener('click', () => {
      kind = button.dataset.historyKind;
      result = { items: [], total: 0 };
      render();
      refilter();
    });
  }
  for (const input of [el.user, el.outcome, el.from, el.to]) {
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(refilter, FILTER_DEBOUNCE_MS);
    });
  }
  el.target.addEventListener('change', render);
  el.more.addEventListener('click', () => {
    limit += PAGE_SIZE;
    request();
  });
  confirmOnSecondClick(el.clear, el.clearLabel, {
    labelKey: 'history.clear',
    confirmKey: 'history.clearConfirm',
    onConfirm: () => send({ type: 'history.clear', kind }),
  });

  return {
    render,
    handleMessage(message) {
      switch (message.type) {
        case 'history.changed':
          request();
          break;
        case 'history.results':
          // Se descartan respuestas de una consulta anterior a la última enviada.
          if (message.seq !== seq || message.kind !== kind) break;
          result = message;
          render();
          break;
        case 'playlists':
          playlists = message.data;
          render();
          break;
      }
    },
  };
}
