// @ts-check
import { describe, it, expect } from "vitest";
import { buildDispatchOverrides } from "../../ui/utils/dispatch-run.ts";

const orig = { workspace: "app", branch: "dev", text: "hi", job: "claude", match: "any", existing_session_id: "s1", create_branch: false, image_paths: ["/a.png"] };
const sameForm = {
  workspace: "app", branch: "dev", baseBranch: "", text: "hi", job: "claude",
  isNewSession: false, sessionId: "s1", createBranch: false, imagePaths: ["/a.png"],
};

describe("buildDispatchOverrides", () => {
  it("元のリクエストから変わっていなければ全項目が null", () => {
    expect(buildDispatchOverrides(orig, sameForm)).toEqual({
      workspace: null, branch: null, base_branch: null, text: null, job: null,
      match: null, session_id: null, create_branch: null, image_paths: null,
    });
  });

  it("変えた項目だけを返す", () => {
    const o = buildDispatchOverrides(orig, { ...sameForm, text: "bye", branch: "main", imagePaths: [] });
    expect(o.text).toBe("bye");
    expect(o.branch).toBe("main");
    expect(o.image_paths).toEqual([]);
    expect(o.workspace).toBeNull();
  });

  it("match が none でない元リクエストで新規セッションを選ぶと match:none を送る", () => {
    expect(buildDispatchOverrides(orig, { ...sameForm, isNewSession: true }).match).toBe("none");
  });

  it("既存セッションを選び直すと match:any と session_id を送る", () => {
    const o = buildDispatchOverrides({ ...orig, match: "none", existing_session_id: undefined }, sameForm);
    expect(o.match).toBe("any");
    expect(o.session_id).toBe("s1");
  });

  it("別のセッションを選ぶと session_id を送る", () => {
    expect(buildDispatchOverrides(orig, { ...sameForm, sessionId: "s2" }).session_id).toBe("s2");
  });

  it("create_branch は元と違う時だけ送る", () => {
    expect(buildDispatchOverrides(orig, { ...sameForm, createBranch: true }).create_branch).toBe(true);
    expect(buildDispatchOverrides({ ...orig, create_branch: true }, { ...sameForm, createBranch: true }).create_branch).toBeNull();
  });
});
