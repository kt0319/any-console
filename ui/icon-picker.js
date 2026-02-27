let iconPickerCache = null;
let iconPickerCallback = null;
let iconPickerSelectedColor = "";
let iconPickerSelectedIcon = null;

const ICON_PRESET_COLORS = [
  { label: "デフォルト", value: "" },
  { label: "赤", value: "#e53935" },
  { label: "ピンク", value: "#d81b60" },
  { label: "紫", value: "#8e24aa" },
  { label: "青", value: "#1e88e5" },
  { label: "水色", value: "#00acc1" },
  { label: "緑", value: "#43a047" },
  { label: "黄", value: "#fdd835" },
  { label: "オレンジ", value: "#fb8c00" },
  { label: "白", value: "#ffffff" },
];

const URL_PATTERN = /^(https?:\/\/|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/;
const ICON_UPLOAD_MAX_SIZE = 512 * 1024;
const ICON_UPLOAD_ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

function looksLikeUrl(text) {
  return URL_PATTERN.test(text);
}

function extractDomain(text) {
  try {
    if (text.startsWith("http://") || text.startsWith("https://")) {
      return new URL(text).hostname;
    }
    return text.split("/")[0];
  } catch {
    return text;
  }
}

function validateIconUploadFile(file) {
  if (!file) return "ファイルを選択してください";
  if (!ICON_UPLOAD_ALLOWED_TYPES.has(file.type)) {
    return "PNG/JPG/GIF/WEBP/SVG の画像を選択してください";
  }
  if (file.size > ICON_UPLOAD_MAX_SIZE) {
    return "画像サイズは500KB以下にしてください";
  }
  return "";
}

async function iconFileToDataUrl(file) {
  const dataUrl = await blobToDataUrl(file);
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("画像の読み込みに失敗しました");
  }
  return dataUrl;
}

async function fetchIconMeta() {
  if (iconPickerCache) return iconPickerCache;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const res = await fetch("https://cdn.jsdelivr.net/npm/@mdi/svg@7/meta.json", { signal: controller.signal });
  clearTimeout(timeout);
  const data = await res.json();
  iconPickerCache = data.map((item) => ({
    name: item.name,
    aliases: item.aliases || [],
    tags: item.tags || [],
  }));
  return iconPickerCache;
}

function openIconPicker(callback, currentIcon, currentColor) {
  iconPickerCallback = callback;
  iconPickerSelectedColor = currentColor || "";
  iconPickerSelectedIcon = null;
  const modal = $("icon-picker-modal");
  const search = $("icon-picker-search");
  const grid = $("icon-picker-grid");
  const preview = $("icon-picker-favicon-preview");
  const confirmBtn = $("icon-picker-url-ok");
  const uploadBtn = $("icon-picker-upload");
  const uploadInput = $("icon-picker-upload-input");

  grid.innerHTML = '<div class="icon-picker-loading">読み込み中...</div>';
  preview.innerHTML = "";
  confirmBtn.disabled = true;

  search.value = "";
  if (uploadInput) uploadInput.value = "";

  renderPickerColorPalette(iconPickerSelectedColor);
  modal.style.display = "flex";

  fetchIconMeta().then((icons) => {
    const q = search.value.trim().toLowerCase();
    if (!looksLikeUrl(q)) {
      renderIconGrid(icons, q);
    } else {
      renderIconGrid(icons, "");
    }
    search.focus();
  });

  search.oninput = () => {
    const raw = search.value.trim();
    iconPickerSelectedIcon = null;
    if (looksLikeUrl(raw)) {
      const domain = extractDomain(raw);
      preview.innerHTML = renderIcon(`favicon:${domain}`, "", 24);
      confirmBtn.disabled = false;
      if (iconPickerCache) renderIconGrid(iconPickerCache, "");
    } else {
      preview.innerHTML = "";
      confirmBtn.disabled = true;
      if (iconPickerCache) renderIconGrid(iconPickerCache, raw.toLowerCase());
    }
  };

  if (uploadBtn && uploadInput) {
    uploadBtn.onclick = () => uploadInput.click();
    uploadInput.onchange = async () => {
      const file = uploadInput.files && uploadInput.files[0];
      if (!file) return;
      const validationError = validateIconUploadFile(file);
      if (validationError) {
        showToast(validationError);
        uploadInput.value = "";
        return;
      }
      try {
        const dataUrl = await iconFileToDataUrl(file);
        iconPickerSelectedIcon = dataUrl;
        search.value = "";
        preview.innerHTML = renderIcon(dataUrl, "", 24);
        confirmBtn.disabled = false;
        grid.querySelectorAll(".icon-picker-item").forEach((el) => el.classList.remove("selected"));
      } catch (e) {
        showToast(e.message || "画像の読み込みに失敗しました");
      } finally {
        uploadInput.value = "";
      }
    };
  }
}

function renderPickerColorPalette(currentColor) {
  const palette = $("icon-picker-color-palette");
  palette.innerHTML = "";
  for (const preset of ICON_PRESET_COLORS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-palette-item";
    if (preset.value === currentColor) btn.classList.add("selected");
    btn.title = preset.label;
    btn.style.background = preset.value || "var(--text-primary)";
    btn.addEventListener("click", () => {
      palette.querySelectorAll(".color-palette-item").forEach((el) => el.classList.remove("selected"));
      btn.classList.add("selected");
      iconPickerSelectedColor = preset.value;
      if (iconPickerSelectedIcon) {
        $("icon-picker-favicon-preview").innerHTML = renderIcon(iconPickerSelectedIcon, iconPickerSelectedColor, 24);
      }
    });
    palette.appendChild(btn);
  }
}

function filterIcons(icons, query) {
  if (!query) return icons;
  return icons.filter((icon) => {
    if (icon.name.includes(query)) return true;
    if (icon.aliases.some((a) => a.includes(query))) return true;
    if (icon.tags.some((t) => t.includes(query))) return true;
    return false;
  });
}

function renderIconGridTo(gridEl, icons, query, onSelect) {
  gridEl.innerHTML = "";
  const filtered = filterIcons(icons, query);
  const MAX_DISPLAY = 200;
  const slice = filtered.slice(0, MAX_DISPLAY);

  for (const icon of slice) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-picker-item";
    btn.innerHTML = `<span class="mdi mdi-${icon.name}"></span>`;
    btn.title = icon.name;
    btn.addEventListener("click", () => onSelect(`mdi-${icon.name}`));
    gridEl.appendChild(btn);
  }

  if (filtered.length > MAX_DISPLAY) {
    const more = document.createElement("div");
    more.className = "icon-picker-more";
    more.textContent = `他 ${filtered.length - MAX_DISPLAY} 件...検索で絞り込んでください`;
    gridEl.appendChild(more);
  }

  if (slice.length === 0) {
    const empty = document.createElement("div");
    empty.className = "icon-picker-more";
    empty.textContent = "該当するアイコンがありません";
    gridEl.appendChild(empty);
  }
}

function renderIconGrid(icons, query) {
  renderIconGridTo($("icon-picker-grid"), icons, query, selectMdiIcon);
}

function selectMdiIcon(iconName) {
  iconPickerSelectedIcon = iconName;
  const preview = $("icon-picker-favicon-preview");
  preview.innerHTML = renderIcon(iconName, iconPickerSelectedColor, 24);
  $("icon-picker-url-ok").disabled = false;
  $("icon-picker-grid").querySelectorAll(".icon-picker-item").forEach((el) => {
    el.classList.toggle("selected", el.title === iconName.replace("mdi-", ""));
  });
}

function submitIconPicker() {
  const raw = $("icon-picker-search").value.trim();
  if (looksLikeUrl(raw)) {
    const domain = extractDomain(raw);
    const cb = iconPickerCallback;
    closeIconPicker();
    if (cb) cb(`favicon:${domain}`, "");
  } else if (iconPickerSelectedIcon) {
    const cb = iconPickerCallback;
    const color = iconPickerSelectedIcon.startsWith("data:image/") ? "" : iconPickerSelectedColor;
    closeIconPicker();
    if (cb) cb(iconPickerSelectedIcon, color);
  }
}

function clearIconPicker() {
  const cb = iconPickerCallback;
  closeIconPicker();
  if (cb) cb("", "");
}

function closeIconPicker() {
  $("icon-picker-modal").style.display = "none";
  iconPickerCallback = null;
}

function renderInlineIconPicker(container, callback, currentIcon, currentColor, skipBack) {
  const existing = Array.from(container.children);
  for (const el of existing) el.style.display = "none";

  let selectedIcon = currentIcon || null;
  let selectedColor = currentColor || "";

  const sub = document.createElement("div");
  sub.className = "split-tab-settings-sub";

  let backBtn;
  if (!skipBack) {
    backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "split-tab-settings-back";
    backBtn.innerHTML = '<span class="mdi mdi-arrow-left"></span> アイコン選択';
    sub.appendChild(backBtn);
  }

  const body = document.createElement("div");
  body.className = "split-tab-settings-body";

  const inputRow = document.createElement("div");
  inputRow.className = "icon-picker-input-row";
  const search = document.createElement("input");
  search.type = "text";
  search.className = "form-input icon-picker-search";
  search.placeholder = "アイコン検索 / URLでfavicon";
  search.autocomplete = "off";
  const faviconConfirm = document.createElement("div");
  faviconConfirm.className = "icon-picker-favicon-confirm";
  const preview = document.createElement("span");
  preview.className = "icon-picker-favicon-preview";
  const uploadBtn = document.createElement("button");
  uploadBtn.type = "button";
  uploadBtn.className = "icon-picker-upload-btn";
  uploadBtn.innerHTML = '<span class="mdi mdi-image-plus"></span> 画像';
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
  uploadInput.style.display = "none";
  const urlOkBtn = document.createElement("button");
  urlOkBtn.type = "button";
  urlOkBtn.className = "primary icon-picker-url-ok-btn";
  urlOkBtn.disabled = true;
  urlOkBtn.textContent = "決定";
  faviconConfirm.append(preview, uploadBtn, uploadInput, urlOkBtn);
  inputRow.append(search, faviconConfirm);
  body.appendChild(inputRow);

  const palette = document.createElement("div");
  palette.className = "color-palette";
  for (const preset of ICON_PRESET_COLORS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-palette-item";
    if (preset.value === selectedColor) btn.classList.add("selected");
    btn.title = preset.label;
    btn.style.background = preset.value || "var(--text-primary)";
    btn.addEventListener("click", () => {
      palette.querySelectorAll(".color-palette-item").forEach((el) => el.classList.remove("selected"));
      btn.classList.add("selected");
      selectedColor = preset.value;
      if (selectedIcon) {
        preview.innerHTML = renderIcon(selectedIcon, selectedColor, 24);
      }
    });
    palette.appendChild(btn);
  }
  body.appendChild(palette);

  const grid = document.createElement("div");
  grid.className = "icon-picker-grid";
  grid.innerHTML = '<div class="icon-picker-loading">読み込み中...</div>';
  body.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.style.width = "auto";
  clearBtn.textContent = "クリア";
  actions.appendChild(clearBtn);
  body.appendChild(actions);

  sub.appendChild(body);
  container.appendChild(sub);

  function close() {
    sub.remove();
    for (const el of existing) el.style.display = "";
  }

  function onIconSelect(iconName) {
    selectedIcon = iconName;
    preview.innerHTML = renderIcon(iconName, selectedColor, 24);
    urlOkBtn.disabled = false;
    grid.querySelectorAll(".icon-picker-item").forEach((el) => {
      el.classList.toggle("selected", el.title === iconName.replace("mdi-", ""));
    });
  }

  if (backBtn) backBtn.addEventListener("click", close);

  clearBtn.addEventListener("click", () => {
    close();
    callback("", "");
  });

  urlOkBtn.addEventListener("click", () => {
    const raw = search.value.trim();
    if (looksLikeUrl(raw)) {
      const domain = extractDomain(raw);
      close();
      callback(`favicon:${domain}`, "");
      return;
    }
    if (selectedIcon) {
      close();
      callback(selectedIcon, selectedIcon.startsWith("data:image/") ? "" : selectedColor);
    }
  });

  uploadBtn.addEventListener("click", () => uploadInput.click());
  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files && uploadInput.files[0];
    if (!file) return;
    const validationError = validateIconUploadFile(file);
    if (validationError) {
      showToast(validationError);
      uploadInput.value = "";
      return;
    }
    try {
      selectedIcon = await iconFileToDataUrl(file);
      search.value = "";
      preview.innerHTML = renderIcon(selectedIcon, "", 24);
      urlOkBtn.disabled = false;
      grid.querySelectorAll(".icon-picker-item").forEach((el) => el.classList.remove("selected"));
    } catch (e) {
      showToast(e.message || "画像の読み込みに失敗しました");
    } finally {
      uploadInput.value = "";
    }
  });

  fetchIconMeta().then((icons) => {
    renderIconGridTo(grid, icons, "", onIconSelect);
    search.focus();
  });

  search.oninput = () => {
    const raw = search.value.trim();
    selectedIcon = null;
    if (looksLikeUrl(raw)) {
      const domain = extractDomain(raw);
      preview.innerHTML = renderIcon(`favicon:${domain}`, "", 24);
      urlOkBtn.disabled = false;
      if (iconPickerCache) renderIconGridTo(grid, iconPickerCache, "", onIconSelect);
    } else {
      preview.innerHTML = "";
      urlOkBtn.disabled = true;
      if (iconPickerCache) renderIconGridTo(grid, iconPickerCache, raw.toLowerCase(), onIconSelect);
    }
  };

  return close;
}
