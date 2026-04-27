const encoder = new TextEncoder();

export async function uploadImageToTerminal({ file, apiFetch, ws, notify }) {
  if (!file) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    notify?.("No active terminal", "error");
    return false;
  }

  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await apiFetch("/upload-image", { method: "POST", body: formData });
    if (!res || !res.ok) throw new Error("Upload failed");
    const data = await res.json();
    if (data.clipboard) {
      ws.send(encoder.encode("\x16"));
    } else {
      ws.send(encoder.encode(data.path));
    }
    return true;
  } catch (err) {
    notify?.(`Image upload failed: ${err.message}`, "error");
    return false;
  }
}
