function titleKey(title = "") {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function known(value) {
  return value !== null && value !== undefined && value !== "";
}

function metadataRichness(release) {
  const source = release?.source || {};
  const audioClass = release?.audio?.classification;
  const evidenceScore = audioClass === "explicit-english-dub" ? 2 : audioClass === "possible-english-audio" ? 1 : 0;
  const fields = [
    release?.resolution,
    release?.codec,
    release?.hdr,
    release?.container,
    release?.sizeBytes,
    release?.seeders,
    release?.fileIdx,
    release?.releaseType,
    release?.releaseGroup,
    source?.metadataCompleteness
  ].filter(known).length;
  return {
    completeness: Number.isFinite(source.metadataCompleteness) ? source.metadataCompleteness : 0,
    fields,
    evidenceScore
  };
}

function compareRepresentatives(left, right) {
  const leftRichness = metadataRichness(left);
  const rightRichness = metadataRichness(right);
  return rightRichness.completeness - leftRichness.completeness
    || rightRichness.fields - leftRichness.fields
    || rightRichness.evidenceScore - leftRichness.evidenceScore
    || String(left.id).localeCompare(String(right.id));
}

export function identifyDuplicates(releases = []) {
  const groups = new Map();
  for (const release of releases) {
    const key = release.infoHash ? `${release.infoHash}:${release.fileIdx ?? "all"}` : `title:${titleKey(release.title)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(release);
  }
  return [...groups.entries()].map(([key, items]) => ({
    id: key,
    releases: items,
    representative: [...items].sort(compareRepresentatives)[0]
  }));
}
