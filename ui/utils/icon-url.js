const URL_PATTERN = /^(https?:\/\/|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/;

export function looksLikeUrl(text) {
  return URL_PATTERN.test(text);
}

export function extractDomain(text) {
  try {
    if (text.startsWith("http://") || text.startsWith("https://")) return new URL(text).hostname;
    return text.split("/")[0];
  } catch {
    return text;
  }
}
