const UNITS = ["vh", "lvh", "svh", "dvh"] as const;

type ViewportUnit = typeof UNITS[number];

function measureHeights(units: readonly ViewportUnit[]): number[] {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;width:1px;";
  document.body.appendChild(probe);
  const heights = units.map((unit) => {
    probe.style.height = `100${unit}`;
    return Math.round(probe.getBoundingClientRect().height);
  });
  probe.remove();
  return heights;
}

export function readViewportUnitHeights(): string {
  return measureHeights(UNITS).map((height, i) => `${UNITS[i]} ${height}`).join(" / ");
}

/** iPhone Duo の回転時は innerHeight が lvh より小さく報告され、下に空きが出るため lvh を併用する。 */
export function readLargeViewportHeightPx(): number {
  return measureHeights(["lvh"])[0];
}
