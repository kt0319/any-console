// 横スクロール可能なリスト（TabBar.vueのタブ列）の端に、まだ隠れている
// 項目があることを示すフェード効果用のCSS mask-imageを組み立てる。

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
