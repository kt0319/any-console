import { describe, it, expect, vi } from "vitest";
import { getWithRetry } from "../../ui/utils/api-retry.ts";

describe("getWithRetry", () => {
  it("成功したら再試行しない", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, data: { entries: [] } });
    const out = await getWithRetry(get, "/x");
    expect(get).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(true);
  });

  it("構造化エラー(data非null)は再試行せずそのまま返す", async () => {
    const structured = { ok: false, data: { detail: "Directory not found" } };
    const get = vi.fn().mockResolvedValue(structured);
    const out = await getWithRetry(get, "/x");
    expect(get).toHaveBeenCalledTimes(1);
    expect(out).toBe(structured);
  });

  it("一時失敗(data==null)は1回再試行して回復する", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ ok: false, data: null })
      .mockResolvedValueOnce({ ok: true, data: { entries: [1] } });
    const out = await getWithRetry(get, "/x");
    expect(get).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(true);
    expect(out.data.entries).toEqual([1]);
  });

  it("再試行も一時失敗ならその結果を返す（無限リトライしない）", async () => {
    const get = vi.fn().mockResolvedValue({ ok: false, data: null });
    const out = await getWithRetry(get, "/x");
    expect(get).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(false);
  });
});
