const NF_EXT_MAP = {
  js: ["\u{E781}", "#f1e05a"],
  mjs: ["\u{E781}", "#f1e05a"],
  ts: ["\u{E628}", "#3178c6"],
  tsx: ["\u{E7BA}", "#3178c6"],
  jsx: ["\u{E7BA}", "#61dafb"],
  vue: ["\u{F0A20}", "#42b883"],
  json: ["\u{E60B}", "#cbcb41"],
  html: ["\u{E736}", "#e44d26"],
  css: ["\u{E749}", "#563d7c"],
  scss: ["\u{E749}", "#c6538c"],
  py: ["\u{E73C}", "#3572a5"],
  rb: ["\u{E739}", "#cc342d"],
  rs: ["\u{E7A8}", "#dea584"],
  go: ["\u{E627}", "#00add8"],
  java: ["\u{E738}", "#b07219"],
  c: ["\u{E61E}", "#555555"],
  cpp: ["\u{E61D}", "#f34b7d"],
  h: ["\u{E61E}", "#555555"],
  sh: ["\u{E795}", "#89e051"],
  bash: ["\u{E795}", "#89e051"],
  zsh: ["\u{E795}", "#89e051"],
  md: ["\u{E73E}", "#083fa1"],
  yml: ["\u{E6A8}", "#cb171e"],
  yaml: ["\u{E6A8}", "#cb171e"],
  toml: ["\u{E6B2}", "#9c4221"],
  xml: ["\u{E619}", "#e44d26"],
  svg: ["\u{F01A5}", "#ffb13b"],
  png: ["\u{F01A5}", "#a074c4"],
  jpg: ["\u{F01A5}", "#a074c4"],
  jpeg: ["\u{F01A5}", "#a074c4"],
  gif: ["\u{F01A5}", "#a074c4"],
  webp: ["\u{F01A5}", "#a074c4"],
  ico: ["\u{F01A5}", "#a074c4"],
  pdf: ["\u{EAEB}", "#e44d26"],
  zip: ["\u{F410}", "#e8a835"],
  gz: ["\u{F410}", "#e8a835"],
  tar: ["\u{F410}", "#e8a835"],
  lock: ["\u{E21A}", "#555555"],
  env: ["\u{E615}", "#faf743"],
  sql: ["\u{E706}", "#e38c00"],
  docker: ["\u{E7B0}", "#2496ed"],
  dockerfile: ["\u{E7B0}", "#2496ed"],
  gitignore: ["\u{E702}", "#f54d27"],
  txt: ["\u{F0219}", "#89e051"],
  log: ["\u{F0219}", "#555555"],
  conf: ["\u{E615}", "#6d8086"],
  cfg: ["\u{E615}", "#6d8086"],
  ini: ["\u{E615}", "#6d8086"],
  csv: ["\u{F0219}", "#89e051"],
  woff: ["\u{E659}", "#aaaaaa"],
  woff2: ["\u{E659}", "#aaaaaa"],
  ttf: ["\u{E659}", "#aaaaaa"],
  eot: ["\u{E659}", "#aaaaaa"],
};

const NF_NAME_MAP = {
  Dockerfile: ["\u{E7B0}", "#2496ed"],
  Makefile: ["\u{E615}", "#6d8086"],
  LICENSE: ["\u{F0219}", "#d4aa00"],
  README: ["\u{E73E}", "#083fa1"],
  "README.md": ["\u{E73E}", "#083fa1"],
  ".gitignore": ["\u{E702}", "#f54d27"],
  ".env": ["\u{E615}", "#faf743"],
  ".env.local": ["\u{E615}", "#faf743"],
};

function iconSpan(code, color) {
  return `<span style="color:${color}">${code}</span>`;
}

export function renderFileIcon(entry) {
  if (entry?.type === "dir") return iconSpan("\u{F024B}", "#e8a735");
  if (entry?.type === "symlink") return iconSpan("\u{EB15}", "#7aa2f7");
  const name = entry?.name || "";
  return renderFileIconFromPath(name);
}

export function renderFileIconFromPath(path) {
  const name = String(path || "").split("/").pop() || "";
  const nameMatch = NF_NAME_MAP[name];
  if (nameMatch) return iconSpan(nameMatch[0], nameMatch[1]);

  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const extMatch = NF_EXT_MAP[ext];
  if (extMatch) return iconSpan(extMatch[0], extMatch[1]);

  return iconSpan("\u{F0219}", "#6d8086");
}
