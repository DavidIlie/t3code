const FILE_MENTION_RE = /@([\w./-]+(?:\/[\w./-]+)+)/g;

function shortenMentions(text: string): string {
  return text.replace(FILE_MENTION_RE, (_match, fullPath: string) => {
    const parts = fullPath.split("/");
    const basename = parts[parts.length - 1] ?? fullPath;
    return `@${basename}`;
  });
}

export function buildThreadTitle(raw: string, maxLength = 120): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  const shortened = shortenMentions(trimmed);
  if (shortened.length <= maxLength) return shortened;
  return shortened.slice(0, maxLength - 1) + "\u2026";
}
