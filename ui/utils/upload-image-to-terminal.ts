import { EP_UPLOAD_IMAGE } from "./endpoints.ts";

const encoder = new TextEncoder();

export async function uploadImageToTerminal({ file, apiFetch, ws, notify }: {
  file: File | null | undefined;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response | null | undefined>;
  ws: WebSocket | null | undefined;
  notify?: (message: string, kind: string) => void;
}): Promise<boolean> {
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
    if (data.clipboard) {
      ws.send(encoder.encode("\x16"));
    } else {
      ws.send(encoder.encode(data.path));
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notify?.(`Image upload failed: ${message}`, "error");
    return false;
  }
}
