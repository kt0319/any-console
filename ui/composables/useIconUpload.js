import { useToast } from "./useToast.js";

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
  const toast = useToast();

  async function readIconFile(file) {
    if (!ICON_UPLOAD_ALLOWED_TYPES.has(file.type)) {
      toast.error("Please select a PNG/JPG/GIF/WEBP/SVG image");
      return null;
    }
    if (file.size > ICON_UPLOAD_MAX_SIZE) {
      toast.error("Image must be 500KB or less");
      return null;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
        throw new Error("Failed to load image");
      }
      return dataUrl;
    } catch (e) {
      toast.error(e.message || "Failed to load image");
      return null;
    }
  }

  return { readIconFile };
}
