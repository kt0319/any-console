// @ts-check
import { describe, it, expect } from "vitest";
import { toSshUrl } from "../../ui/utils/settings-utils.js";

// ── Tests ──

describe("toSshUrl", () => {
  it("converts HTTPS GitHub URL to SSH", () => {
    expect(toSshUrl("https://github.com/user/repo")).toBe("git@github.com:user/repo.git");
  });

  it("converts HTTP GitHub URL to SSH", () => {
    expect(toSshUrl("http://github.com/user/repo")).toBe("git@github.com:user/repo.git");
  });

  it("strips trailing slash", () => {
    expect(toSshUrl("https://github.com/user/repo/")).toBe("git@github.com:user/repo.git");
  });

  it("returns non-GitHub URL unchanged", () => {
    expect(toSshUrl("https://gitlab.com/user/repo")).toBe("https://gitlab.com/user/repo");
  });

  it("returns SSH URL unchanged", () => {
    expect(toSshUrl("git@github.com:user/repo.git")).toBe("git@github.com:user/repo.git");
  });

  it("handles URL with subpath", () => {
    expect(toSshUrl("https://github.com/org/repo.git")).toBe("git@github.com:org/repo.git.git");
  });
});
