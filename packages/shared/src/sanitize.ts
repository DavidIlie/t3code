/**
 * Strips all HTML/XML tags from a string, leaving only plain text content.
 * Also collapses excessive whitespace introduced by tag removal.
 *
 * Useful for sanitizing error messages that may contain raw HTTP error pages
 * (e.g. Cloudflare 403 pages with full HTML body).
 */
export function stripHtmlTags(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
