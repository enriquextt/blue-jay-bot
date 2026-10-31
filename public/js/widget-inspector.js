import { ALIGN_TARGETS } from './widget/editor-model.js';
import {
  ALIGNMENTS,
  BORDER_STYLES,
  DEFAULT_FILLS,
  DEFAULT_TEXT_GRADIENT,
  EASINGS,
  ENTER_PRESETS,
  FILL_TYPES,
  FONT_WEIGHTS,
  IMAGE_FITS,
  LIMITS,
  LOOP_PRESETS,
  OVERFLOWS,
  SHAPES,
  SHAPE_TYPES,
  TEXT_VARIABLES,
  VERTICAL_ALIGNMENTS,
} from './widget/catalog.js';
import { ANIMATION_TEMPLATE_IDS } from './widget/animation-templates.js';
import { FONT_KEYS, FONTS, SYSTEM_FONT } from './widget/fonts.js';
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
// `onElement(cambio, { commit })` y `onLayout(cambio, { commit })` piden el cambio; `cambio` es un objeto con los campos
// nuevos o una función que lo calcula con el elemento (o layout) tal como está AHORA: el inspector no se reconstruye
// al terminar de editar un campo, así que lo que tiene guardado puede estar desfasado. `onRebuild(cambio)` es lo mismo
// para cambios que alteran los campos que se muestran (otra forma, otro tipo de relleno). `onAlign(destino)` pega al lienzo;
// `onAnimationTemplate(id)` aplica una plantilla de animación a todos los elementos. `onUpload(archivo, tipo)` (`image` o `font`) y `onDeleteAsset(id)` gestionan las imágenes y fuentes subidas.
export function createInspector({ root, onElement, onLayout, onRebuild, onAlign, onUpload, onDeleteAsset, onAnimationTemplate }) {
  function render({ layout, element, assets = [] }) {
    root.replaceChildren();
    if (!layout) return;

    if (element) renderElement(element, assets);
    else renderLayout(layout);
  }

  function bind(apply) {
    return { onInput: (value) => apply(value, { commit: false }), onCommit: () => apply(undefined, { commit: true }) };
  }

  function section(title, ...children) {
    const wrapper = node('div', 'we-section');
    if (title) wrapper.append(node('h3', '', title));
    wrapper.append(...children);
    return wrapper;
  }

  function renderLayout(layout) {
    const set = (build) => bind((value, options) => onLayout(value === undefined ? {} : build(value), options));

    root.append(
      section(
        t('widgetEditor.layoutTitle'),
        field(t('widgetEditor.name'), textInput(layout.name, { maxLength: LIMITS.nameLength, ...set((value) => ({ name: value })) })),
        field(t('widgetEditor.canvasWidth'), numberInput(layout.canvas.width, LIMITS.canvasWidth, set((value) => (current) => ({ canvas: { ...current.canvas, width: value } })))),
        field(t('widgetEditor.canvasHeight'), numberInput(layout.canvas.height, LIMITS.canvasHeight, set((value) => (current) => ({ canvas: { ...current.canvas, height: value } })))),
        field(t('widgetEditor.showSeconds'), numberInput(layout.showSeconds, LIMITS.showSeconds, set((value) => ({ showSeconds: value })))),
        field(t('widgetEditor.idleOpacity'), numberInput(Math.round(layout.idleOpacity * 100), [0, 100], set((value) => ({ idleOpacity: value / 100 })))),
      ),
      animationTemplates(),
      node('p', 'empty', t('widgetEditor.selectHint')),
    );
  }

  function animationTemplates() {
    const picker = selectInput(ANIMATION_TEMPLATE_IDS[0], ANIMATION_TEMPLATE_IDS.map((id) => [id, t(`widgetEditor.animationTemplate.${id}`)]), { onInput: () => {}, onCommit: () => {} });
    const apply = node('button', 'secondary', t('widgetEditor.animationTemplateApply'));
    apply.type = 'button';
    apply.addEventListener('click', () => onAnimationTemplate(picker.value));
    return section(t('widgetEditor.animationTemplateTitle'), field(t('widgetEditor.animationTemplatePick'), picker), apply, node('p', 'empty', t('widgetEditor.animationTemplateHint')));
  }

  function renderElement(element, assets) {
    const set = (key, transform = (value) => value) => bind((value, options) => onElement(value === undefined ? {} : { [key]: transform(value) }, options));
    // Para un campo dentro de un objeto (`border.width`): se parte del objeto actual, no del que se pintó.
    const nested = (key, build) => bind((value, options) => onElement(value === undefined ? {} : (current) => ({ [key]: build(current[key], value) }), options));
    const rebuild = (key, build) => (value) => onRebuild((current) => ({ [key]: build(current[key], value) }));

    const head = section(
      `${t(`widgetEditor.type.${element.type}`)} · ${element.id}`,
      checkbox(element.visible, t('widgetEditor.visible'), set('visible')),
      checkbox(element.locked, t('widgetEditor.locked'), set('locked')),
    );

    const grid = node('div', 'we-grid');
    grid.append(
      field('X', numberInput(element.x, LIMITS.position, set('x'))),
      field('Y', numberInput(element.y, LIMITS.position, set('y'))),
      field(t('widgetEditor.width'), numberInput(element.width, LIMITS.size, set('width'))),
      field(t('widgetEditor.height'), numberInput(element.height, LIMITS.size, set('height'))),
      field(t('widgetEditor.rotation'), numberInput(element.rotation, [-360, 360], set('rotation'))),
      field(t('widgetEditor.opacity'), numberInput(Math.round(element.opacity * 100), [0, 100], set('opacity', (value) => value / 100))),
    );
    const align = node('div', 'we-align');
    for (const target of ALIGN_TARGETS) {
      const button = node('button', 'secondary', t(`widgetEditor.align.${target}`));
      button.type = 'button';
      button.addEventListener('click', () => onAlign(target));
      align.append(button);
    }
    const geometry = section(t('widgetEditor.geometry'), grid, node('span', 'we-label', t('widgetEditor.alignTitle')), align);

    root.append(head, geometry);
    for (const part of TYPE_SECTIONS[element.type]?.({ element, set, nested, rebuild, assets }) ?? []) root.append(part);
    root.append(animationSection(element, nested));
  }

  // Entrada, salida y bucle. Cada una elige un preset del catálogo; sus tiempos solo salen si hay preset.
  function animationSection(element, nested) {
    const { animation } = element;
    const slotNested = (slot, key) => nested('animation', (current, value) => ({ ...current, [slot]: { ...current[slot], [key]: value } }));
    const presetPicker = (slot, presets, labelKey) => field(
      t(`widgetEditor.animationSlot.${slot}`),
      selectInput(animation[slot].preset, presets.map((preset) => [preset, t(`widgetEditor.${labelKey}.${preset}`)]), {
        onInput: (preset) => onRebuild((current) => ({ animation: { ...current.animation, [slot]: { ...current.animation[slot], preset } } })),
        onCommit: () => {},
      }),
    );

    const parts = [];
    for (const slot of ['in', 'out']) {
      parts.push(presetPicker(slot, ENTER_PRESETS, 'animationPreset'));
      if (animation[slot].preset === 'none') continue;

      const grid = node('div', 'we-grid');
      grid.append(
        field(t('widgetEditor.animationDuration'), numberInput(animation[slot].duration, LIMITS.animationDuration, { step: 50, ...slotNested(slot, 'duration') })),
        field(t('widgetEditor.animationDelay'), numberInput(animation[slot].delay, LIMITS.animationDelay, { step: 50, ...slotNested(slot, 'delay') })),
      );
      parts.push(grid, field(t('widgetEditor.animationEasing'), selectInput(animation[slot].easing, Object.keys(EASINGS).map((key) => [key, t(`widgetEditor.easing.${key}`)]), slotNested(slot, 'easing'))));
    }

    parts.push(presetPicker('loop', LOOP_PRESETS, 'animationLoop'));
    if (animation.loop.preset !== 'none') {
      parts.push(field(t('widgetEditor.animationLoopDuration'), numberInput(animation.loop.duration, LIMITS.loopDuration, { step: 100, ...slotNested('loop', 'duration') })));
    }
    return section(t('widgetEditor.animationSection'), ...parts);
  }

  // Forma, relleno, borde y sombra: lo que tienen en común la caja y la imagen.
  function surfaceSections({ element, nested, rebuild, assets }) {
    const { shape, fill, border, shadow } = element;
    const { variants } = SHAPES[shape.type];

    // `selectInput` llama a `onInput` y luego a `onCommit`: aquí todo lo hace `onRebuild`, que ya anota el cambio.
    const shapeFields = [
      field(t('widgetEditor.shapeTitle'), selectInput(shape.type, SHAPE_TYPES.map((type) => [type, t(`widgetEditor.shape.${type}`)]), {
        onInput: (type) => onRebuild((current) => ({ shape: { ...current.shape, type, variant: SHAPES[type].variants[0] ?? null } })),
        onCommit: () => {},
      })),
    ];
    if (variants.length > 0) {
      shapeFields.push(field(t('widgetEditor.variantTitle'), selectInput(shape.variant ?? variants[0], variants.map((variant) => [variant, t(`widgetEditor.variant.${shape.type}.${variant}`)]), {
        onInput: rebuild('shape', (current, variant) => ({ ...current, variant })),
        onCommit: () => {},
      })));
    }
    if (shape.type === 'rect') {
      shapeFields.push(field(t('widgetEditor.radius'), numberInput(shape.radius, LIMITS.radius, nested('shape', (current, radius) => ({ ...current, radius })))));
    }

    const fillFields = [
      field(t('widgetEditor.fillType'), selectInput(fill.type, FILL_TYPES.map((type) => [type, t(`widgetEditor.fillKind.${type}`)]), {
        onInput: (type) => onRebuild((current) => ({ fill: fillFor(type, current.fill) })),
        onCommit: () => {},
      })),
    ];
    if (fill.type === 'solid') {
      fillFields.push(field(t('widgetEditor.color'), colorInput(fill.color, nested('fill', (current, color) => ({ ...current, color })))));
    } else if (fill.type === 'linear' || fill.type === 'radial') {
      if (fill.type === 'linear') {
        fillFields.push(field(t('widgetEditor.angle'), numberInput(fill.angle, [0, 360], nested('fill', (current, angle) => ({ ...current, angle })))));
      }
      fillFields.push(...stopsEditor(fill, nested));
    } else if (fill.type === 'image') {
      fillFields.push(...imageFields(fill, nested, assets));
    }

    const borderFields = [
      field(t('widgetEditor.borderWidth'), numberInput(border.width, LIMITS.borderWidth, nested('border', (current, width) => ({ ...current, width })))),
    ];
    if (border.width > 0) {
      borderFields.push(
        field(t('widgetEditor.color'), colorInput(border.color, nested('border', (current, color) => ({ ...current, color })))),
        field(t('widgetEditor.borderStyle'), selectInput(border.style, BORDER_STYLES.map((style) => [style, t(`widgetEditor.borderKind.${style}`)]), nested('border', (current, style) => ({ ...current, style })))),
      );
    }

    return [
      section(t('widgetEditor.shapeSection'), ...shapeFields),
      section(t('widgetEditor.fillSection'), ...fillFields),
      section(t('widgetEditor.borderSection'), ...borderFields),
      section(t('widgetEditor.shadowSection'), ...shadowFields(shadow, nested)),
    ];
  }

  // Sombra con interruptor: lo usan las superficies (`shadow`) y los textos.
  function shadowFields(shadow, nested) {
    const fields = [checkbox(shadow.enabled, t('widgetEditor.shadowEnabled'), {
      onInput: () => {},
      onCommit: () => onRebuild((current) => ({ shadow: { ...current.shadow, enabled: !current.shadow.enabled } })),
    })];
    if (shadow.enabled) {
      const grid = node('div', 'we-grid');
      grid.append(
        field('X', numberInput(shadow.x, LIMITS.shadowOffset, nested('shadow', (current, x) => ({ ...current, x })))),
        field('Y', numberInput(shadow.y, LIMITS.shadowOffset, nested('shadow', (current, y) => ({ ...current, y })))),
        field(t('widgetEditor.shadowBlur'), numberInput(shadow.blur, LIMITS.shadowBlur, nested('shadow', (current, blur) => ({ ...current, blur })))),
      );
      fields.push(grid, field(t('widgetEditor.color'), colorInput(shadow.color, nested('shadow', (current, color) => ({ ...current, color })))));
    }
    return fields;
  }

  // Al cambiar de tipo de relleno se parte del valor por defecto de ese tipo, salvo la imagen y el ajuste, que se conservan.
  function fillFor(type, current) {
    const next = structuredClone(DEFAULT_FILLS[type]);
    if (type === 'image' && current.type === 'image') return current;
    if (type === 'solid' && current.stops) next.color = current.stops[0].color;
    if ((type === 'linear' || type === 'radial') && current.type === 'solid') next.stops[0].color = current.color;
    return next;
  }

  function stopsEditor(fill, nested, key = 'fill') {
    const rows = fill.stops.map((stop, index) => {
      const row = node('div', 'we-stop');
      const update = (build) => nested(key, (current, value) => ({ ...current, stops: current.stops.map((item, i) => (i === index ? build(item, value) : item)) }));
      const color = colorInput(stop.color, update((item, value) => ({ ...item, color: value })));
      const offset = numberInput(Math.round(stop.offset * 100), [0, 100], update((item, value) => ({ ...item, offset: value / 100 })));
      offset.title = t('widgetEditor.stopOffset');
      offset.setAttribute('aria-label', t('widgetEditor.stopOffset'));

      const remove = node('button', 'secondary', '×');
      remove.type = 'button';
      remove.title = t('widgetEditor.removeStop');
      remove.setAttribute('aria-label', t('widgetEditor.removeStop'));
      remove.disabled = fill.stops.length <= LIMITS.gradientStops[0];
      remove.addEventListener('click', () => onRebuild((current) => ({ [key]: { ...current[key], stops: current[key].stops.filter((_, i) => i !== index) } })));

      row.append(color, offset, remove);
      return row;
    });

    const add = node('button', 'secondary', t('widgetEditor.addStop'));
    add.type = 'button';
    add.disabled = fill.stops.length >= LIMITS.gradientStops[1];
    add.addEventListener('click', () => onRebuild((current) => {
      const { stops } = current[key];
      const last = stops.at(-1);
      // El color nuevo va al final, a medio camino entre el último y el borde.
      return { [key]: { ...current[key], stops: [...stops, { offset: Math.min(1, (last.offset + 1) / 2 || 1), color: last.color }] } };
    }));

    return [node('span', 'we-label', t('widgetEditor.stops')), ...rows, add];
  }

  function imageFields(fill, nested, assets) {
    const picker = selectInput(fill.asset ?? '', [['', t('widgetEditor.imageNone')], ...assets.filter((asset) => asset.type.startsWith('image/')).map((asset) => [asset.id, asset.name])], {
      onInput: (id) => onRebuild((current) => ({ fill: { ...current.fill, asset: id || null } })),
      onCommit: () => {},
    });

    const input = node('input');
    Object.assign(input, { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
    input.addEventListener('change', () => {
      if (input.files[0]) onUpload(input.files[0], 'image');
      input.value = '';
    });
    const upload = node('button', 'secondary', t('widgetEditor.upload'));
    upload.type = 'button';
    upload.addEventListener('click', () => input.click());

    const remove = node('button', 'secondary', t('widgetEditor.deleteImage'));
    remove.type = 'button';
    remove.disabled = !fill.asset;
    remove.addEventListener('click', () => onDeleteAsset(fill.asset));

    const buttons = node('div', 'we-align');
    buttons.append(upload, remove, input);
    return [
      field(t('widgetEditor.image'), picker),
      buttons,
      field(t('widgetEditor.fit'), selectInput(fill.fit, IMAGE_FITS.map((fit) => [fit, t(`widgetEditor.fitKind.${fit}`)]), nested('fill', (current, fit) => ({ ...current, fit })))),
    ];
  }

  function fontPicker(element, assets) {
    const uploaded = assets.filter((asset) => asset.type.startsWith('font/'));
    const options = [
      ...FONT_KEYS.map((key) => [key, key === SYSTEM_FONT ? t('widgetEditor.fontSystem') : FONTS[key].label]),
      ...uploaded.map((asset) => [asset.id, `${asset.name} ${t('widgetEditor.fontUploaded')}`]),
    ];
    const picker = selectInput(element.fontFamily, options, { onInput: (value) => onRebuild(() => ({ fontFamily: value })), onCommit: () => {} });

    const input = node('input');
    Object.assign(input, { type: 'file', accept: '.woff2,.ttf,.otf', hidden: true });
    input.addEventListener('change', () => {
      if (input.files[0]) onUpload(input.files[0], 'font');
      input.value = '';
    });
    const upload = node('button', 'secondary', t('widgetEditor.uploadFont'));
    upload.type = 'button';
    upload.addEventListener('click', () => input.click());

    const remove = node('button', 'secondary', t('widgetEditor.deleteFont'));
    remove.type = 'button';
    remove.disabled = !uploaded.some((asset) => asset.id === element.fontFamily);
    remove.addEventListener('click', () => onDeleteAsset(element.fontFamily));

    const buttons = node('div', 'we-align');
    buttons.append(upload, remove, input);
    const group = node('div', 'we-group');
    group.append(field(t('widgetEditor.fontFamily'), picker), buttons);
    return group;
  }

  const TYPE_SECTIONS = {
    text({ element, set, nested, assets }) {
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
        ...(element.overflow === 'marquee' ? [] : [field(t('widgetEditor.maxLines'), numberInput(element.maxLines, LIMITS.maxLines, set('maxLines')))]),
        field(t('widgetEditor.fontWeight'), selectInput(element.fontWeight, FONT_WEIGHTS.map((weight) => [weight, String(weight)]), set('fontWeight', Number))),
        field(t('widgetEditor.textAlignTitle'), selectInput(element.align, ALIGNMENTS.map((value) => [value, t(`widgetEditor.textAlign.${value}`)]), set('align'))),
        field(t('widgetEditor.textValignTitle'), selectInput(element.valign, VERTICAL_ALIGNMENTS.map((value) => [value, t(`widgetEditor.textValign.${value}`)]), set('valign'))),
      );
      const textStyle = node('div', 'we-grid');
      textStyle.append(
        field(t('widgetEditor.lineHeight'), numberInput(element.lineHeight, LIMITS.lineHeight, { step: 0.1, ...set('lineHeight') })),
        field(t('widgetEditor.letterSpacing'), numberInput(element.letterSpacing, LIMITS.letterSpacing, { step: 0.5, ...set('letterSpacing') })),
      );
      const flags = node('div', 'we-flags');
      flags.append(checkbox(element.italic, t('widgetEditor.italic'), set('italic')), checkbox(element.uppercase, t('widgetEditor.uppercase'), set('uppercase')));

      // `maxLines` solo cuenta al recortar: con rótulo el texto va en una línea.
      const overflow = field(t('widgetEditor.overflow'), selectInput(element.overflow, OVERFLOWS.map((value) => [value, t(`widgetEditor.overflowKind.${value}`)]), {
        onInput: (value) => onRebuild(() => ({ overflow: value })),
        onCommit: () => {},
      }));

      const gradientToggle = checkbox(Boolean(element.gradient), t('widgetEditor.textGradient'), {
        onInput: () => {},
        onCommit: () => onRebuild((current) => ({ gradient: current.gradient ? null : { ...structuredClone(DEFAULT_TEXT_GRADIENT), stops: [{ offset: 0, color: current.color }, DEFAULT_TEXT_GRADIENT.stops[1]] } })),
      });
      const colorFields = element.gradient
        ? [gradientToggle, field(t('widgetEditor.angle'), numberInput(element.gradient.angle, [0, 360], nested('gradient', (current, angle) => ({ ...current, angle })))), ...stopsEditor(element.gradient, nested, 'gradient')]
        : [field(t('widgetEditor.color'), colorInput(element.color, set('color'))), gradientToggle];

      const outline = [
        field(t('widgetEditor.outlineWidth'), numberInput(element.outline.width, LIMITS.outlineWidth, nested('outline', (current, width) => ({ ...current, width })))),
        ...(element.outline.width > 0 ? [field(t('widgetEditor.color'), colorInput(element.outline.color, nested('outline', (current, color) => ({ ...current, color }))))] : []),
      ];

      return [
        section(t('widgetEditor.textTitle'), field(t('widgetEditor.template'), template), variables, grid, overflow),
        section(t('widgetEditor.fontSection'), fontPicker(element, assets), flags, textStyle),
        section(t('widgetEditor.textColorSection'), ...colorFields),
        section(t('widgetEditor.outlineSection'), ...outline),
        section(t('widgetEditor.shadowSection'), ...shadowFields(element.shadow, nested)),
      ];
    },

    progress({ element, set }) {
      return [section(
        t('widgetEditor.progressTitle'),
        field(t('widgetEditor.color'), colorInput(element.color, set('color'))),
        field(t('widgetEditor.track'), colorInput(element.track, set('track'))),
        field(t('widgetEditor.radius'), numberInput(element.radius, LIMITS.radius, set('radius'))),
      )];
    },

    disc({ element, set }) {
      return [section(t('widgetEditor.discTitle'), field(t('widgetEditor.accent'), colorInput(element.accent, set('accent'))))];
    },

    box: (context) => surfaceSections(context),
    image: (context) => surfaceSections(context),
  };

  return { render };
}
