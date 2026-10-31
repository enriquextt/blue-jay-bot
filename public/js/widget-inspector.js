import { ALIGN_TARGETS } from './widget/editor-model.js';
import { ALIGNMENTS, FONT_WEIGHTS, LIMITS, TEXT_VARIABLES, VERTICAL_ALIGNMENTS } from './widget/catalog.js';
import { t } from './i18n.js';

const COLOR = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function field(label, ...controls) {
  const wrapper = node('label', 'we-field');
  wrapper.append(node('span', '', label), ...controls);
  return wrapper;
}

// Campos del inspector. Cada uno avisa de dos cosas: `onInput` con cada cambio (para verlo en vivo) y
// `onCommit` al terminar (para anotarlo en el historial de deshacer).
function numberInput(value, [min, max], { step = 1, onInput, onCommit }) {
  const input = node('input', 'number');
  Object.assign(input, { type: 'number', min, max, step, value });

  input.addEventListener('input', () => {
    const number = input.valueAsNumber;
    if (Number.isFinite(number) && number >= min && number <= max) onInput(number);
  });
  input.addEventListener('change', () => {
    const number = Number.isFinite(input.valueAsNumber) ? Math.min(max, Math.max(min, input.valueAsNumber)) : value;
    input.value = number;
    onInput(number);
    onCommit();
  });
  return input;
}

function textInput(value, { maxLength, onInput, onCommit }) {
  const input = node('input');
  Object.assign(input, { type: 'text', maxLength, value });
  input.addEventListener('input', () => onInput(input.value));
  input.addEventListener('change', onCommit);
  return input;
}

function selectInput(value, options, { onInput, onCommit }) {
  const select = node('select');
  for (const [optionValue, label] of options) {
    const option = node('option', '', label);
    option.value = String(optionValue);
    select.append(option);
  }
  select.value = String(value);
  select.addEventListener('change', () => {
    onInput(select.value);
    onCommit();
  });
  return select;
}

function checkbox(value, label, { onInput, onCommit }) {
  const wrapper = node('label', 'check');
  const input = node('input');
  Object.assign(input, { type: 'checkbox', checked: value });
  input.addEventListener('change', () => {
    onInput(input.checked);
    onCommit();
  });
  wrapper.append(input, node('span', '', label));
  return wrapper;
}

// Color `#rrggbb` o `#rrggbbaa`: el selector del navegador no tiene transparencia, así que va aparte.
function colorInput(value, { onInput, onCommit }) {
  const [, rgb, alphaHex] = value.match(COLOR) ?? [null, '000000', undefined];
  const picker = node('input');
  Object.assign(picker, { type: 'color', value: `#${rgb}` });

  const alpha = node('input', 'number');
  const alphaValue = alphaHex === undefined ? 100 : Math.round((parseInt(alphaHex, 16) / 255) * 100);
  Object.assign(alpha, { type: 'number', min: 0, max: 100, step: 1, value: alphaValue, title: t('widgetEditor.alpha') });
  alpha.setAttribute('aria-label', t('widgetEditor.alpha'));

  const current = () => {
    const percent = Number.isFinite(alpha.valueAsNumber) ? Math.min(100, Math.max(0, alpha.valueAsNumber)) : 100;
    const hex = Math.round((percent / 100) * 255).toString(16).padStart(2, '0');
    return `${picker.value}${percent === 100 ? '' : hex}`;
  };

  picker.addEventListener('input', () => onInput(current()));
  picker.addEventListener('change', onCommit);
  alpha.addEventListener('input', () => onInput(current()));
  alpha.addEventListener('change', () => {
    onInput(current());
    onCommit();
  });

  const wrapper = node('span', 'we-color');
  wrapper.append(picker, alpha, node('span', 'we-unit', '%'));
  return wrapper;
}

// Inspector: edita las propiedades del elemento seleccionado o, sin selección, las del layout.
// `onElement(patch, { commit })` y `onLayout(patch, { commit })` piden el cambio; `onAlign(destino)` pega al lienzo.
export function createInspector({ root, onElement, onLayout, onAlign }) {
  function render({ layout, element }) {
    root.replaceChildren();
    if (!layout) return;

    if (element) renderElement(layout, element);
    else renderLayout(layout);
  }

  function bind(apply) {
    return { onInput: (value) => apply(value, { commit: false }), onCommit: () => apply(undefined, { commit: true }) };
  }

  function renderLayout(layout) {
    const set = (patch, options) => onLayout(patch, options);
    const section = node('div', 'we-section');
    section.append(node('h3', '', t('widgetEditor.layoutTitle')));

    section.append(
      field(t('widgetEditor.name'), textInput(layout.name, { maxLength: LIMITS.nameLength, ...bind((value, o) => set(value === undefined ? {} : { name: value }, o)) })),
      field(t('widgetEditor.canvasWidth'), numberInput(layout.canvas.width, LIMITS.canvasWidth, bind((value, o) => set(value === undefined ? {} : { canvas: { ...layout.canvas, width: value } }, o)))),
      field(t('widgetEditor.canvasHeight'), numberInput(layout.canvas.height, LIMITS.canvasHeight, bind((value, o) => set(value === undefined ? {} : { canvas: { ...layout.canvas, height: value } }, o)))),
      field(t('widgetEditor.showSeconds'), numberInput(layout.showSeconds, LIMITS.showSeconds, bind((value, o) => set(value === undefined ? {} : { showSeconds: value }, o)))),
      field(t('widgetEditor.idleOpacity'), numberInput(Math.round(layout.idleOpacity * 100), [0, 100], bind((value, o) => set(value === undefined ? {} : { idleOpacity: value / 100 }, o)))),
    );
    root.append(section);
    root.append(node('p', 'empty', t('widgetEditor.selectHint')));
  }

  function renderElement(layout, element) {
    const set = (key, transform = (value) => value) => bind((value, options) => onElement(value === undefined ? {} : { [key]: transform(value) }, options));

    const head = node('div', 'we-section');
    head.append(node('h3', '', `${t(`widgetEditor.type.${element.type}`)} · ${element.id}`));
    head.append(
      checkbox(element.visible, t('widgetEditor.visible'), set('visible')),
      checkbox(element.locked, t('widgetEditor.locked'), set('locked')),
    );

    const geometry = node('div', 'we-section');
    geometry.append(node('h3', '', t('widgetEditor.geometry')));
    const grid = node('div', 'we-grid');
    grid.append(
      field('X', numberInput(element.x, LIMITS.position, set('x'))),
      field('Y', numberInput(element.y, LIMITS.position, set('y'))),
      field(t('widgetEditor.width'), numberInput(element.width, LIMITS.size, set('width'))),
      field(t('widgetEditor.height'), numberInput(element.height, LIMITS.size, set('height'))),
      field(t('widgetEditor.rotation'), numberInput(element.rotation, [-360, 360], set('rotation'))),
      field(t('widgetEditor.opacity'), numberInput(Math.round(element.opacity * 100), [0, 100], set('opacity', (value) => value / 100))),
    );
    geometry.append(grid);

    const align = node('div', 'we-align');
    for (const target of ALIGN_TARGETS) {
      const button = node('button', 'secondary', t(`widgetEditor.align.${target}`));
      button.type = 'button';
      button.addEventListener('click', () => onAlign(target));
      align.append(button);
    }
    geometry.append(node('span', 'we-label', t('widgetEditor.alignTitle')), align);

    root.append(head, geometry);
    const specific = TYPE_SECTIONS[element.type]?.({ element, set });
    if (specific) root.append(specific);
  }

  const TYPE_SECTIONS = {
    text({ element, set }) {
      const section = node('div', 'we-section');
      section.append(node('h3', '', t('widgetEditor.textTitle')));

      const template = textInput(element.template, { maxLength: LIMITS.templateLength, ...set('template') });
      const variables = node('div', 'we-variables');
      for (const name of TEXT_VARIABLES) {
        const button = node('button', 'secondary', `{${name}}`);
        button.type = 'button';
        button.title = t(`widgetEditor.variable.${name}`);
        button.addEventListener('click', () => {
          const position = template.selectionStart ?? template.value.length;
          template.value = `${template.value.slice(0, position)}{${name}}${template.value.slice(template.selectionEnd ?? position)}`;
          template.dispatchEvent(new Event('input'));
          template.dispatchEvent(new Event('change'));
        });
        variables.append(button);
      }

      const grid = node('div', 'we-grid');
      grid.append(
        field(t('widgetEditor.fontSize'), numberInput(element.fontSize, LIMITS.fontSize, set('fontSize'))),
        field(t('widgetEditor.maxLines'), numberInput(element.maxLines, LIMITS.maxLines, set('maxLines'))),
        field(t('widgetEditor.fontWeight'), selectInput(element.fontWeight, FONT_WEIGHTS.map((weight) => [weight, String(weight)]), set('fontWeight', Number))),
        field(t('widgetEditor.textAlignTitle'), selectInput(element.align, ALIGNMENTS.map((value) => [value, t(`widgetEditor.textAlign.${value}`)]), set('align'))),
        field(t('widgetEditor.textValignTitle'), selectInput(element.valign, VERTICAL_ALIGNMENTS.map((value) => [value, t(`widgetEditor.textValign.${value}`)]), set('valign'))),
      );
      section.append(field(t('widgetEditor.template'), template), variables, grid, field(t('widgetEditor.color'), colorInput(element.color, set('color'))));
      return section;
    },

    progress({ element, set }) {
      const section = node('div', 'we-section');
      section.append(
        node('h3', '', t('widgetEditor.progressTitle')),
        field(t('widgetEditor.color'), colorInput(element.color, set('color'))),
        field(t('widgetEditor.track'), colorInput(element.track, set('track'))),
        field(t('widgetEditor.radius'), numberInput(element.radius, LIMITS.radius, set('radius'))),
      );
      return section;
    },

    disc({ element, set }) {
      const section = node('div', 'we-section');
      section.append(node('h3', '', t('widgetEditor.discTitle')), field(t('widgetEditor.accent'), colorInput(element.accent, set('accent'))));
      return section;
    },

    box({ element, set }) {
      const section = node('div', 'we-section');
      section.append(
        node('h3', '', t('widgetEditor.boxTitle')),
        field(t('widgetEditor.fill'), colorInput(element.fill.color, bind((value, options) => onElement(value === undefined ? {} : { fill: { ...element.fill, color: value } }, options)))),
        field(t('widgetEditor.radius'), numberInput(element.shape.radius, LIMITS.radius, bind((value, options) => onElement(value === undefined ? {} : { shape: { ...element.shape, radius: value } }, options)))),
      );
      return section;
    },
  };

  return { render };
}
