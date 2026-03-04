// @ts-check

/** @type {number} */
export const GIT_LOG_ENTRIES_PER_PAGE = 30;

/** @type {Record<string, string>} */
export let diffChunks = {};

/** @type {string} */
export let diffFullText = "";

/**
 * @param {Record<string, string>} v
 */
export function setDiffChunks(v) { diffChunks = v; }

/**
 * @param {string} v
 */
export function setDiffFullText(v) { diffFullText = v; }
