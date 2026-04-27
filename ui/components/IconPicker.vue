<template>
  <div>
    <div class="icon-picker-input-row">
      <input
        ref="searchRef"
        v-model="searchQuery"
        type="text"
        class="form-input icon-picker-search"
        placeholder="Search icons / Favicon URL"
        autocomplete="off"
        @input="onSearchInput"
      />
      <div class="icon-picker-favicon-confirm">
        <span class="icon-picker-favicon-preview" v-html="previewHtml"></span>
        <button type="button" class="icon-picker-clear-btn" @click="clearSelection">Clear</button>
        <button type="button" class="icon-picker-upload-btn" @click="triggerUpload">
          <span class="mdi mdi-image-plus"></span> Image
        </button>
        <input
          ref="uploadRef"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          style="display:none"
          @change="handleUpload"
        />
        <button
          type="button"
          class="primary icon-picker-url-ok-btn"
          :disabled="!canSubmit"
          @click="submit"
        >Select</button>
      </div>
    </div>
    <div class="color-palette">
      <button
        v-for="preset in ICON_PRESET_COLORS"
        :key="preset.label"
        type="button"
        class="color-palette-item"
        :class="{ selected: selectedColor === preset.value }"
        :title="preset.label"
        :style="{ background: preset.value || 'var(--text-primary)' }"
        @click="selectColor(preset.value)"
      />
    </div>
    <div ref="gridRef" class="icon-picker-grid">
      <div v-if="loadingIcons" class="icon-picker-loading">Loading...</div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted } from "vue";
import { emit as bridgeEmit } from "../app-bridge.js";
import { useModalView } from "../composables/useModalView.js";
import { renderIconStr } from "../utils/render-icon.js";
import MDI_ICONS from "../utils/mdi-icons.js";

const { modalTitle, viewState, popView } = useModalView();
modalTitle.value = "Icon Picker";

const URL_PATTERN = /^(https?:\/\/|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/;
const ICON_UPLOAD_MAX_SIZE = 512 * 1024;
const ICON_UPLOAD_ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
]);
const VALID_ICON_COLOR = /^#[0-9a-fA-F]{3,6}$/;
const MAX_DISPLAY = 200;

const ICON_PRESET_COLORS = [
  { label: "Default", value: "" },
  { label: "Red", value: "#e53935" },
  { label: "Pink", value: "#d81b60" },
  { label: "Rose", value: "#ec407a" },
  { label: "Purple", value: "#8e24aa" },
  { label: "Deep Purple", value: "#5e35b1" },
  { label: "Indigo", value: "#3949ab" },
  { label: "Blue", value: "#1e88e5" },
  { label: "Cyan", value: "#00acc1" },
  { label: "Teal", value: "#00897b" },
  { label: "Green", value: "#43a047" },
  { label: "Lime", value: "#7cb342" },
  { label: "Yellow", value: "#fdd835" },
  { label: "Amber", value: "#ffb300" },
  { label: "Orange", value: "#fb8c00" },
  { label: "Brown", value: "#6d4c41" },
  { label: "Gray", value: "#757575" },
  { label: "White", value: "#ffffff" },
];

const searchRef = ref(null);
const uploadRef = ref(null);
const gridRef = ref(null);
const searchQuery = ref("");
const selectedIcon = ref(null);
const selectedColor = ref("");
const previewHtml = ref("");
const loadingIcons = ref(false);
const canSubmit = ref(false);
let pendingClear = false;
function looksLikeUrl(text) {
  return URL_PATTERN.test(text);
}

function extractDomain(text) {
  try {
    if (text.startsWith("http://") || text.startsWith("https://")) return new URL(text).hostname;
    return text.split("/")[0];
  } catch {
    return text;
  }
}

function filterIcons(icons, query) {
  if (!query) return icons;
  return icons.filter((name) => name.includes(query));
}

function renderGrid(icons, query) {
  const el = gridRef.value;
  if (!el) return;
  el.innerHTML = "";
  const filtered = filterIcons(icons, query);
  const slice = filtered.slice(0, MAX_DISPLAY);
  for (const name of slice) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-picker-item";
    btn.innerHTML = `<span class="mdi mdi-${name}"></span>`;
    btn.title = name;
    btn.addEventListener("click", () => selectMdiIcon(`mdi-${name}`));
    el.appendChild(btn);
  }
  if (filtered.length > MAX_DISPLAY) {
    const more = document.createElement("div");
    more.className = "icon-picker-more";
    more.textContent = `and ${filtered.length - MAX_DISPLAY} more... use search to filter`;
    el.appendChild(more);
  }
  if (slice.length === 0) {
    const empty = document.createElement("div");
    empty.className = "icon-picker-more";
    empty.textContent = "No matching icons";
    el.appendChild(empty);
  }
}

function selectMdiIcon(iconName) {
  selectedIcon.value = iconName;
  pendingClear = false;
  previewHtml.value = renderIconStr(iconName, selectedColor.value);
  canSubmit.value = true;
  const el = gridRef.value;
  if (el) {
    el.querySelectorAll(".icon-picker-item").forEach((item) => {
      item.classList.toggle("selected", item.title === iconName.replace("mdi-", ""));
    });
  }
}

function selectColor(color) {
  selectedColor.value = color;
  if (selectedIcon.value) {
    previewHtml.value = renderIconStr(selectedIcon.value, color);
  }
}

function onSearchInput() {
  const raw = searchQuery.value.trim();
  selectedIcon.value = null;
  pendingClear = false;
  if (looksLikeUrl(raw)) {
    const domain = extractDomain(raw);
    previewHtml.value = renderIconStr(`favicon:${domain}`, "", 24);
    canSubmit.value = true;
    renderGrid(MDI_ICONS, "");
  } else {
    previewHtml.value = "";
    canSubmit.value = false;
    renderGrid(MDI_ICONS, raw.toLowerCase());
  }
}

function clearSelection() {
  selectedIcon.value = null;
  pendingClear = true;
  searchQuery.value = "";
  previewHtml.value = "";
  canSubmit.value = true;
  const el = gridRef.value;
  if (el) el.querySelectorAll(".icon-picker-item").forEach((item) => item.classList.remove("selected"));
}

function triggerUpload() {
  if (uploadRef.value) {
    uploadRef.value.value = "";
    uploadRef.value.click();
  }
}

async function handleUpload() {
  const file = uploadRef.value?.files?.[0];
  if (!file) return;
  if (!ICON_UPLOAD_ALLOWED_TYPES.has(file.type)) {
    bridgeEmit("toast:show", { message: "Please select a PNG/JPG/GIF/WEBP/SVG image", type: "error" });
    uploadRef.value.value = "";
    return;
  }
  if (file.size > ICON_UPLOAD_MAX_SIZE) {
    bridgeEmit("toast:show", { message: "Image must be 500KB or less", type: "error" });
    uploadRef.value.value = "";
    return;
  }
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      throw new Error("Failed to load image");
    }
    selectedIcon.value = dataUrl;
    pendingClear = false;
    searchQuery.value = "";
    previewHtml.value = renderIconStr(dataUrl, "", 24);
    canSubmit.value = true;
    const el = gridRef.value;
    if (el) el.querySelectorAll(".icon-picker-item").forEach((item) => item.classList.remove("selected"));
  } catch (e) {
    bridgeEmit("toast:show", { message: e.message || "Failed to load image", type: "error" });
  } finally {
    if (uploadRef.value) uploadRef.value.value = "";
  }
}

function submit() {
  const raw = searchQuery.value.trim();
  let icon = "";
  let color = "";
  if (looksLikeUrl(raw)) {
    icon = `favicon:${extractDomain(raw)}`;
  } else if (selectedIcon.value) {
    icon = selectedIcon.value;
    color = icon.startsWith("data:image/") ? "" : selectedColor.value;
  } else if (pendingClear) {
    icon = "";
    color = "";
  } else {
    return;
  }
  popView({ icon, color });
}

onMounted(async () => {
  const currentIcon = viewState.value?.currentIcon || null;
  const currentColor = viewState.value?.currentColor || "";
  selectedIcon.value = currentIcon;
  selectedColor.value = currentColor;
  pendingClear = false;
  searchQuery.value = "";

  if (currentIcon) {
    previewHtml.value = renderIconStr(currentIcon, currentColor, 24);
    canSubmit.value = true;
  } else {
    previewHtml.value = "";
    canSubmit.value = false;
  }

  await nextTick();
  renderGrid(MDI_ICONS, "");
  if (currentIcon && currentIcon.startsWith("mdi-")) {
    const el = gridRef.value;
    if (el) {
      el.querySelectorAll(".icon-picker-item").forEach((item) => {
        item.classList.toggle("selected", item.title === currentIcon.replace("mdi-", ""));
      });
    }
  }
});
</script>

<style scoped>
.icon-picker-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.icon-picker-input-row .icon-picker-search {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.icon-picker-favicon-confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.icon-picker-favicon-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  width: 32px;
  height: 32px;
}

.icon-picker-clear-btn {
  min-width: auto;
  min-height: 32px;
  padding: 0 10px;
  font-size: 12px;
  flex-shrink: 0;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.icon-picker-url-ok-btn {
  min-width: auto;
  min-height: 32px;
  padding: 0 10px;
  font-size: 12px;
}

.icon-picker-upload-btn {
  min-width: auto;
  min-height: 32px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  white-space: nowrap;
  line-height: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.color-palette {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0 0;
  flex-wrap: wrap;
}

.color-palette-item {
  width: 24px;
  height: 24px;
  min-width: 24px;
  min-height: 24px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  line-height: 0;
  font-size: 0;
}

.color-palette-item.selected {
  border-color: var(--text-primary);
}

.icon-picker-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;
  align-content: flex-start;
}

.icon-picker-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.icon-picker-item.selected {
  border-color: var(--accent);
  background: var(--accent-muted, rgba(33, 150, 243, 0.15));
}

.icon-picker-loading,
.icon-picker-more {
  width: 100%;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  padding: 12px 0;
}
</style>
