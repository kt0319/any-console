// @ts-check
/**
 * axe-core によるアクセシビリティ自動検査ヘルパー。
 * happy-dom には描画エンジンが無く color-contrast 等の寸法依存ルールは信頼できないため無効化し、
 * 構造系ルール（WCAG 2.0/2.1 A・AA）のみ対象にする（docs/A11Y_AUDIT.md 参照）。
 */
import axe from "axe-core";
import { expect } from "vitest";

export const AXE_OPTIONS = {
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  },
  rules: {
    "color-contrast": { enabled: false },
  },
};

/**
 * 指定要素以下を axe で検査し、違反があれば整形して失敗させる。
 *
 * @param {Element} element 検査対象のルート要素
 * @param {object} [options] AXE_OPTIONS への上書き（rules のマージ含む）
 */
export async function expectNoA11yViolations(element, options = {}) {
  const merged = {
    ...AXE_OPTIONS,
    ...options,
    rules: { ...AXE_OPTIONS.rules, ...(options.rules || {}) },
  };
  const results = await axe.run(element, merged);
  const { violations } = results;
  if (violations.length > 0) {
    const report = violations
      .map((v) => {
        const nodes = v.nodes.map((n) => `      - ${n.html}`).join("\n");
        return `  [${v.impact}] ${v.id}: ${v.help}\n${nodes}`;
      })
      .join("\n");
    expect.fail(`アクセシビリティ違反が ${violations.length} 件検出されました:\n${report}`);
  }
}
