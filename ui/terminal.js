// @ts-check
import { openTabs, activeTabId, isTouchDevice, panelBottom, splitMode, setOpenTabs } from './state-core.js';
import { $, safeFit, refitTerminalWithFocus, setFrameVisible } from './utils.js';
import { connectTerminalWs, ensureTerminalOpened } from './terminal-connection.js';
import { addTerminalTab, switchTab, tabDisplayName, removeTab, persistOpenTabs, renderTabBar } from './terminal-tabs.js';
import { exitAllViewModes } from './terminal-view-mode.js';
import { uploadClipboardImage } from './quick-input-keys.js';

/** @type {{ btn: HTMLElement, tab: object, placeholder: HTMLElement, bar: HTMLElement, barRect: DOMRect, offsetX: number, startX: number, moved: boolean, isTouch: boolean } | null} */
export let tabDragState = null;

/**
 * Binds mouse drag behavior to a tab button for reordering.
 * @param {HTMLElement} btn - The tab button element.
 * @param {object} tab - The tab data object.
 */
export function bindMouseDrag(btn, tab) {
  const DRAG_THRESHOLD = 5;
  let startX = 0;
  let mouseDown = false;
  btn.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains("tab-close")) return;
    startX = e.clientX;
    mouseDown = true;
    const onMove = (me) => {
      if (!mouseDown) return;
      if (Math.abs(me.clientX - startX) > DRAG_THRESHOLD) {
        mouseDown = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        startTabDrag(btn, tab, { clientX: startX });
      }
    };
    const onUp = () => {
      mouseDown = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

/**
 * Initiates a tab drag operation.
 * @param {HTMLElement} btn - The tab button being dragged.
 * @param {object} tab - The tab data object.
 * @param {{ clientX: number, touches?: TouchList }} pointer - Pointer event info.
 */
export function startTabDrag(btn, tab, pointer) {
  const bar = $("tab-bar");
  const rect = btn.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();

  const placeholder = document.createElement("div");
  placeholder.className = "tab-drag-placeholder";
  placeholder.style.width = rect.width + "px";
  placeholder.style.height = rect.height + "px";
  btn.parentNode.insertBefore(placeholder, btn);

  btn.classList.add("tab-dragging");
  btn.style.position = "fixed";
  btn.style.top = rect.top + "px";
  btn.style.left = rect.left + "px";
  btn.style.width = rect.width + "px";
  btn.style.zIndex = "100";

  const offsetX = pointer.clientX - rect.left;
  const isTouch = !!pointer.touches;

  tabDragState = {
    btn,
    tab,
    placeholder,
    bar,
    barRect,
    offsetX,
    startX: pointer.clientX,
    moved: false,
    isTouch,
  };

  navigator.vibrate?.(30);

  if (isTouch) {
    document.addEventListener("touchmove", onTabDragMove, { capture: true, passive: false });
    document.addEventListener("touchend", onTabDragEnd, { capture: true });
  } else {
    document.addEventListener("mousemove", onTabDragMove, { capture: true });
    document.addEventListener("mouseup", onTabDragEnd, { capture: true });
  }
}

/**
 * Extracts the clientX value from a mouse or touch event.
 * @param {MouseEvent | TouchEvent} e - The pointer event.
 * @returns {number} The clientX coordinate.
 */
export function getPointerXFromEvent(e) {
  return e.touches ? e.touches[0].clientX : e.clientX;
}

/**
 * Handles pointer move events during a tab drag operation.
 * @param {MouseEvent | TouchEvent} e - The pointer move event.
 */
export function onTabDragMove(e) {
  if (!tabDragState) return;
  e.preventDefault();
  const clientX = getPointerXFromEvent(e);
  const { btn, bar, barRect, offsetX } = tabDragState;

  const dx = Math.abs(clientX - tabDragState.startX);
  if (dx > 5) tabDragState.moved = true;

  btn.style.left = (clientX - offsetX) + "px";

  const siblings = Array.from(bar.querySelectorAll(".tab-btn:not(.tab-dragging), .tab-drag-placeholder"));
  for (const sib of siblings) {
    if (sib === tabDragState.placeholder) continue;
    if (sib.classList.contains("tab-add-btn") || sib.classList.contains("split-toggle-btn")) continue;
    const sibRect = sib.getBoundingClientRect();
    const sibCenter = sibRect.left + sibRect.width / 2;
    if (clientX < sibCenter) {
      bar.insertBefore(tabDragState.placeholder, sib);
      return;
    }
  }
  const lastNonUtil = [...bar.querySelectorAll(".tab-btn:not(.tab-dragging):not(.tab-add-btn):not(.split-toggle-btn), .tab-drag-placeholder")].pop();
  if (lastNonUtil && lastNonUtil !== tabDragState.placeholder) {
    lastNonUtil.after(tabDragState.placeholder);
  }

  const SCROLL_ZONE = 40;
  if (clientX - barRect.left < SCROLL_ZONE) {
    bar.scrollLeft -= 10;
  } else if (barRect.right - clientX < SCROLL_ZONE) {
    bar.scrollLeft += 10;
  }
}

/**
 * Handles pointer up/end events to finalize a tab drag operation.
 * @param {MouseEvent | TouchEvent} e - The pointer end event.
 */
export function onTabDragEnd(e) {
  if (!tabDragState) return;
  const { btn, tab, placeholder, bar, moved, isTouch } = tabDragState;

  if (isTouch) {
    document.removeEventListener("touchmove", onTabDragMove, { capture: true });
    document.removeEventListener("touchend", onTabDragEnd, { capture: true });
  } else {
    document.removeEventListener("mousemove", onTabDragMove, { capture: true });
    document.removeEventListener("mouseup", onTabDragEnd, { capture: true });
  }

  if (!moved && panelBottom) {
    btn.classList.remove("tab-dragging");
    btn.style.position = "";
    btn.style.top = "";
    btn.style.left = "";
    btn.style.width = "";
    btn.style.zIndex = "";
    placeholder.remove();
    tabDragState = null;
    const tabName = tabDisplayName(tab) || btn.textContent.replace("×", "").trim();
    if (confirm(`「${tabName}」を閉じますか？`)) {
      removeTab(tab.id);
    }
    return;
  }

  if (moved) {
    const ordered = Array.from(bar.querySelectorAll(".tab-btn:not(.tab-dragging):not(.tab-add-btn):not(.split-toggle-btn), .tab-drag-placeholder"));
    const reordered = [];
    for (const el of ordered) {
      if (el === placeholder) {
        reordered.push(tab);
        continue;
      }
      const tabId = el.dataset.tab;
      if (!tabId) continue;
      const t = openTabs.find((t) => t.id === tabId);
      if (t) reordered.push(t);
    }
    setOpenTabs(reordered);
    persistOpenTabs();
  }

  btn.classList.remove("tab-dragging");
  btn.style.position = "";
  btn.style.top = "";
  btn.style.left = "";
  btn.style.width = "";
  btn.style.zIndex = "";
  placeholder.remove();
  tabDragState = null;
  renderTabBar();
}

document.addEventListener("paste", (e) => {
  const el = document.activeElement;
  const isInput = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  const isXtermTextarea = isInput && el.closest(".xterm");
  if (isInput && !isXtermTextarea) return;
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return;
  const items = e.clipboardData && e.clipboardData.items;
  if (items) {
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        e.stopPropagation();
        const file = item.getAsFile();
        if (file) uploadClipboardImage(file);
        return;
      }
    }
  }
  if (isXtermTextarea) return;
  e.preventDefault();
  e.stopPropagation();
  const text = e.clipboardData.getData("text");
  if (text && activeTab.ws && activeTab.ws.readyState === WebSocket.OPEN) {
    const bracketedPaste = "\x1b[200~" + text + "\x1b[201~";
    activeTab.ws.send(new TextEncoder().encode(bracketedPaste));
  }
}, true);
