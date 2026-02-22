let iconPickerCache = null;
let iconPickerCallback = null;
let selectedIconColor = "";

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

function renderIconColorPalette(currentColor) {
  const container = $("icon-picker-colors");
  container.innerHTML = "";
  for (const preset of ICON_PRESET_COLORS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-picker-color-item";
    if (preset.value === selectedIconColor) btn.classList.add("selected");
    btn.title = preset.label;
    if (preset.value) {
      btn.style.background = preset.value;
    } else {
      btn.style.background = "var(--text-primary)";
    }
    btn.addEventListener("click", () => {
      selectedIconColor = preset.value;
      container.querySelectorAll(".icon-picker-color-item").forEach((el) => el.classList.remove("selected"));
      btn.classList.add("selected");
      applyIconGridColor();
    });
    container.appendChild(btn);
  }
}

function applyIconGridColor() {
  const grid = $("icon-picker-grid");
  for (const item of grid.querySelectorAll(".icon-picker-item")) {
    item.style.color = selectedIconColor || "";
  }
}

function openIconPicker(callback, currentColor) {
  iconPickerCallback = callback;
  selectedIconColor = currentColor || "";
  const modal = $("icon-picker-modal");
  const search = $("icon-picker-search");
  const grid = $("icon-picker-grid");
  search.value = "";
  grid.innerHTML = '<div class="icon-picker-loading">読み込み中...</div>';
  renderIconColorPalette(currentColor);
  modal.style.display = "flex";

  fetchIconMeta().then((icons) => {
    renderIconGrid(icons, "");
    search.focus();
  });

  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    if (!iconPickerCache) return;
    renderIconGrid(iconPickerCache, q);
  };
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
    if (selectedIconColor) btn.style.color = selectedIconColor;
    btn.addEventListener("click", () => {
      closeIconPicker();
      if (iconPickerCallback) iconPickerCallback({ icon: `mdi-${icon.name}`, color: selectedIconColor });
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

function closeIconPicker() {
  $("icon-picker-modal").style.display = "none";
  iconPickerCallback = null;
}
