export type SafeAreaInsets = { top: number, right: number, bottom: number, left: number };

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;

export function readSafeAreaInsets(): SafeAreaInsets {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;"
    + SIDES.map((side) => `padding-${side.toLowerCase()}:env(safe-area-inset-${side.toLowerCase()},0px);`).join("");
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const px = (side: typeof SIDES[number]) => Number.parseFloat(style[`padding${side}`]) || 0;
  const insets = { top: px("Top"), right: px("Right"), bottom: px("Bottom"), left: px("Left") };
  probe.remove();
  return insets;
}

export function formatSafeAreaInsets(insets: SafeAreaInsets): string {
  return `T${insets.top} R${insets.right} B${insets.bottom} L${insets.left}`;
}
