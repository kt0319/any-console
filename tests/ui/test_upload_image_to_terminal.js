// @ts-check
import { describe, it, expect, vi } from "vitest";
import { uploadImageToTerminal } from "../../ui/utils/upload-image-to-terminal.js";

const OPEN = 1;
globalThis.WebSocket = /** @type {any} */ ({ OPEN });

function makeWs(opts = {}) {
  return {
    readyState: opts.readyState ?? OPEN,
    send: vi.fn(),
  };
}

function fakeFile() {
  return { name: "a.png", type: "image/png" };
}

describe("uploadImageToTerminal", () => {
  it("returns false when file is missing", async () => {
    const result = await uploadImageToTerminal({ file: null, apiFetch: vi.fn(), ws: makeWs(), notify: vi.fn() });
    expect(result).toBe(false);
  });

  it("notifies and returns false when socket is closed", async () => {
    const notify = vi.fn();
    const result = await uploadImageToTerminal({
      file: fakeFile(),
      apiFetch: vi.fn(),
      ws: makeWs({ readyState: 0 }),
      notify,
    });
    expect(result).toBe(false);
    expect(notify).toHaveBeenCalledWith("No active terminal", "error");
  });

  it("sends paste marker when clipboard flag is set", async () => {
    const ws = makeWs();
    const apiFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clipboard: true }),
    });
    const result = await uploadImageToTerminal({
      file: fakeFile(),
      apiFetch,
      ws,
      notify: vi.fn(),
    });
    expect(result).toBe(true);
    expect(ws.send).toHaveBeenCalledOnce();
    const sent = ws.send.mock.calls[0][0];
    expect(sent).toBeInstanceOf(Uint8Array);
    expect(sent[0]).toBe(0x16);
  });

  it("sends file path otherwise", async () => {
    const ws = makeWs();
    const apiFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: "/tmp/a.png" }),
    });
    await uploadImageToTerminal({
      file: fakeFile(),
      apiFetch,
      ws,
      notify: vi.fn(),
    });
    const sent = ws.send.mock.calls[0][0];
    expect(new TextDecoder().decode(sent)).toBe("/tmp/a.png");
  });

  it("notifies and returns false on fetch failure", async () => {
    const notify = vi.fn();
    const apiFetch = vi.fn().mockResolvedValue({ ok: false });
    const result = await uploadImageToTerminal({
      file: fakeFile(),
      apiFetch,
      ws: makeWs(),
      notify,
    });
    expect(result).toBe(false);
    expect(notify).toHaveBeenCalled();
    expect(notify.mock.calls[0][1]).toBe("error");
  });
});
