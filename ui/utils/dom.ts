export function isEditableTarget(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

export function isEditableOrDialogTarget(el: HTMLElement | null) {
  if (!el) return false;
  if (isEditableTarget(el)) return true;
  return !!el.closest?.("[role='dialog']");
}

export function restartTapBounce(el: HTMLElement) {
  el.classList.remove("tap-bounce");
  void el.offsetWidth; // reflow を挟まないとアニメーションが再始動しない
  el.classList.add("tap-bounce");
}
