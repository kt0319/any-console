<template>
  <div class="modal-scroll-body">
    <div class="icon-picker-mode-row">
      <label class="icon-picker-mode-option">
        <input type="radio" name="icon-picker-mode" value="mdi" v-model="mode" @change="onModeChange" />
        MDI Icon
      </label>
      <label class="icon-picker-mode-option">
        <input type="radio" name="icon-picker-mode" value="favicon" v-model="mode" @change="onModeChange" />
        Favicon URL
      </label>
      <label class="icon-picker-mode-option">
        <input type="radio" name="icon-picker-mode" value="image" v-model="mode" @change="onModeChange" />
        Image
      </label>
    </div>

    <template v-if="mode === 'mdi'">
      <div class="icon-picker-section-label">Icon</div>
      <input
        ref="searchRef"
        v-model="searchQuery"
        type="text"
        class="form-input icon-picker-search"
        placeholder="Search icons..."
        autocomplete="off"
        @input="onSearchInput"
      />
      <div ref="gridRef" class="icon-picker-grid">
      </div>

      <div class="icon-picker-section-label">Color</div>
      <div class="color-palette">
        <button
          v-for="preset in ICON_PRESET_COLORS"
          :key="preset.label"
          type="button"
          class="color-palette-item"
          :class="{ selected: selectedColor === preset.value }"
          :data-tooltip="preset.label"
          :aria-label="preset.label"
          :style="{ background: preset.value || 'var(--text-primary)' }"
          @click="selectColor(preset.value)"
        />
      </div>
    </template>

    <template v-else-if="mode === 'favicon'">
      <div class="icon-picker-section-label">Favicon URL</div>
      <input
        v-model="faviconUrl"
        type="text"
        class="form-input"
        placeholder="https://example.com"
        autocomplete="off"
        @input="onFaviconInput"
      />
    </template>

    <template v-else>
      <div class="icon-picker-section-label">Image</div>
      <button type="button" class="icon-picker-upload-btn" @click="triggerUpload">
        <span class="mdi mdi-image-plus"></span> Choose Image
      </button>
      <input
        ref="uploadRef"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        style="display:none"
        @change="handleUpload"
      />
    </template>

    <div class="icon-picker-footer">
      <span class="icon-picker-footer-preview" v-html="previewHtml"></span>
      <button type="button" class="icon-picker-clear-btn" @click="clearAndClose">Clear</button>
      <button
        type="button"
        class="primary icon-picker-select-btn"
        :disabled="!canSubmit"
        @click="submit"
      >Select</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from "vue";
import { useModalView } from "../composables/useModalView.ts";
import { useIconUpload } from "../composables/useIconUpload.ts";
import { renderIconStr } from "../utils/render-icon.ts";
import { looksLikeUrl, extractDomain } from "../utils/icon-url.ts";
import { buildIconGridModel } from "../utils/icon-grid.ts";
import { ICON_GRID_MAX_DISPLAY } from "../utils/constants.ts";
import MDI_ICONS from "../data/mdi-icons.ts";

const { modalTitle, viewState, popView } = useModalView();
modalTitle!.value = "Icon Picker";

const { readIconFile } = useIconUpload();

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

const searchRef = ref<HTMLInputElement | null>(null);
const uploadRef = ref<HTMLInputElement | null>(null);
const gridRef = ref<HTMLDivElement | null>(null);
const mode = ref<"mdi" | "favicon" | "image">("mdi");
const searchQuery = ref("");
const faviconUrl = ref("");
// mdi-xxx（グリッド選択）とdata:image/...（アップロード）はモードで排他なので別状態にする。
const selectedIcon = ref<string | null>(null);
const uploadedIcon = ref<string | null>(null);
const selectedColor = ref("");
const previewHtml = ref("");
const canSubmit = ref(false);

function renderGrid(icons: string[], query: string) {
  const el = gridRef.value;
  if (!el) return;
  el.innerHTML = "";
  const { items, remaining } = buildIconGridModel(icons, query, ICON_GRID_MAX_DISPLAY);
  for (const name of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-picker-item";
    btn.innerHTML = `<span class="mdi mdi-${name}"></span>`;
    btn.title = name;
    btn.addEventListener("click", () => selectMdiIcon(`mdi-${name}`));
    el.appendChild(btn);
  }
  if (remaining > 0) {
    const more = document.createElement("div");
    more.className = "icon-picker-more";
    more.textContent = `and ${remaining} more... use search to filter`;
    el.appendChild(more);
  }
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "icon-picker-more";
    empty.textContent = "No matching icons";
    el.appendChild(empty);
  }
}

function highlightGridSelection(iconName: string | null) {
  const el = gridRef.value;
  if (!el) return;
  el.querySelectorAll<HTMLButtonElement>(".icon-picker-item").forEach((item) => {
    item.classList.toggle("selected", !!iconName && item.title === iconName.replace("mdi-", ""));
  });
}

// 現在のmode・入力内容からプレビューとcanSubmitを再計算する。
function updatePreview() {
  if (mode.value === "mdi") {
    if (selectedIcon.value) {
      previewHtml.value = renderIconStr(selectedIcon.value, selectedColor.value, 24);
      canSubmit.value = true;
    } else {
      previewHtml.value = "";
      canSubmit.value = false;
    }
    return;
  }
  if (mode.value === "favicon") {
    const raw = faviconUrl.value.trim();
    if (looksLikeUrl(raw)) {
      previewHtml.value = renderIconStr(`favicon:${extractDomain(raw)}`, "", 24);
      canSubmit.value = true;
    } else {
      previewHtml.value = "";
      canSubmit.value = false;
    }
    return;
  }
  if (uploadedIcon.value) {
    previewHtml.value = renderIconStr(uploadedIcon.value, "", 24);
    canSubmit.value = true;
  } else {
    previewHtml.value = "";
    canSubmit.value = false;
  }
}

function selectMdiIcon(iconName: string) {
  selectedIcon.value = iconName;
  updatePreview();
  highlightGridSelection(iconName);
}

function selectColor(color: string) {
  selectedColor.value = color;
  updatePreview();
}

function onSearchInput() {
  renderGrid(MDI_ICONS, searchQuery.value.trim().toLowerCase());
  highlightGridSelection(selectedIcon.value);
}

function onFaviconInput() {
  updatePreview();
}

async function onModeChange() {
  updatePreview();
  if (mode.value === "mdi") {
    await nextTick();
    renderGrid(MDI_ICONS, searchQuery.value.trim().toLowerCase());
    highlightGridSelection(selectedIcon.value);
  }
}

function clearAndClose() {
  popView!({ icon: "", color: "" });
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
  const dataUrl = await readIconFile(file);
  if (dataUrl) {
    uploadedIcon.value = dataUrl;
    updatePreview();
  }
  if (uploadRef.value) uploadRef.value.value = "";
}

function submit() {
  if (mode.value === "mdi") {
    if (!selectedIcon.value) return;
    popView!({ icon: selectedIcon.value, color: selectedColor.value });
    return;
  }
  if (mode.value === "favicon") {
    const raw = faviconUrl.value.trim();
    if (looksLikeUrl(raw)) popView!({ icon: `favicon:${extractDomain(raw)}`, color: "" });
    return;
  }
  if (uploadedIcon.value) popView!({ icon: uploadedIcon.value, color: "" });
}

onMounted(async () => {
  const currentIcon = viewState!.value?.currentIcon || null;
  const currentColor = viewState!.value?.currentColor || "";
  selectedColor.value = currentColor;
  searchQuery.value = "";
  faviconUrl.value = "";

  if (currentIcon && currentIcon.startsWith("favicon:")) {
    // favicon:domain から編集を再開できるようURL欄へ復元し、Favicon URLモードを選ぶ。
    mode.value = "favicon";
    faviconUrl.value = `https://${currentIcon.slice("favicon:".length)}`;
  } else if (currentIcon && currentIcon.startsWith("data:image/")) {
    mode.value = "image";
    uploadedIcon.value = currentIcon;
  } else if (currentIcon) {
    mode.value = "mdi";
    selectedIcon.value = currentIcon;
  }
  updatePreview();

  if (mode.value === "mdi") {
    await nextTick();
    renderGrid(MDI_ICONS, "");
    highlightGridSelection(selectedIcon.value);
  }
});
</script>

<style>
/* icon-picker-item/-more は renderGrid() が document.createElement で
   動的生成するため、scoped CSS の data-v-xxxx 属性が付かずscoped側の
   セレクタが一切マッチしない。ここだけ非scopedにして確実に当てる。 */
.icon-picker-grid .icon-picker-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}

.icon-picker-grid .icon-picker-item.selected {
  border-color: var(--accent);
  background: var(--accent-muted, rgba(33, 150, 243, 0.15));
}

.icon-picker-grid .icon-picker-more {
  width: 100%;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  padding: 12px 0;
}
</style>

<style scoped>
.icon-picker-section-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 10px 0 6px;
}

.icon-picker-section-label:first-child {
  margin-top: 0;
}

.icon-picker-search {
  margin-bottom: 6px;
}

.color-palette {
  display: flex;
  align-items: center;
  gap: 6px;
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

.icon-picker-mode-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 10px;
}

.icon-picker-mode-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.icon-picker-mode-option input[type="radio"] {
  cursor: pointer;
}

.icon-picker-upload-btn {
  min-width: auto;
  min-height: 36px;
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
  flex-shrink: 0;
}

.icon-picker-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  overflow-y: auto;
  max-height: 220px;
  padding: 4px 0;
  align-content: flex-start;
}

.icon-picker-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.icon-picker-footer-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.icon-picker-clear-btn {
  min-width: auto;
  min-height: 36px;
  padding: 0 10px;
  font-size: 12px;
  flex-shrink: 0;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.icon-picker-select-btn {
  flex: 1;
  min-height: 36px;
}
</style>
