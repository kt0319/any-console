<template>
  <BaseModal ref="baseModal" title="アイコン選択">
    <div class="icon-picker-input-row">
      <input
        ref="searchRef"
        v-model="searchQuery"
        type="text"
        class="form-input icon-picker-search"
        placeholder="アイコン検索 / URLでfavicon"
        autocomplete="off"
        @input="onSearchInput"
      />
      <div class="icon-picker-favicon-confirm">
        <span class="icon-picker-favicon-preview" v-html="previewHtml"></span>
        <button type="button" class="icon-picker-clear-btn" @click="clearSelection">クリア</button>
        <button type="button" class="icon-picker-upload-btn" @click="triggerUpload">
          <span class="mdi mdi-image-plus"></span> 画像
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
        >決定</button>
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
      <div v-if="loadingIcons" class="icon-picker-loading">読み込み中...</div>
    </div>
  </BaseModal>
</template>

<script setup>
import { ref, nextTick } from "vue";
import BaseModal from "./BaseModal.vue";
import { emit } from "../app-bridge.js";

const URL_PATTERN = /^(https?:\/\/|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/;
const ICON_UPLOAD_MAX_SIZE = 512 * 1024;
const ICON_UPLOAD_ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
]);
const VALID_ICON_COLOR = /^#[0-9a-fA-F]{3,6}$/;
const MAX_DISPLAY = 200;

const ICON_PRESET_COLORS = [
  { label: "デフォルト", value: "" },
  { label: "赤", value: "#e53935" },
  { label: "ピンク", value: "#d81b60" },
  { label: "ローズ", value: "#ec407a" },
  { label: "紫", value: "#8e24aa" },
  { label: "深紫", value: "#5e35b1" },
  { label: "インディゴ", value: "#3949ab" },
  { label: "青", value: "#1e88e5" },
  { label: "水色", value: "#00acc1" },
  { label: "ティール", value: "#00897b" },
  { label: "緑", value: "#43a047" },
  { label: "ライム", value: "#7cb342" },
  { label: "黄", value: "#fdd835" },
  { label: "アンバー", value: "#ffb300" },
  { label: "オレンジ", value: "#fb8c00" },
  { label: "ブラウン", value: "#6d4c41" },
  { label: "グレー", value: "#757575" },
  { label: "白", value: "#ffffff" },
];

const baseModal = ref(null);
const searchRef = ref(null);
const uploadRef = ref(null);
const gridRef = ref(null);
const searchQuery = ref("");
const selectedIcon = ref(null);
const selectedColor = ref("");
const previewHtml = ref("");
const loadingIcons = ref(true);
const canSubmit = ref(false);
let pendingClear = false;
let iconCache = null;
let callback = null;

function renderIconHtml(icon, color, size = 24) {
  if (!icon) return "";
  if (icon.startsWith("data:image/") || icon.startsWith("icon:")) {
    const src = icon.startsWith("icon:") ? `/icons/${icon.slice(5)}` : icon;
    return `<img src="${src}" width="${size}" height="${size}" class="favicon-icon" alt="" />`;
  }
  if (icon.startsWith("favicon:")) {
    const domain = icon.slice("favicon:".length);
    return `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32" width="${size}" height="${size}" class="favicon-icon" alt="" />`;
  }
  const styles = [`font-size:${size}px`];
  if (color && VALID_ICON_COLOR.test(color)) styles.push(`color:${color}`);
  return `<span class="mdi ${icon}" style="${styles.join(";")}"></span>`;
}

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
  return icons.filter((icon) =>
    icon.name.includes(query) || icon.aliases.some((a) => a.includes(query)) || icon.tags.some((t) => t.includes(query)),
  );
}

function renderGrid(icons, query) {
  const el = gridRef.value;
  if (!el) return;
  el.innerHTML = "";
  const filtered = filterIcons(icons, query);
  const slice = filtered.slice(0, MAX_DISPLAY);
  for (const icon of slice) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-picker-item";
    btn.innerHTML = `<span class="mdi mdi-${icon.name}"></span>`;
    btn.title = icon.name;
    btn.addEventListener("click", () => selectMdiIcon(`mdi-${icon.name}`));
    el.appendChild(btn);
  }
  if (filtered.length > MAX_DISPLAY) {
    const more = document.createElement("div");
    more.className = "icon-picker-more";
    more.textContent = `他 ${filtered.length - MAX_DISPLAY} 件...検索で絞り込んでください`;
    el.appendChild(more);
  }
  if (slice.length === 0) {
    const empty = document.createElement("div");
    empty.className = "icon-picker-more";
    empty.textContent = "該当するアイコンがありません";
    el.appendChild(empty);
  }
}

function selectMdiIcon(iconName) {
  selectedIcon.value = iconName;
  pendingClear = false;
  previewHtml.value = renderIconHtml(iconName, selectedColor.value);
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
    previewHtml.value = renderIconHtml(selectedIcon.value, color);
  }
}

function onSearchInput() {
  const raw = searchQuery.value.trim();
  selectedIcon.value = null;
  pendingClear = false;
  if (looksLikeUrl(raw)) {
    const domain = extractDomain(raw);
    previewHtml.value = renderIconHtml(`favicon:${domain}`, "", 24);
    canSubmit.value = true;
    if (iconCache) renderGrid(iconCache, "");
  } else {
    previewHtml.value = "";
    canSubmit.value = false;
    if (iconCache) renderGrid(iconCache, raw.toLowerCase());
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
    emit("toast:show", { message: "PNG/JPG/GIF/WEBP/SVG の画像を選択してください", type: "error" });
    uploadRef.value.value = "";
    return;
  }
  if (file.size > ICON_UPLOAD_MAX_SIZE) {
    emit("toast:show", { message: "画像サイズは500KB以下にしてください", type: "error" });
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
      throw new Error("画像の読み込みに失敗しました");
    }
    selectedIcon.value = dataUrl;
    pendingClear = false;
    searchQuery.value = "";
    previewHtml.value = renderIconHtml(dataUrl, "", 24);
    canSubmit.value = true;
    const el = gridRef.value;
    if (el) el.querySelectorAll(".icon-picker-item").forEach((item) => item.classList.remove("selected"));
  } catch (e) {
    emit("toast:show", { message: e.message || "画像の読み込みに失敗しました", type: "error" });
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
  baseModal.value?.close();
  if (callback) {
    callback(icon, color);
    callback = null;
  }
}

async function fetchIcons() {
  if (iconCache) return iconCache;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const res = await fetch("https://cdn.jsdelivr.net/npm/@mdi/svg@7/meta.json", { signal: controller.signal });
  clearTimeout(timeout);
  const data = await res.json();
  iconCache = data.map((item) => ({ name: item.name, aliases: item.aliases || [], tags: item.tags || [] }));
  return iconCache;
}

async function open(cb, currentIcon, currentColor) {
  callback = cb;
  selectedIcon.value = currentIcon || null;
  selectedColor.value = currentColor || "";
  pendingClear = false;
  searchQuery.value = "";
  loadingIcons.value = true;

  if (currentIcon) {
    previewHtml.value = renderIconHtml(currentIcon, currentColor || "", 24);
    canSubmit.value = true;
  } else {
    previewHtml.value = "";
    canSubmit.value = false;
  }

  baseModal.value?.open();

  try {
    const icons = await fetchIcons();
    loadingIcons.value = false;
    await nextTick();
    renderGrid(icons, "");
    if (currentIcon && currentIcon.startsWith("mdi-")) {
      const el = gridRef.value;
      if (el) {
        el.querySelectorAll(".icon-picker-item").forEach((item) => {
          item.classList.toggle("selected", item.title === currentIcon.replace("mdi-", ""));
        });
      }
    }
  } catch {
    loadingIcons.value = false;
  }
}

function close() {
  baseModal.value?.close();
  callback = null;
}

defineExpose({ open, close });
</script>
