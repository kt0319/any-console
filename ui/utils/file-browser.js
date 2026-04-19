export { formatSize as formatFileSize } from "./format.js";

export const FILE_EXT_MAP = {
  js: { icon: "mdi-language-javascript", color: "#f7df1e", lang: "javascript" },
  mjs: { icon: "mdi-language-javascript", color: "#f7df1e", lang: "javascript" },
  cjs: { icon: "mdi-language-javascript", color: "#f7df1e", lang: "javascript" },
  ts: { icon: "mdi-language-typescript", color: "#3178c6", lang: "typescript" },
  tsx: { icon: "mdi-language-typescript", color: "#3178c6", lang: "typescript" },
  jsx: { icon: "mdi-react", color: "#61dafb", lang: "javascript" },
  py: { icon: "mdi-language-python", color: "#3776ab", lang: "python" },
  pyw: { icon: null, color: null, lang: "python" },
  html: { icon: "mdi-language-html5", color: "#e34f26", lang: "xml" },
  css: { icon: "mdi-language-css3", color: "#1572b6", lang: "css" },
  json: { icon: "mdi-code-json", color: "#f7df1e", lang: "json" },
  md: { icon: "mdi-language-markdown", color: "#83b5d3", lang: "markdown" },
  sh: { icon: "mdi-console", color: "#89e051", lang: "bash" },
  dockerfile: { icon: "mdi-docker", color: "#2496ed", lang: "dockerfile" },
  makefile: { icon: null, color: null, lang: "makefile" },
  gitignore: { icon: "mdi-git", color: "#f05032" },
  png: { icon: "mdi-file-image", color: "#a074c4" },
  pdf: { icon: "mdi-file-pdf-box", color: "#e5252a" },
};

export function getFileIcon(name) {
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : name.toLowerCase();
  const entry = FILE_EXT_MAP[ext];
  if (!entry || !entry.icon) return { icon: "mdi-file-outline", color: "" };
  return { icon: entry.icon, color: entry.color || "" };
}

export function getHighlightLang(ext) {
  return FILE_EXT_MAP[ext]?.lang || null;
}

export function getHighlightKeyFromPath(path) {
  const name = (path || "").split("/").pop().toLowerCase();
  const dotIdx = name.lastIndexOf(".");
  return dotIdx > 0 ? name.slice(dotIdx + 1) : name;
}
