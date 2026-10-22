export function resolveAutoGrow({ scrollHeight, rowHeight, paddingPx, borderPx, maxRows }: {
  scrollHeight: number,
  rowHeight: number,
  paddingPx: number,
  borderPx: number,
  maxRows: number,
}): { heightPx: number, scrollable: boolean } {
  const wantedPx = scrollHeight + borderPx;
  const maxPx = rowHeight * maxRows + paddingPx + borderPx;
  return { heightPx: Math.min(wantedPx, maxPx), scrollable: wantedPx > maxPx };
}
