const encoder = new TextEncoder();

export async function uploadImageToTerminal({ file, apiFetch, ws, notify }) {
  if (!file) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    notify?.("アクティブなターミナルがありません", "error");
    return false;
  }

  notify?.("画像アップロード中...", "success");
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await apiFetch("/upload-image", { method: "POST", body: formData });
    if (!res || !res.ok) throw new Error("アップロード失敗");
    const data = await res.json();
    ws.send(encoder.encode(data.path));
    notify?.("画像アップロード完了", "success");
    return true;
  } catch (err) {
    notify?.(`画像アップロード失敗: ${err.message}`, "error");
    return false;
  }
}
