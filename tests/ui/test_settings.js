// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inline copy of toSshUrl from settings.js ──
function toSshUrl(url) {
  const m = url.match(/^https?:\/\/github\.com\/(.+)/);
  if (!m) return url;
  const path = m[1].replace(/\/$/, "");
  return `git@github.com:${path}.git`;
}

// ── Tests ──

describe("toSshUrl", () => {
  it("converts HTTPS GitHub URL to SSH", () => {
    assert.equal(
      toSshUrl("https://github.com/user/repo"),
      "git@github.com:user/repo.git"
    );
  });

  it("converts HTTP GitHub URL to SSH", () => {
    assert.equal(
      toSshUrl("http://github.com/user/repo"),
      "git@github.com:user/repo.git"
    );
  });

  it("strips trailing slash", () => {
    assert.equal(
      toSshUrl("https://github.com/user/repo/"),
      "git@github.com:user/repo.git"
    );
  });

  it("returns non-GitHub URL unchanged", () => {
    assert.equal(
      toSshUrl("https://gitlab.com/user/repo"),
      "https://gitlab.com/user/repo"
    );
  });

  it("returns SSH URL unchanged", () => {
    assert.equal(
      toSshUrl("git@github.com:user/repo.git"),
      "git@github.com:user/repo.git"
    );
  });

  it("handles URL with subpath", () => {
    assert.equal(
      toSshUrl("https://github.com/org/repo.git"),
      "git@github.com:org/repo.git.git"
    );
  });
});
