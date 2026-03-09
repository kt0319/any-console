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

  return {
    start,
    cancel,
    reset,
    isFired,
    consumeFired,
  };
}
