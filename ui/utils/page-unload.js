export function shouldConfirmBeforeUnload(openTabs) {
  return Array.isArray(openTabs) && openTabs.length > 0;
}

export function handleBeforeUnload(event, openTabs) {
  if (!shouldConfirmBeforeUnload(openTabs)) return false;
  event?.preventDefault?.();
  if (event) event.returnValue = "";
  return true;
}
