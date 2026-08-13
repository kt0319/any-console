import { extractPlaceholders } from "./placeholders.ts";

/**
 * コマンド内の [[name]] プレースホルダーを起動時に入力させ、値を集める。
 * prompt は呼び出し側から注入する（usePrompt の prompt 互換）。
 * いずれかの入力がキャンセル（null/undefined）されたら null を返し、起動を中止させる。
 */
export async function collectCommandVars(
  command: string | null | undefined,
  prompt: (opts: { title: string, placeholder: string, confirmLabel: string }) => Promise<string | null | undefined>,
): Promise<Record<string, string> | null> {
  const names = extractPlaceholders(command);
  if (names.length === 0) return {};
  const vars: Record<string, string> = {};
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
