// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { installTooltip } from "../../ui/utils/tooltip.ts";

function setHoverCapable(matches) {
  window.matchMedia = vi.fn().mockReturnValue({ matches });
}

function fireMouseover(target) {
  target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
}

describe("installTooltip", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("hover 可能なデバイスでは data-tooltip の内容を表示する", () => {
    setHoverCapable(true);
    installTooltip();
    const btn = document.createElement("button");
    btn.dataset.tooltip = "Show more";
    document.body.appendChild(btn);

    fireMouseover(btn);

    const tooltip = document.querySelector(".ac-tooltip");
    expect(tooltip.style.display).toBe("block");
    expect(tooltip.textContent).toBe("Show more");
  });

  it("hover 不可（タッチ）デバイスでは合成 mouseover でヒントを表示しない", () => {
    setHoverCapable(false);
    installTooltip();
    const btn = document.createElement("button");
    btn.dataset.tooltip = "Show more";
    document.body.appendChild(btn);

    fireMouseover(btn);

    const tooltip = document.querySelector(".ac-tooltip");
    expect(tooltip).toBeNull();
  });
});
