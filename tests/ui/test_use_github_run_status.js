// @ts-check
import { describe, it, expect } from "vitest";
import { runStatusIcon, runStatusClass } from "../../ui/composables/useGitHub.ts";

describe("runStatusIcon", () => {
  it("既知のstatus/conclusionにmdiアイコンクラスを返す", () => {
    expect(runStatusIcon("success")).toBe("mdi-check-circle-outline");
    expect(runStatusIcon("failure")).toBe("mdi-close-circle-outline");
    expect(runStatusIcon("cancelled")).toBe("mdi-minus-circle-outline");
    expect(runStatusIcon("in_progress")).toBe("mdi-autorenew");
    expect(runStatusIcon("queued")).toBe("mdi-clock-outline");
    expect(runStatusIcon("waiting")).toBe("mdi-clock-outline");
  });

  it("未知のstatusはヘルプアイコンにフォールバックする", () => {
    expect(runStatusIcon("skipped")).toBe("mdi-help-circle-outline");
  });
});

describe("runStatusClass", () => {
  it("in_progressだけspin用クラスを併せ持つ（queued/waitingとは静止/回転で区別する）", () => {
    expect(runStatusClass("in_progress")).toContain("github-run-spin");
    expect(runStatusClass("queued")).not.toContain("github-run-spin");
    expect(runStatusClass("waiting")).not.toContain("github-run-spin");
  });

  it("未知のstatusはunknown用クラスにフォールバックする", () => {
    expect(runStatusClass("skipped")).toBe("github-run-unknown");
  });
});
