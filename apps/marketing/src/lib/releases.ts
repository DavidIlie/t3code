const REPO = "DavidIlie/t3code";

export const RELEASES_URL = `https://github.com/${REPO}/releases`;

const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export async function fetchLatestRelease(): Promise<Release> {
  // Always fetch fresh — the GitHub API is fast and we don't want stale
  // cached versions persisting across releases.
  const data = await fetch(API_URL).then((r) => r.json());
  return data;
}
