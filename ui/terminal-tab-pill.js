function createTabNamePill(tab, frame) {
  const pill = document.createElement("div");
  pill.className = "tab-name-pill" + (tab._activity ? " tab-activity" : "");
  const info = document.createElement("span");
  info.className = "tab-name-pill-info";
  info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tab.label || "");
  pill.appendChild(info);
  let pillDragging = false;

  bindLongPress(pill, {
    onLongPress: () => {
      if (pillDragging) return;
      if (tab.type === "terminal") {
        const f = $(`frame-${tab.id}`);
        if (f && f.classList.contains("view-mode")) {
          exitTerminalViewMode(tab.id);
        } else {
          tab.term && tab.term.scrollToBottom();
          enterTerminalViewMode(tab.id);
        }
      }
    },
    onClick: () => {
      if (pillDragging) return;
      if (tab.type === "terminal") {
        const f = $(`frame-${tab.id}`);
        if (f && f.classList.contains("view-mode")) {
          exitTerminalViewMode(tab.id);
          return;
        }
      }
      openTabEditModal("open");
    },
  });
  pill.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openTabEditModal("layout");
  });
  pill.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (splitMode) {
      exitSplitModeWithTab(tab.id);
    } else {
      switchTab(tab.id);
    }
  });

  if (!isTouchDevice) {
    pill.draggable = true;
    pill.addEventListener("dragstart", (e) => {
      if (openTabs.length < 2) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("text/plain", tab.id);
      e.dataTransfer.effectAllowed = "move";
      pill.classList.add("dragging");
      requestAnimationFrame(() => showSplitDropZones(tab.id));
    });
    pill.addEventListener("dragend", () => {
      pill.classList.remove("dragging");
      hideSplitDropZones();
    });
  }

  {
    const DRAG_THRESHOLD = 15;
    let touchStartX = 0, touchStartY = 0;
    let touchMoved = false;
    pill.addEventListener("touchstart", (e) => {
      pillDragging = false;
      touchMoved = false;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    pill.addEventListener("touchmove", (e) => {
      if (openTabs.length < 2) return;
      e.preventDefault();
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      touchMoved = true;
      if (!pillDragging && dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        pillDragging = true;
        pill.classList.add("dragging");
        showSplitDropZones(tab.id);
      }
      if (pillDragging) {
        const overlay = document.querySelector(".split-drop-overlay");
        if (overlay) {
          const touch = e.touches[0];
          const oRect = overlay.getBoundingClientRect();
          const tx = Math.max(oRect.left, Math.min(oRect.right, touch.clientX));
          const ty = Math.max(oRect.top, Math.min(oRect.bottom, touch.clientY));
          overlay.querySelectorAll(".split-drop-zone").forEach((z) => {
            const r = z.getBoundingClientRect();
            z.classList.toggle("drag-over",
              tx >= r.left && tx <= r.right && ty >= r.top && ty <= r.bottom);
          });
        }
      }
    }, { passive: false });
    pill.addEventListener("touchend", (e) => {
      if (!pillDragging) return;
      e.preventDefault();
      pill.classList.remove("dragging");
      const touch = e.changedTouches[0];
      const overlay = document.querySelector(".split-drop-overlay");
      let dropDir = null;
      if (overlay) {
        const oRect = overlay.getBoundingClientRect();
        const tx = Math.max(oRect.left, Math.min(oRect.right, touch.clientX));
        const ty = Math.max(oRect.top, Math.min(oRect.bottom, touch.clientY));
        for (const z of overlay.querySelectorAll(".split-drop-zone")) {
          const r = z.getBoundingClientRect();
          if (tx >= r.left && tx <= r.right && ty >= r.top && ty <= r.bottom) {
            dropDir = z.className.match(/\bdrop-(left|right|top|bottom|center)\b/)?.[1];
            break;
          }
        }
      }
      hideSplitDropZones();
      if (dropDir) splitWithDrop(tab.id, dropDir);
      setTimeout(() => { pillDragging = false; }, 100);
    });
  }

  frame.appendChild(pill);
}

function refreshTabNamePill(tab) {
  const frame = $(`frame-${tab.id}`);
  if (!frame) return;
  const pill = frame.querySelector(".tab-name-pill");
  if (pill) {
    pill.classList.toggle("tab-activity", !!tab._activity);
  }
  const info = frame.querySelector(".tab-name-pill-info");
  if (info) {
    info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tab.label || "");
  }
}
