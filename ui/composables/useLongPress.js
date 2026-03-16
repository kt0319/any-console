import { ref } from "vue";

export function useLongPress(durationMs = 500) {
  let timer = null;
  let fired = false;

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function reset() {
    cancel();
    fired = false;
  }

  function start(onFire) {
    reset();
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      onFire?.();
    }, durationMs);
  }

  function isFired() {
    return fired;
  }

  function consumeFired() {
    const value = fired;
    fired = false;
    return value;
  }

  const activeEntry = ref(null);
  let menuEl = null;

  function startMenu(e, entry) {
    fired = false;
    const el = e.currentTarget;
    menuEl = el;
    el.classList.add("long-pressing");
    cancel();
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      el.classList.remove("long-pressing");
      el.classList.add("long-pressed");
      activeEntry.value = entry;
    }, durationMs);
  }

  function endMenu() {
    cancel();
    if (menuEl) {
      menuEl.classList.remove("long-pressing");
      if (!fired) {
        menuEl.classList.remove("long-pressed");
      }
      menuEl = null;
    }
  }

  function closeMenu() {
    activeEntry.value = null;
    endMenu();
  }

  function isMenuEl() {
    return menuEl;
  }

  return {
    start,
    cancel,
    reset,
    isFired,
    consumeFired,
    activeEntry,
    startMenu,
    endMenu,
    closeMenu,
    isMenuEl,
  };
}
