import { confirmOnSecondClick, iconButton, textButton, titleSpan, trackLabel } from './dom.js';
import { t } from './i18n.js';

// Listas de reproducción: crear, abrir, renombrar, eliminar y añadir a la cola una canción o toda la lista.
export function createPlaylistsView({ send }) {
  const el = {
    count: document.querySelector('#count-playlists'),
    form: document.querySelector('#playlist-form'),
    name: document.querySelector('#playlist-name'),
    overview: document.querySelector('#playlist-overview'),
    list: document.querySelector('#playlist-list'),
    empty: document.querySelector('#playlist-empty'),
    detail: document.querySelector('#playlist-detail'),
    back: document.querySelector('#playlist-back'),
    title: document.querySelector('#playlist-title'),
    summary: document.querySelector('#playlist-summary'),
    queueAll: document.querySelector('#playlist-queue-all'),
    renameForm: document.querySelector('#playlist-rename-form'),
    renameInput: document.querySelector('#playlist-rename-input'),
    delete: document.querySelector('#playlist-delete'),
    deleteLabel: document.querySelector('#playlist-delete span'),
    items: document.querySelector('#playlist-items'),
    itemsEmpty: document.querySelector('#playlist-items-empty'),
  };

  let playlists = [];
  let openId = null;
  let detail = null;

  function openPlaylist(id) {
    openId = id;
    detail = null;
    render();
    send({ type: 'playlist.open', id });
  }

  function render() {
    el.count.textContent = playlists.length;
    el.overview.hidden = openId !== null;
    el.detail.hidden = openId === null;

    el.list.replaceChildren(...playlists.map((playlist) => {
      const item = document.createElement('li');
      const count = document.createElement('span');
      count.className = 'duration';
      count.textContent = t('playlists.count', { count: playlist.count });
      item.append(
        titleSpan(playlist.name),
        count,
        textButton(t('playlists.open'), '', () => openPlaylist(playlist.id)),
      );
      return item;
    }));
    el.empty.hidden = playlists.length > 0;

    const summary = playlists.find((playlist) => playlist.id === openId);
    if (!summary) return;

    el.title.textContent = summary.name;
    el.summary.textContent = t('playlists.count', { count: summary.count });
    el.queueAll.disabled = summary.count === 0;

    const items = detail?.items ?? [];
    el.items.replaceChildren(...items.map((track) => {
      const row = document.createElement('li');
      row.append(
        titleSpan(trackLabel(track)),
        iconButton({
          name: 'plus',
          label: t('playlists.addToQueue'),
          onClick: () => send({ type: 'playlist.queueItem', itemId: track.id }),
        }),
        iconButton({
          name: 'trash',
          label: t('playlists.removeItem'),
          className: 'danger',
          onClick: () => send({ type: 'playlist.removeItem', itemId: track.id }),
        }),
      );
      return row;
    }));
    el.itemsEmpty.hidden = detail === null || items.length > 0;
  }

  el.form.addEventListener('submit', (event) => {
    event.preventDefault();
    send({ type: 'playlist.create', name: el.name.value.trim() });
    el.name.value = '';
  });
  el.back.addEventListener('click', () => {
    openId = null;
    detail = null;
    render();
  });
  el.queueAll.addEventListener('click', () => send({ type: 'playlist.queueAll', id: openId }));
  el.renameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    send({ type: 'playlist.rename', id: openId, name: el.renameInput.value.trim() });
    el.renameInput.value = '';
  });
  confirmOnSecondClick(el.delete, el.deleteLabel, {
    labelKey: 'playlists.delete',
    confirmKey: 'playlists.deleteConfirm',
    onConfirm: () => send({ type: 'playlist.remove', id: openId }),
  });

  return {
    render,
    handleMessage(message) {
      switch (message.type) {
        case 'playlists':
          playlists = message.data;
          // Si la lista abierta ya no existe se vuelve al listado; si no, se pide de nuevo su contenido.
          if (openId !== null && !playlists.some((playlist) => playlist.id === openId)) {
            openId = null;
            detail = null;
          } else if (openId !== null) {
            send({ type: 'playlist.open', id: openId });
          }
          render();
          break;
        case 'playlist.created':
          openPlaylist(message.id);
          break;
        case 'playlist':
          if (message.data.id !== openId) break;
          detail = message.data;
          render();
          break;
      }
    },
  };
}
