const JS = ["\u{E781}", "#f1e05a"];
const REACT = ["\u{E7BA}", "#3178c6"];
const SHELL = ["\u{E795}", "#89e051"];
const YAML = ["\u{E6A8}", "#cb171e"];
const C_LANG = ["\u{E61E}", "#555555"];
const IMAGE = ["\u{F01A5}", "#a074c4"];
const ARCHIVE = ["\u{F410}", "#e8a835"];
const DOCKER = ["\u{E7B0}", "#2496ed"];
const CONFIG = ["\u{E615}", "#6d8086"];
const FONT = ["\u{E659}", "#aaaaaa"];
const TEXT_GREEN = ["\u{F0219}", "#89e051"];
const ENV = ["\u{E615}", "#faf743"];
const MD = ["\u{E73E}", "#083fa1"];
const GITIGNORE = ["\u{E702}", "#f54d27"];

const NF_EXT_MAP = {
  js: JS,
  mjs: JS,
  ts: ["\u{E628}", "#3178c6"],
  tsx: REACT,
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
  c: C_LANG,
  cpp: ["\u{E61D}", "#f34b7d"],
  h: C_LANG,
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  md: MD,
  yml: YAML,
  yaml: YAML,
  toml: ["\u{E6B2}", "#9c4221"],
  xml: ["\u{E619}", "#e44d26"],
  svg: ["\u{F01A5}", "#ffb13b"],
  png: IMAGE,
  jpg: IMAGE,
  jpeg: IMAGE,
  gif: IMAGE,
  webp: IMAGE,
  ico: IMAGE,
  pdf: ["\u{EAEB}", "#e44d26"],
  zip: ARCHIVE,
  gz: ARCHIVE,
  tar: ARCHIVE,
  lock: ["\u{E21A}", "#555555"],
  env: ENV,
  sql: ["\u{E706}", "#e38c00"],
  docker: DOCKER,
  dockerfile: DOCKER,
  gitignore: GITIGNORE,
  txt: TEXT_GREEN,
  log: ["\u{F0219}", "#555555"],
  conf: CONFIG,
  cfg: CONFIG,
  ini: CONFIG,
  csv: TEXT_GREEN,
  woff: FONT,
  woff2: FONT,
  ttf: FONT,
  eot: FONT,
};

const NF_NAME_MAP = {
  Dockerfile: DOCKER,
  Makefile: CONFIG,
  LICENSE: ["\u{F0219}", "#d4aa00"],
  README: MD,
  "README.md": MD,
  ".gitignore": GITIGNORE,
  ".env": ENV,
  ".env.local": ENV,
};

const DIR_ICON = ["\u{F024B}", "#e8a735"];
const SYMLINK_ICON = ["\u{EB15}", "#7aa2f7"];
const DEFAULT_ICON = ["\u{F0219}", "#6d8086"];

function iconSpan(code, color) {
  return `<span style="color:${color}">${code}</span>`;
}

export function renderFileIcon(entry) {
  if (entry?.type === "dir") return iconSpan(DIR_ICON[0], DIR_ICON[1]);
  if (entry?.type === "symlink") return iconSpan(SYMLINK_ICON[0], SYMLINK_ICON[1]);
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

  return iconSpan(DEFAULT_ICON[0], DEFAULT_ICON[1]);
}
