// 横スクロールリスト（TabBar のタブ列）の端に隠れた項目があることを示すフェード用 mask-image

export function scrollFadeMaskImage(
  canScrollLeft: boolean,
  canScrollRight: boolean,
  fadeWidthPx: number,
): string {
  if (!canScrollLeft && !canScrollRight) return "none";
  const left = canScrollLeft ? `transparent, black ${fadeWidthPx}px` : "black 0";
  const right = canScrollRight ? `black calc(100% - ${fadeWidthPx}px), transparent` : "black 100%";
  return `linear-gradient(to right, ${left}, ${right})`;
}
