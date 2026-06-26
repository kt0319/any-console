import { extractPlaceholders } from "./placeholders.js";

/**
 * コマンド内の [[name]] プレースホルダーを起動時に入力させ、値を集める。
 * prompt は呼び出し側から注入する（usePrompt の prompt 互換）。
 * いずれかの入力がキャンセル（null/undefined）されたら null を返し、起動を中止させる。
 *
 * @param {string|null|undefined} command
 * @param {(opts: { title: string, placeholder: string, confirmLabel: string }) => Promise<string|null|undefined>} prompt
 * @returns {Promise<Record<string, string> | null>}
 */
export async function collectCommandVars(command, prompt) {
  const names = extractPlaceholders(command);
  if (names.length === 0) return {};
  /** @type {Record<string, string>} */
  const vars = {};
  for (const name of names) {
    const value = await prompt({
      title: `Enter ${name}`,
      placeholder: name,
      confirmLabel: "Run",
    });
    if (value == null) return null;
    vars[name] = value;
  }
  return vars;
}
