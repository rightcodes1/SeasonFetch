function titleKey(title = "") {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function identifyDuplicates(releases = []) {
  const groups = new Map();
  for (const release of releases) {
    const key = release.infoHash ? `${release.infoHash}:${release.fileIdx ?? "all"}` : `title:${titleKey(release.title)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(release);
  }
  return [...groups.entries()].map(([key, items]) => ({ id: key, releases: items, representative: items[0] }));
}
