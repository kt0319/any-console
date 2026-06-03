// @ts-check
/**
 * axe-core を使ったアクセシビリティ自動検査ヘルパー。
 *
 * happy-dom にはレイアウト・描画エンジンが無いため、計算済みスタイルや
 * 寸法に依存するルール（color-contrast 等）は信頼できる結果を返せない。
 * それらは無効化し、ARIA・ロール・ラベル・フォーカス可能性といった
 * 構造的なルール（WCAG 2.0/2.1 A・AA）のみを対象にする。
 *
 * 色コントラストや実機スクリーンリーダー検証は引き続き Lighthouse /
 * 手動監査の担当とする（docs/A11Y_AUDIT.md を参照）。
 */
import axe from "axe-core";
import { expect } from "vitest";

/** happy-dom で信頼できる構造系ルールのみに絞った共通オプション。 */
export const AXE_OPTIONS = {
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  },
  rules: {
    // レイアウト/描画が無い happy-dom では計測できないため無効化。
    "color-contrast": { enabled: false },
  },
};

/**
 * 指定要素以下を axe で検査し、違反が無いことをアサートする。
 * 違反時はルール ID・説明・該当ノードを読みやすく整形して失敗させる。
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
