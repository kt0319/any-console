import { ref } from "vue";
import { useAuthStore } from "../stores/auth.ts";
import { uploadImageFile } from "../utils/upload-image.ts";
import { useToast } from "./useToast.ts";

// DispatchRunView のtextarea用の画像貼り付け。useTerminalPaste.tsと違い、送信先は
// ws ではなく DispatchRequest.image_paths（配列で蓄積し、Run時にサーバへ渡す）。
export function useDispatchImagePaste() {
  const toast = useToast();
  const auth = useAuthStore();
  const imagePaths = ref<string[]>([]);

  async function onPaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files;
    const imageFile = files && files.length > 0
      ? Array.from(files).find((f) => f.type.startsWith("image/"))
      : null;
    if (!imageFile) return;

    e.preventDefault();
    const uploaded = await uploadImageFile({ file: imageFile, apiFetch: auth.apiFetch.bind(auth) });
    if (!uploaded) {
      toast.show("Image upload failed", "error");
      return;
    }
    imagePaths.value = [...imagePaths.value, uploaded.path];
  }

  function removeImage(path: string) {
    imagePaths.value = imagePaths.value.filter((p) => p !== path);
  }

  return { imagePaths, onPaste, removeImage };
}
