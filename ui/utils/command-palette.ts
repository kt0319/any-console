export type PaletteGroup = "Actions" | "Tabs" | "Jobs" | "Settings";

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  icon: string;
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
