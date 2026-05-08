import { EP_UPLOAD_IMAGE } from "./endpoints.js";

const encoder = new TextEncoder();

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export async function uploadImageToTerminal({ file, apiFetch, ws, term, notify }) {
  if (!file) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    notify?.("No active terminal", "error");
    return false;
  }

  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await apiFetch(EP_UPLOAD_IMAGE, { method: "POST", body: formData });
    if (!res || !res.ok) throw new Error("Upload failed");
    const data = await res.json();
    if (term) {
      term.write(`\x1b]52;c;${toBase64(data.path)}\x07`);
    }
    ws.send(encoder.encode(data.path));
    return true;
  } catch (err) {
    notify?.(`Image upload failed: ${err.message}`, "error");
    return false;
  }
}
