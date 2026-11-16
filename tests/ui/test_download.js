// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BLOB_URL_REVOKE_DELAY_MS } from "../../ui/utils/constants.ts";
import { triggerBlobDownload } from "../../ui/utils/download.ts";

describe("triggerBlobDownload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates an anchor with the given filename and clicks it", () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    const stub = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreateElement(tag);
      if (tag === "a") el.click = clickSpy;
      return el;
    });

    triggerBlobDownload(blob, "foo.txt");

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BLOB_URL_REVOKE_DELAY_MS);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    stub.mockRestore();
  });
});
