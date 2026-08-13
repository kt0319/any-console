/**
 * 不可逆な破壊操作の確認ダイアログを共通文面で表示する。
 * 呼び出し側は対象を含む短い prompt（例: `Delete file "foo"?`）だけ渡す。
 *
 * @param confirm `useConfirm()` から取得した confirm 関数。
 * @param prompt 操作対象まで含む確認文。文末に "?" を含める。
 */
export function confirmIrreversible(
  confirm: (msg: string, opts?: object) => Promise<boolean | string>,
  prompt: string,
): Promise<boolean | string> {
  return confirm(`${prompt} This cannot be undone.`);
}
