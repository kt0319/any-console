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

async function fetchIconMeta() {
  if (iconPickerCache) return iconPickerCache;
  const res = await fetch("https://cdn.jsdelivr.net/npm/@mdi/svg@7/meta.json");
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

  grid.innerHTML = '<div class="icon-picker-loading">読み込み中...</div>';
  preview.innerHTML = "";
  confirmBtn.disabled = true;

  search.value = "";

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

function renderIconGrid(icons, query) {
  const grid = $("icon-picker-grid");
  grid.innerHTML = "";

  let filtered = icons;
  if (query) {
    filtered = icons.filter((icon) => {
      if (icon.name.includes(query)) return true;
      if (icon.aliases.some((a) => a.includes(query))) return true;
      if (icon.tags.some((t) => t.includes(query))) return true;
      return false;
    });
  }

  const MAX_DISPLAY = 200;
  const slice = filtered.slice(0, MAX_DISPLAY);

  for (const icon of slice) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-picker-item";
    btn.innerHTML = `<span class="mdi mdi-${icon.name}"></span>`;
    btn.title = icon.name;
    btn.addEventListener("click", () => {
      selectMdiIcon(`mdi-${icon.name}`);
    });
    grid.appendChild(btn);
  }

  if (filtered.length > MAX_DISPLAY) {
    const more = document.createElement("div");
    more.className = "icon-picker-more";
    more.textContent = `他 ${filtered.length - MAX_DISPLAY} 件...検索で絞り込んでください`;
    grid.appendChild(more);
  }

  if (slice.length === 0) {
    const empty = document.createElement("div");
    empty.className = "icon-picker-more";
    empty.textContent = "該当するアイコンがありません";
    grid.appendChild(empty);
  }
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
    const color = iconPickerSelectedColor;
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
