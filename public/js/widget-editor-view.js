import { confirmOnSecondClick, iconButton } from './dom.js';
import { currentLocale, t } from './i18n.js';
import { createCanvas } from './widget-canvas.js';
import { createInspector } from './widget-inspector.js';
import {
  addElement,
  alignElement,
  canAddElement,
  createHistory,
  duplicateElement,
  moveLayer,
  removeElement,
  updateElement,
} from './widget/editor-model.js';
import { ELEMENT_TYPES } from './widget/catalog.js';
import { isAssetFont, SYSTEM_FONT } from './widget/fonts.js';
import { applyAnimationTemplate } from './widget/animation-templates.js';
import { templateValues } from './widget/format.js';

const NUDGE = 1;
const NUDGE_FAST = 10;
const SAMPLE = { position: 83, duration: 215 };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// Lo que se edita de un layout: todo menos el id y si es de serie.
const plain = ({ name, canvas, showSeconds, idleOpacity, elements }) => ({ name, canvas, showSeconds, idleOpacity, elements });

// Editor del widget: capas, lienzo y propiedades. Cada layout tiene su propio borrador y su propio historial de
// deshacer mientras el panel está abierto, de modo que cambiar de layout no pierde lo que no se ha guardado.
export function createWidgetEditorView({ send, showNotice }) {
  const el = {
    layout: document.querySelector('#we-layout'),
    activate: document.querySelector('#we-activate'),
    duplicate: document.querySelector('#we-duplicate'),
    remove: document.querySelector('#we-delete'),
    removeLabel: document.querySelector('#we-delete-label'),
    copyUrl: document.querySelector('#we-copy-url'),
    status: document.querySelector('#we-status'),
    undoSlot: document.querySelector('#we-history'),
    discard: document.querySelector('#we-discard'),
    save: document.querySelector('#we-save'),
    addType: document.querySelector('#we-add-type'),
    add: document.querySelector('#we-add'),
    layers: document.querySelector('#we-layers'),
    canvas: document.querySelector('#we-canvas'),
    longTitle: document.querySelector('#we-long-title'),
    replay: document.querySelector('#we-replay'),
    testObs: document.querySelector('#we-test'),
    inspector: document.querySelector('#we-inspector'),
    body: document.querySelector('#we-body'),
    empty: document.querySelector('#we-empty'),
  };

  let layouts = [];
  let assets = [];
  let activeId = null;
  let selectedId = null;
  let selectedElementId = null;
  // id de layout -> { draft, history, saved } con `saved` como el texto de lo último que hay en el servidor.
  const sessions = new Map();
  // Qué hacer cuando el servidor confirme el guardado: seguir en el layout nuevo y, si se guardó como copia, olvidar lo editado en el original.
  let pending = null;

  const undoButton = iconButton({ name: 'undo', label: t('widgetEditor.undo'), onClick: () => step('undo') });
  const redoButton = iconButton({ name: 'redo', label: t('widgetEditor.redo'), onClick: () => step('redo') });
  el.undoSlot.append(undoButton, redoButton);

  const canvas = createCanvas({
    root: el.canvas,
    onSelect: (id) => {
      selectedElementId = id;
      refresh();
    },
    onGesture: (layout) => {
      session().draft = layout;
      refresh({ layers: false });
    },
    onGestureEnd: () => commit(),
  });

  const inspector = createInspector({
    root: el.inspector,
    onElement: (change, { commit: done }) => {
      applyToElement(change);
      if (done) commit({ inspector: false });
      else refresh({ inspector: false, layers: false });
    },
    onLayout: (change, { commit: done }) => {
      const { draft } = session();
      session().draft = { ...draft, ...(typeof change === 'function' ? change(draft) : change) };
      if (done) commit();
      else refresh({ inspector: false, layers: false });
    },
    // Cambios que alteran los campos que se muestran: se anotan y se vuelve a pintar el inspector.
    onRebuild: (change) => {
      applyToElement(change);
      commit();
    },
    onUpload: (file, kind) => uploadAsset(file, kind),
    onAnimationTemplate: (id) => {
      session().draft = { ...session().draft, elements: applyAnimationTemplate(session().draft.elements, id) };
      commit();
      canvas.cycle();
    },
    onDeleteAsset: (id) => send({ type: 'widget.asset.delete', id }),
    onAlign: (target) => {
      session().draft = alignElement(session().draft, selectedElementId, target);
      commit();
    },
  });

  Sortable.create(el.layers, {
    animation: 150,
    filter: 'button',
    preventOnFilter: false,
    onEnd: (event) => {
      const total = session().draft.elements.length;
      const id = event.item.dataset.id;
      session().draft = moveLayer(session().draft, id, total - 1 - event.newIndex);
      commit();
    },
  });

  // `change` es un objeto con campos nuevos o una función que lo calcula con el elemento tal como está ahora.
  function applyToElement(change) {
    const current = session().draft.elements.find((element) => element.id === selectedElementId);
    if (!current) return;

    session().draft = updateElement(session().draft, current.id, typeof change === 'function' ? change(current) : change);
  }

  const UPLOAD_ERRORS = { 400: 'errors.assetInvalid', 403: 'errors.localOnly', 409: 'errors.assetLimit', 413: 'errors.assetTooLarge', 415: 'errors.assetInvalid' };

  // Las fuentes no tienen un tipo fiable en el navegador (`file.type` suele venir vacío): se pone según la extensión.
  const FONT_TYPES = { woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' };

  // Sube una imagen o una fuente y la deja elegida en el elemento seleccionado.
  async function uploadAsset(file, kind) {
    const type = kind === 'font' ? FONT_TYPES[file.name.split('.').pop().toLowerCase()] : file.type;
    if (!type) {
      showNotice(t('errors.assetInvalid'), 'error');
      return;
    }

    let response;
    try {
      response = await fetch('/api/widget/assets', {
        method: 'POST',
        headers: { 'Content-Type': type, 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      });
    } catch {
      showNotice(t('errors.serverError'), 'error');
      return;
    }
    if (!response.ok) {
      showNotice(t(UPLOAD_ERRORS[response.status] ?? 'errors.serverError'), 'error');
      return;
    }

    const { id } = await response.json();
    // El servidor avisa de la lista nueva con `widget.assets`; mientras llega, se añade aquí para poder elegirla.
    if (!assets.some((asset) => asset.id === id)) assets = [...assets, { id, name: file.name, type, size: file.size }];
    if (session()) {
      applyToElement((element) => {
        if (kind === 'font') return element.type === 'text' ? { fontFamily: id } : {};
        return element.fill ? { fill: { type: 'image', asset: id, fit: element.fill.type === 'image' ? element.fill.fit : 'cover' } } : {};
      });
      commit();
    }
  }

  // Una imagen o fuente borrada no puede quedar elegida en un borrador: al guardar el servidor lo rechazaría.
  function pruneAssets() {
    const known = new Set(assets.map((asset) => asset.id));
    const withoutMissing = (element) => {
      if (element.fill?.type === 'image' && element.fill.asset && !known.has(element.fill.asset)) {
        return { ...element, fill: { ...element.fill, asset: null } };
      }
      return isAssetFont(element.fontFamily) && !known.has(element.fontFamily) ? { ...element, fontFamily: SYSTEM_FONT } : element;
    };
    for (const current of sessions.values()) {
      current.draft = { ...current.draft, elements: current.draft.elements.map(withoutMissing) };
    }
  }

  const session = () => sessions.get(selectedId) ?? null;
  const selectedLayout = () => layouts.find((layout) => layout.id === selectedId) ?? null;
  const isDirty = () => session() !== null && JSON.stringify(session().draft) !== session().saved;

  function displayName(layout) {
    return layout.builtin ? t(`widget.templates.${layout.id}`) : layout.name;
  }

  // Al tocar un layout de serie se trabaja sobre una copia: el nombre cambia solo, para no guardar dos con el mismo.
  function renameBuiltinCopy() {
    const layout = selectedLayout();
    const current = session();
    if (layout?.builtin && current.draft.name === layout.name) {
      current.draft = { ...current.draft, name: t('widgetEditor.copyName', { name: displayName(layout) }) };
    }
  }

  function commit(options) {
    renameBuiltinCopy();
    session().history.push(JSON.stringify(session().draft));
    refresh(options);
  }

  function step(direction) {
    const current = session();
    if (!current) return;

    current.draft = JSON.parse(current.history[direction]());
    if (!current.draft.elements.some((element) => element.id === selectedElementId)) selectedElementId = null;
    refresh();
  }

  function openSession(layout) {
    const saved = JSON.stringify(plain(layout));
    const existing = sessions.get(layout.id);
    if (!existing) {
      sessions.set(layout.id, { draft: JSON.parse(saved), history: createHistory(saved), saved });
      return;
    }
    if (existing.saved === saved) return;

    // Cambió en el servidor: se conserva el borrador si tenía cambios; si no, se pasa a lo nuevo (salvo que sea justo lo guardado ahora).
    const wasDirty = JSON.stringify(existing.draft) !== existing.saved;
    existing.saved = saved;
    if (!wasDirty && JSON.stringify(existing.draft) !== saved) {
      existing.draft = JSON.parse(saved);
      existing.history.reset(saved);
    }
  }

  function select(id) {
    selectedId = id;
    selectedElementId = null;
    refresh();
  }

  function sampleView() {
    const title = t(el.longTitle.checked ? 'widgetEditor.sampleTitleLong' : 'widgetEditor.sampleTitle');
    const values = templateValues({
      title,
      artist: t('widgetEditor.sampleArtist'),
      requester: t('widget.requestedBy', { user: 'ana' }),
      ...SAMPLE,
    });
    return { values, fraction: SAMPLE.position / SAMPLE.duration };
  }

  function renderToolbar() {
    const layout = selectedLayout();

    el.layout.replaceChildren(...layouts.map((item) => {
      const option = node('option', '', `${sessions.get(item.id) && JSON.stringify(sessions.get(item.id).draft) !== sessions.get(item.id).saved ? '• ' : ''}${displayName(item)}${item.id === activeId ? ` ${t('widgetEditor.activeSuffix')}` : ''}`);
      option.value = item.id;
      return option;
    }));
    if (layout) el.layout.value = layout.id;

    const dirty = isDirty();
    const current = session();
    el.activate.disabled = !layout || layout.id === activeId;
    el.duplicate.disabled = !layout;
    el.remove.disabled = !layout || layout.builtin;
    el.copyUrl.disabled = !layout;
    el.discard.disabled = !dirty;
    el.save.disabled = !dirty;
    undoButton.disabled = !current?.history.canUndo;
    redoButton.disabled = !current?.history.canRedo;

    el.status.replaceChildren(...[
      layout?.id === activeId && t('widgetEditor.statusActive'),
      layout?.builtin && t('widgetEditor.statusBuiltin'),
      dirty && t('widgetEditor.statusDirty'),
    ].filter(Boolean).map((text) => node('span', 'badge', text)));
  }

  function layerRow(element, draft) {
    const row = node('li', `we-layer${element.id === selectedElementId ? ' selected' : ''}${element.visible ? '' : ' hidden'}`);
    row.dataset.id = element.id;

    const label = node('span', 'we-layer-label');
    label.append(node('strong', '', t(`widgetEditor.type.${element.type}`)), node('small', '', element.type === 'text' ? element.template : element.id));
    row.addEventListener('click', () => {
      selectedElementId = element.id;
      refresh();
    });

    const toggle = (name, labelOn, labelOff, key) => iconButton({
      name,
      label: t(element[key] ? labelOn : labelOff),
      onClick: (event) => {
        event.stopPropagation();
        session().draft = updateElement(draft, element.id, { [key]: !element[key] });
        commit();
      },
    });
    const stop = (action) => (event) => {
      event.stopPropagation();
      action();
    };

    row.append(
      toggle(element.visible ? 'eye' : 'eyeOff', 'widgetEditor.hide', 'widgetEditor.show', 'visible'),
      toggle(element.locked ? 'lock' : 'unlock', 'widgetEditor.unlock', 'widgetEditor.lock', 'locked'),
      label,
      iconButton({ name: 'copy', label: t('widgetEditor.duplicateElement'), onClick: stop(() => duplicate(element.id)) }),
      iconButton({ name: 'trash', label: t('widgetEditor.deleteElement'), className: 'danger', onClick: stop(() => removeSelected(element.id)) }),
    );
    return row;
  }

  function duplicate(id) {
    const result = duplicateElement(session().draft, id);
    if (!result) return;

    session().draft = result.layout;
    selectedElementId = result.id;
    commit();
  }

  function removeSelected(id = selectedElementId) {
    if (!id) return;

    session().draft = removeElement(session().draft, id);
    if (selectedElementId === id) selectedElementId = null;
    commit();
  }

  function refresh({ layers = true, inspector: inspect = true } = {}) {
    renderToolbar();
    const current = session();
    el.body.hidden = !current;
    el.empty.hidden = Boolean(current);
    if (!current) return;

    const { draft } = current;
    const selected = draft.elements.find((element) => element.id === selectedElementId) ?? null;
    if (!selected) selectedElementId = null;

    el.add.disabled = !canAddElement(draft);
    canvas.show(draft, selectedElementId, sampleView());
    if (layers) el.layers.replaceChildren(...[...draft.elements].reverse().map((element) => layerRow(element, draft)));
    if (inspect) inspector.render({ layout: draft, element: selected, assets });
  }

  function render() {
    el.addType.replaceChildren(...ELEMENT_TYPES.map((type) => {
      const option = node('option', '', t(`widgetEditor.type.${type}`));
      option.value = type;
      return option;
    }));
    for (const [button, key] of [[undoButton, 'widgetEditor.undo'], [redoButton, 'widgetEditor.redo']]) {
      button.title = t(key);
      button.setAttribute('aria-label', t(key));
    }
    refresh();
  }

  el.layout.addEventListener('change', () => select(el.layout.value));
  el.longTitle.addEventListener('change', () => refresh({ layers: false, inspector: false }));
  el.replay.addEventListener('click', () => canvas.cycle());
  // Los widgets de OBS dibujan el borrador (aunque no esté guardado) durante unos segundos.
  el.testObs.addEventListener('click', () => {
    if (session()) send({ type: 'widget.test', layout: session().draft });
  });
  el.activate.addEventListener('click', () => send({ type: 'widget.layout.activate', id: selectedId }));
  el.copyUrl.addEventListener('click', async () => {
    const url = `${location.origin}/widget.html?lang=${currentLocale()}&layout=${selectedId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt(t('widgetEditor.copyUrl'), url);
    }
  });
  el.discard.addEventListener('click', () => {
    const current = session();
    current.draft = JSON.parse(current.saved);
    current.history.reset(current.saved);
    selectedElementId = null;
    refresh();
  });
  el.save.addEventListener('click', () => {
    pending = { fromId: selectedId, discardOriginal: Boolean(selectedLayout()?.builtin) };
    send({ type: 'widget.layout.save', layout: { ...session().draft, id: selectedId } });
  });
  el.duplicate.addEventListener('click', () => {
    pending = { fromId: selectedId, discardOriginal: false };
    send({ type: 'widget.layout.save', layout: { ...session().draft, name: t('widgetEditor.copyName', { name: session().draft.name }) } });
  });
  confirmOnSecondClick(el.remove, el.removeLabel, {
    labelKey: 'widgetEditor.delete',
    confirmKey: 'widgetEditor.deleteConfirm',
    onConfirm: () => send({ type: 'widget.layout.delete', id: selectedId }),
  });
  el.add.addEventListener('click', () => {
    const result = addElement(session().draft, el.addType.value);
    if (!result) return;

    session().draft = result.layout;
    selectedElementId = result.id;
    commit();
  });

  // Atajos con el foco en el lienzo: flechas para empujar, Supr para borrar, Ctrl+Z / Ctrl+Y y Ctrl+D.
  el.canvas.addEventListener('keydown', (event) => {
    const current = session();
    if (!current) return;

    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const selected = current.draft.elements.find((element) => element.id === selectedElementId);
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];

    if (modifier && key === 'z') step(event.shiftKey ? 'redo' : 'undo');
    else if (modifier && key === 'y') step('redo');
    else if (modifier && key === 'd' && selected) duplicate(selected.id);
    else if (key === 'escape') {
      selectedElementId = null;
      refresh();
    } else if ((key === 'delete' || key === 'backspace') && selected) removeSelected();
    else if (arrows && selected && !selected.locked) {
      const distance = event.shiftKey ? NUDGE_FAST : NUDGE;
      current.draft = updateElement(current.draft, selected.id, { x: selected.x + arrows[0] * distance, y: selected.y + arrows[1] * distance });
      commit();
    } else return;

    event.preventDefault();
  });

  return {
    render,
    handleMessage(message) {
      if (message.type === 'widget.layouts') {
        layouts = message.data.layouts;
        activeId = message.data.active;
        for (const layout of layouts) openSession(layout);
        for (const id of sessions.keys()) {
          if (!layouts.some((layout) => layout.id === id)) sessions.delete(id);
        }
        if (!layouts.some((layout) => layout.id === selectedId)) {
          selectedId = activeId;
          selectedElementId = null;
        }
        refresh();
      } else if (message.type === 'widget.assets') {
        assets = message.data;
        pruneAssets();
        refresh();
      } else if (message.type === 'widget.layout.saved' && pending) {
        const { fromId, discardOriginal } = pending;
        pending = null;
        if (message.id !== fromId) {
          if (discardOriginal) sessions.delete(fromId);
          if (layouts.some((layout) => layout.id === fromId)) openSession(layouts.find((layout) => layout.id === fromId));
          select(message.id);
        }
      }
    },
  };
}
