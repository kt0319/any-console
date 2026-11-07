import { describe, it, expect, vi, beforeEach } from "vitest";

const emitMock = vi.fn();
vi.mock("../../ui/app-bridge.ts", () => ({ emit: (...args) => emitMock(...args) }));

import { useToast } from "../../ui/composables/useToast.ts";

beforeEach(() => emitMock.mockReset());

describe("useToast: 完了まで出しっぱなしのトースト", () => {
  it("showPending は duration 0 と key 付きの info を発火する", () => {
    useToast().showPending("Uploading a.mp3", "upload:a");
    expect(emitMock).toHaveBeenCalledWith("toast:show", { message: "Uploading a.mp3", type: "info", duration: 0, key: "upload:a" });
  });

  it("dismiss は key を指定して toast:dismiss を発火する", () => {
    useToast().dismiss("upload:a");
    expect(emitMock).toHaveBeenCalledWith("toast:dismiss", { key: "upload:a" });
  });
});
