import { EP_UPLOAD_IMAGE } from "./endpoints.ts";

export type UploadedImage = { path: string, clipboard: boolean };

// `/upload-image` へのアップロード本体（ターミナル貼り付け・Dispatch画像添付で共用）。
export async function uploadImageFile({ file, apiFetch }: {
  file: File;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response | null | undefined>;
}): Promise<UploadedImage | null> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch(EP_UPLOAD_IMAGE, { method: "POST", body: formData });
  if (!res || !res.ok) return null;
  const data = await res.json();
  return { path: data.path, clipboard: !!data.clipboard };
}
