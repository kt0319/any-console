const bus = new EventTarget();

export function emit(event, detail) {
  bus.dispatchEvent(new CustomEvent(event, { detail }));
}

export function on(event, handler) {
  const wrapper = (e) => handler(e.detail);
  bus.addEventListener(event, wrapper);
  return () => bus.removeEventListener(event, wrapper);
}
