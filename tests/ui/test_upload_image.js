// @ts-check
import { describe, it, expect, vi } from "vitest";
import { uploadImageFile } from "../../ui/utils/upload-image.ts";

function fakeFile() {
  return { name: "a.png", type: "image/png" };
}

describe("uploadImageFile", () => {
  it("returns path and clipboard flag on success", async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: "/tmp/a.png", clipboard: true }),
    });
    const result = await uploadImageFile({ file: /** @type {any} */ (fakeFile()), apiFetch });
    expect(result).toEqual({ path: "/tmp/a.png", clipboard: true });
    expect(apiFetch).toHaveBeenCalledWith("/upload-image", expect.objectContaining({ method: "POST" }));
  });

  it("returns null when response is missing", async () => {
    const apiFetch = vi.fn().mockResolvedValue(null);
    const result = await uploadImageFile({ file: /** @type {any} */ (fakeFile()), apiFetch });
    expect(result).toBeNull();
  });

  it("returns null on non-ok response", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ ok: false });
    const result = await uploadImageFile({ file: /** @type {any} */ (fakeFile()), apiFetch });
    expect(result).toBeNull();
  });
});
