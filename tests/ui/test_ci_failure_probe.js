import { expect, it } from "vitest";

it("CI失敗時のdirect dispatch動作確認用に意図的に失敗する", () => {
  expect(1).toBe(2);
});
