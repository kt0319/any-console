export type PaletteGroup = "Actions" | "Detail" | "Tabs" | "Jobs" | "Launch" | "Settings" | "Git" | "Terminal" | "Files";

/** renderIconStr（utils/render-icon.ts）へ渡すアイコン指定。 */
export interface PaletteIcon {
  name: string;
  color?: string | null;
}

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  icons: PaletteIcon[];
  run: () => void;
}

/** 空白区切りの全語が「グループ名 + ラベル」に含まれる項目だけを残す（大文字小文字は区別しない）。 */
export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const haystack = `${item.group} ${item.label}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** 選択位置を delta だけ動かし、端で反対側へ回り込ませる。項目が無ければ 0。 */
export function movePaletteIndex(index: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return (index + delta + length) % length;
}

/** 名前のある候補アイコンだけを順に返す。1つも無ければ fallbackName の1つだけを返す。 */
export function resolvePaletteIcons(candidates: (PaletteIcon | null | undefined)[], fallbackName: string): PaletteIcon[] {
  const present = candidates.filter((c): c is PaletteIcon => !!c?.name);
  return present.length ? present : [{ name: fallbackName }];
}

/** 結果リスト内の選択肢の DOM id（検索入力の aria-activedescendant と対応させる）。 */
export function commandPaletteOptionId(index: number): string {
  return `command-palette-option-${index}`;
}

/** 一致するコマンドが無いときに、入力文字列そのものを引数として提案する操作。 */
export type QueryActionKind = "create-branch" | "create-worktree" | "send-text" | "open-path";

/** git check-ref-format の主な制約（空白・制御文字・禁止記号・..・@{・先頭末尾の記号・.lock など）を満たすか。 */
export function isBranchNameCandidate(name: string): boolean {
  if (!name || name === "@") return false;
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)) return false;
  if (/\.\.|\/\/|@\{|\/\./.test(name)) return false;
  if (/^[-./]/.test(name) || /[/.]$/.test(name) || name.endsWith(".lock")) return false;
  return true;
}

/** 絶対・~・相対（./ ../）で始まる、または拡張子付きのファイル名に見える入力か。 */
export function looksLikePath(text: string): boolean {
  if (/\s/.test(text)) return false;
  if (/^(~|\.{1,2})?\//.test(text) || text === "~") return true;
  return /\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/.test(text);
}

/**
 * 入力から提案する操作を優先順に返す。パスらしい入力はパスを開く操作を先頭に、
 * それ以外はブランチ作成を先頭にする。実行できない操作（git ワークスペース・
 * ターミナルセッションが無い、ブランチ名として不正）は含めない。
 */
export function queryActionKinds(
  query: string,
  { canCreateBranch, hasSession }: { canCreateBranch: boolean, hasSession: boolean },
): QueryActionKind[] {
  const text = query.trim();
  if (!text) return [];
  const branch: QueryActionKind[] = canCreateBranch && isBranchNameCandidate(text) ? ["create-branch", "create-worktree"] : [];
  const sessionKinds = (order: QueryActionKind[]): QueryActionKind[] => (hasSession ? order : []);
  return looksLikePath(text)
    ? [...sessionKinds(["open-path", "send-text"]), ...branch]
    : [...branch, ...sessionKinds(["send-text", "open-path"])];
}
