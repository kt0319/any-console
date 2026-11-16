export type PaletteGroup = "Actions" | "Detail" | "Tabs" | "Jobs" | "Launch" | "Settings";

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
