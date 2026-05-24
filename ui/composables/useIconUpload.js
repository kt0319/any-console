import { emit as bridgeEmit } from "../app-bridge.js";

const ICON_UPLOAD_MAX_SIZE = 512 * 1024;
const ICON_UPLOAD_ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
]);

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useIconUpload() {
  async function readIconFile(file) {
    if (!ICON_UPLOAD_ALLOWED_TYPES.has(file.type)) {
      bridgeEmit("toast:show", { message: "Please select a PNG/JPG/GIF/WEBP/SVG image", type: "error" });
      return null;
    }
    if (file.size > ICON_UPLOAD_MAX_SIZE) {
      bridgeEmit("toast:show", { message: "Image must be 500KB or less", type: "error" });
      return null;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
        throw new Error("Failed to load image");
      }
      return dataUrl;
    } catch (e) {
      bridgeEmit("toast:show", { message: e.message || "Failed to load image", type: "error" });
      return null;
    }
  }

  return { readIconFile };
}
