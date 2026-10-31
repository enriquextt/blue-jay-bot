// Plantillas de animación: con un clic ponen entrada y salida a todos los elementos, escalonadas (cada uno empieza
// un poco después del anterior). No tocan las animaciones en bucle.
//   enter / exit: preset de entrada y de salida; duration: ms; step: ms de diferencia entre un elemento y el siguiente.
export const ANIMATION_TEMPLATES = {
  none: { enter: 'none', exit: 'none', duration: 500, step: 0 },
  fade: { enter: 'fade', exit: 'fade', duration: 400, step: 0 },
  'slide-stagger': { enter: 'slide-left', exit: 'slide-right', duration: 500, step: 80 },
  reveal: { enter: 'reveal', exit: 'reveal', duration: 600, step: 100 },
  'zoom-soft': { enter: 'zoom', exit: 'zoom', duration: 500, step: 70 },
  pop: { enter: 'pop', exit: 'zoom', duration: 500, step: 90, easing: 'bounce' },
};

export const ANIMATION_TEMPLATE_IDS = Object.keys(ANIMATION_TEMPLATES);

// Devuelve los elementos con la animación de la plantilla. La entrada va de atrás hacia delante (el fondo primero) y
// la salida al revés, más deprisa, para que el diseño se deshaga en orden inverso.
export function applyAnimationTemplate(elements, id) {
  const template = ANIMATION_TEMPLATES[id];
  if (!template) return elements;

  const last = elements.length - 1;
  return elements.map((element, index) => ({
    ...element,
    animation: {
      ...element.animation,
      in: { preset: template.enter, duration: template.duration, delay: index * template.step, easing: template.easing ?? 'ease-out' },
      out: { preset: template.exit, duration: Math.round(template.duration * 0.7), delay: Math.round((last - index) * template.step * 0.6), easing: 'ease-in-out' },
    },
  }));
}
