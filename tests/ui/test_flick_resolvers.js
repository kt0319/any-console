// @ts-check
import { describe, it, expect } from "vitest";
import { arrowResolver, enterResolver } from "../../ui/utils/flick-resolvers.js";

describe("arrowResolver", () => {
  it("returns ArrowLeft for left flick", () => {
    expect(arrowResolver(-20, 0, 10)).toEqual({ key: "ArrowLeft" });
  });

  it("returns ArrowRight for right flick", () => {
    expect(arrowResolver(20, 0, 10)).toEqual({ key: "ArrowRight" });
  });

  it("returns ArrowUp for upward flick", () => {
    expect(arrowResolver(0, -20, 10)).toEqual({ key: "ArrowUp" });
  });

  it("returns ArrowDown for downward flick", () => {
    expect(arrowResolver(0, 20, 10)).toEqual({ key: "ArrowDown" });
  });

  it("returns null when below threshold", () => {
    expect(arrowResolver(5, 5, 10)).toBeNull();
  });
});

describe("enterResolver", () => {
  it("returns Tab for upward flick", () => {
    expect(enterResolver(0, -20, 10)).toEqual({ key: "Tab" });
  });

  it("returns space for downward flick", () => {
    expect(enterResolver(0, 20, 10)).toEqual({ key: " " });
  });

  it("returns Backspace for leftward flick", () => {
    expect(enterResolver(-20, 0, 10)).toEqual({ key: "Backspace" });
  });

  it("returns Delete for rightward flick", () => {
    expect(enterResolver(20, 0, 10)).toEqual({ key: "Delete" });
  });

  it("returns null when below threshold", () => {
    expect(enterResolver(5, 5, 10)).toBeNull();
  });
});
