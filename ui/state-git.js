let createBranchFromHash = null;
const GIT_LOG_ENTRIES_PER_PAGE = 30;
let gitLogLoaded = 0;
let isGitLogLoading = false;
let gitLogHasMore = true;
const gitLogSeenHashes = new Set();

let diffChunks = {};
let diffFullText = "";
