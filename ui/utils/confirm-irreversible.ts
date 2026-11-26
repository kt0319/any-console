/** 不可逆な破壊操作の確認ダイアログを共通文面で表示する。prompt は対象を含む確認文（例: `Delete file "foo"?`）。 */
export function confirmIrreversible(
  confirm: (msg: string, opts?: object) => Promise<boolean | string>,
  prompt: string,
): Promise<boolean | string> {
  return confirm(`${prompt} This cannot be undone.`);
}
