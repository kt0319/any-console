// @ts-check
import { openTabs, activeTabId, terminalSettings, TERMINAL_SETTINGS_SCHEMA, setTerminalSetting, splitMode, sanitizeTerminalSetting, resetTerminalSettings } from './state-core.js';
import { escapeHtml, refitTerminalWithFocus, $ } from './utils.js';
import { rebuildSplitLayout } from './terminal-split.js';
import { showSettingsView } from './settings.js';
import { updateSettingsConnInfo } from './auth.js';

/**
 */
export function applyAllTerminalSettingsToTabs() {
  let needsRefit = false;
  for (const [key, schema] of Object.entries(TERMINAL_SETTINGS_SCHEMA)) {
    if (schema.requiresRefit) needsRefit = true;
    for (const tab of openTabs) {
      if (tab.type !== "terminal" || !tab.term) continue;
      tab.term.options[key] = terminalSettings[key];
    }
  }
  requestAnimationFrame(() => {
    if (needsRefit && splitMode) {
      rebuildSplitLayout();
      return;
    }
    if (needsRefit) {
      const activeTerminal = openTabs.find((t) => t.id === activeTabId && t.type === "terminal");
      if (activeTerminal) refitTerminalWithFocus(activeTerminal);
    }
  });
}

/**
 * @param {string} key
 * @param {any} value
 * @returns {any}
 */
export function applyTerminalSettingToTabs(key, value) {
  const next = setTerminalSetting(key, value);
  if (next == null) return null;
  const schema = TERMINAL_SETTINGS_SCHEMA[key];
  for (const tab of openTabs) {
    if (tab.type !== "terminal" || !tab.term) continue;
    tab.term.options[key] = next;
  }
  requestAnimationFrame(() => {
    if (schema?.requiresRefit && splitMode) {
      rebuildSplitLayout();
      return;
    }
    if (schema?.requiresRefit) {
      const activeTerminal = openTabs.find((t) => t.id === activeTabId && t.type === "terminal");
      if (activeTerminal) {
        refitTerminalWithFocus(activeTerminal);
      }
    }
  });
  return next;
}

/**
 * @param {string} key
 * @param {object} schema
 * @returns {HTMLElement}
 */
export function createTerminalNumberSettingRow(key, schema) {
  const row = document.createElement("div");
  row.className = "terminal-settings-item";

  const header = document.createElement("div");
  header.className = "terminal-settings-item-header";
  header.innerHTML = `<span class="terminal-settings-item-label">${escapeHtml(schema.label)}</span>`;
  row.appendChild(header);

  const controlRow = document.createElement("div");
  controlRow.className = "terminal-settings-control-row";

  const minusBtn = document.createElement("button");
  minusBtn.type = "button";
  minusBtn.className = "terminal-font-size-step-btn";
  minusBtn.textContent = "-";
  controlRow.appendChild(minusBtn);

  const number = document.createElement("input");
  number.type = "number";
  number.id = `terminal-setting-${key}`;
  number.className = "form-input terminal-font-size-input";
  number.min = String(schema.min);
  number.max = String(schema.max);
  number.step = String(schema.step || 1);
  number.value = String(terminalSettings[key]);
  number.inputMode = "numeric";
  controlRow.appendChild(number);

  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.className = "terminal-font-size-step-btn";
  plusBtn.textContent = "+";
  controlRow.appendChild(plusBtn);

  row.appendChild(controlRow);

  const value = document.createElement("div");
  value.className = "terminal-settings-value";
  row.appendChild(value);

  if (schema.note) {
    const note = document.createElement("div");
    note.className = "terminal-settings-note";
    note.textContent = schema.note;
    row.appendChild(note);
  }

  const sync = (settingValue) => {
    const clamped = sanitizeTerminalSetting(key, settingValue);
    value.textContent = schema.unit ? `${clamped}${schema.unit}` : String(clamped);
    number.value = String(clamped);
    minusBtn.disabled = clamped <= schema.min;
    plusBtn.disabled = clamped >= schema.max;
  };

  const commit = (rawValue) => {
    const next = applyTerminalSettingToTabs(key, rawValue);
    if (next != null) sync(next);
  };

  minusBtn.addEventListener("click", () => commit(terminalSettings[key] - (schema.step || 1)));
  plusBtn.addEventListener("click", () => commit(terminalSettings[key] + (schema.step || 1)));
  number.addEventListener("change", () => commit(number.value));
  number.addEventListener("blur", () => sync(number.value || terminalSettings[key]));

  sync(terminalSettings[key]);
  return row;
}

/**
 * @param {string} key
 * @param {object} schema
 * @returns {HTMLElement}
 */
export function createTerminalBooleanSettingRow(key, schema) {
  const row = document.createElement("label");
  row.className = "terminal-settings-item terminal-settings-toggle";

  const text = document.createElement("div");
  text.className = "terminal-settings-toggle-copy";
  text.innerHTML =
    `<span class="terminal-settings-item-label">${escapeHtml(schema.label)}</span>` +
    (schema.note ? `<span class="terminal-settings-note">${escapeHtml(schema.note)}</span>` : "");
  row.appendChild(text);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !!terminalSettings[key];
  checkbox.addEventListener("change", () => {
    checkbox.checked = !!applyTerminalSettingToTabs(key, checkbox.checked);
  });
  row.appendChild(checkbox);

  return row;
}

/**
 * @param {HTMLElement} container
 */
export function renderTerminalSettingsPane(container) {
  container.innerHTML = "";

  const section = document.createElement("div");
  section.className = "terminal-settings-view";
  for (const [key, schema] of Object.entries(TERMINAL_SETTINGS_SCHEMA)) {
    if (schema.type === "number") {
      section.appendChild(createTerminalNumberSettingRow(key, schema));
      continue;
    }
    if (schema.type === "boolean") {
      section.appendChild(createTerminalBooleanSettingRow(key, schema));
    }
  }

  const actions = document.createElement("div");
  actions.className = "terminal-settings-actions";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "terminal-settings-reset-btn";
  resetBtn.textContent = "初期値に戻す";
  resetBtn.addEventListener("click", () => {
    resetTerminalSettings();
    applyAllTerminalSettingsToTabs();
    renderTerminalSettingsPane(container);
  });
  actions.appendChild(resetBtn);
  section.appendChild(actions);
  container.appendChild(section);
}

/**
 */
export function openTerminalSettings() {
  $("settings-modal").querySelector(".modal-title").textContent = "ターミナル";
  updateSettingsConnInfo();
  showSettingsView("settings-terminal-view");
  renderTerminalSettingsPane($("settings-terminal-body"));
  $("settings-modal").style.display = "flex";
}
