// @ts-check
import { describe, it, expect } from "vitest";
import {
  workspaceApiPath,
  terminalSessionFileContentPath,
  terminalSessionFilesPath,
  terminalSessionPath,
  terminalSessionHistoryPath,
  workspaceGitDiscardPath,
  workspaceDownloadPath,
  workspaceFileContentPath,
  workspaceCommitMessagePath,
  workspaceFileHistoryPath,
  workspaceFileDiffPath,
} from "../../ui/utils/endpoints.js";

// ── Tests ──

describe("workspaceApiPath", () => {
  it("builds basic path", () => {
    expect(workspaceApiPath("myrepo")).toBe("/workspaces/myrepo");
  });

  it("appends subpath", () => {
    expect(workspaceApiPath("myrepo", "/branches")).toBe("/workspaces/myrepo/branches");
  });

  it("encodes special characters", () => {
    expect(workspaceApiPath("my repo")).toBe("/workspaces/my%20repo");
  });

  it("encodes slashes in workspace name", () => {
    expect(workspaceApiPath("a/b")).toBe("/workspaces/a%2Fb");
  });

  it("handles empty workspace name", () => {
    expect(workspaceApiPath("")).toBe("/workspaces/");
  });
});

describe("terminalSessionPath", () => {
  it("builds session path", () => {
    expect(terminalSessionPath("abc")).toBe("/terminal/sessions/abc");
  });
  it("encodes special characters", () => {
    expect(terminalSessionPath("a b")).toBe("/terminal/sessions/a%20b");
  });
});

describe("terminalSessionHistoryPath", () => {
  it("builds history path", () => {
    expect(terminalSessionHistoryPath("abc")).toBe("/terminal/sessions/abc/history");
  });
});

describe("terminal session file paths", () => {
  it("builds session files path", () => {
    expect(terminalSessionFilesPath("abc", "src/main.js")).toBe("/terminal/sessions/abc/files?path=src%2Fmain.js");
  });

  it("builds session file content path", () => {
    expect(terminalSessionFileContentPath("abc", "src/main.js")).toBe("/terminal/sessions/abc/file-content?path=src%2Fmain.js");
  });
});

describe("workspaceGitDiscardPath", () => {
  it("builds discard path", () => {
    expect(workspaceGitDiscardPath("myrepo")).toBe("/workspaces/myrepo/git/discard");
  });
});

describe("workspaceDownloadPath", () => {
  it("builds download path with encoded file path", () => {
    expect(workspaceDownloadPath("repo", "foo/bar.txt")).toBe("/workspaces/repo/download?path=foo%2Fbar.txt");
  });
});

describe("workspaceFileContentPath", () => {
  it("builds file content path", () => {
    expect(workspaceFileContentPath("repo", "src/main.js")).toBe("/workspaces/repo/file-content?path=src%2Fmain.js");
  });
});

describe("workspaceCommitMessagePath", () => {
  it("builds commit message path", () => {
    expect(workspaceCommitMessagePath("repo", "abc123")).toBe("/workspaces/repo/commit-message?hash=abc123");
  });
});

describe("workspaceFileHistoryPath", () => {
  it("builds file history path", () => {
    expect(workspaceFileHistoryPath("repo", "src/app.js")).toBe("/workspaces/repo/file-history?path=src%2Fapp.js");
  });
});

describe("workspaceFileDiffPath", () => {
  it("builds file diff path", () => {
    expect(workspaceFileDiffPath("repo", "abc123", "src/app.js")).toBe("/workspaces/repo/file-diff/abc123?path=src%2Fapp.js");
  });
});
