import { getReleaseIdentity, isValidReleaseMagnet } from './releaseSelection.js';

// Magnet file selection is deliberately checked more strictly than the general
// release helper: a file-specific selection must describe exactly that file.
function isValidSelectionMagnet(magnet, infoHash, fileIdx) {
  if (typeof magnet !== 'string' || !/^magnet:\?/i.test(magnet)
    || /[\s\p{Cc}\p{Cf}]/u.test(magnet)
    || !isValidReleaseMagnet(magnet, infoHash)) return false;

  try {
    const params = new URL(magnet).searchParams;
    // Count case variants as well, so an additional XT or SO cannot disguise
    // an ambiguous selection from a more permissive downstream consumer.
    const topics = [...params].filter(([name]) => name.toLowerCase() === 'xt');
    const files = [...params].filter(([name]) => name.toLowerCase() === 'so');
    if (topics.length !== 1 || topics[0][0] !== 'xt') return false;
    if (fileIdx === null) return files.length === 0;
    return files.length === 1 && files[0][0] === 'so' && files[0][1] === String(fileIdx);
  } catch {
    return false;
  }
}

function validIndex(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeReference(reference) {
  if (!reference || typeof reference !== 'object') return null;
  const mediaId = typeof reference.mediaId === 'string'
    ? reference.mediaId.trim()
    : validIndex(reference.mediaId) ? String(reference.mediaId) : '';
  if (!mediaId || typeof reference.mediaTitle !== 'string' || !reference.mediaTitle.trim()) return null;
  if (reference.manuallySelected !== undefined && typeof reference.manuallySelected !== 'boolean') return null;
  if (reference.label !== undefined && typeof reference.label !== 'string') return null;

  if (reference.type === 'episode') {
    if (!validIndex(reference.season) || !validIndex(reference.episode)) return null;
    if (reference.episodeTitle !== undefined && typeof reference.episodeTitle !== 'string') return null;
    return {
      type: 'episode',
      mediaId,
      mediaTitle: reference.mediaTitle,
      season: reference.season,
      episode: reference.episode,
      episodeTitle: reference.episodeTitle ?? '',
      manuallySelected: reference.manuallySelected ?? false,
      ...(reference.label !== undefined ? { label: reference.label } : {})
    };
  }
  if (reference.type === 'movie') {
    return {
      type: 'movie',
      mediaId,
      mediaTitle: reference.mediaTitle,
      ...(reference.manuallySelected !== undefined ? { manuallySelected: reference.manuallySelected } : {}),
      ...(reference.label !== undefined ? { label: reference.label } : {})
    };
  }
  return null;
}

function referenceId(reference) {
  return JSON.stringify(reference.type === 'episode'
    ? [reference.type, reference.mediaId, reference.season, reference.episode]
    : [reference.type, reference.mediaId]);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareTitles(a, b) {
  return compareText(a.toLowerCase(), b.toLowerCase()) || compareText(a, b);
}

function compareReferencePosition(a, b, titles) {
  return compareTitles(titles.get(a.mediaId), titles.get(b.mediaId))
    || compareText(a.mediaId, b.mediaId)
    || (a.type === 'episode' ? a.season : -1) - (b.type === 'episode' ? b.season : -1)
    || (a.type === 'episode' ? a.episode : -1) - (b.type === 'episode' ? b.episode : -1)
    || compareText(a.type, b.type);
}

function compareReferences(a, b, titles) {
  return compareReferencePosition(a, b, titles)
    || compareText(referenceId(a), referenceId(b))
    || compareTitles(a.mediaTitle, b.mediaTitle)
    || compareText(a.episodeTitle || '', b.episodeTitle || '')
    || compareText(a.label || '', b.label || '');
}

function sortSelections(selections) {
  // A single canonical title per media ID makes the comparison transitive,
  // even when labels for episodes of the same series have changed.
  const titles = new Map();
  for (const selection of selections) {
    for (const reference of selection.references) {
      const previous = titles.get(reference.mediaId);
      if (previous === undefined || compareTitles(reference.mediaTitle, previous) < 0) {
        titles.set(reference.mediaId, reference.mediaTitle);
      }
    }
  }
  for (const selection of selections) {
    selection.references.sort((a, b) => compareReferences(a, b, titles));
    const snapshots = new Map(selection._referenceSnapshots.map(snapshot => [snapshot.id, snapshot]));
    selection._referenceSnapshots = selection.references.map(reference => snapshots.get(referenceId(reference)));
    // Keep the latest representative while it still belongs to a reference;
    // if that reference moved, pick the first remaining reference's snapshot.
    if (!selection._referenceSnapshots.some(snapshot =>
      snapshot.magnet === selection.magnet && snapshot.title === selection.title)) {
      ({ magnet: selection.magnet, title: selection.title } = selection._referenceSnapshots[0]);
    }
    // A single reference's source is already fully represented by these fields.
    if (selection.references.length === 1) delete selection._referenceSnapshots;
  }
  return selections.sort((a, b) => compareReferencePosition(a.references[0], b.references[0], titles)
    || compareText(a.key, b.key));
}

/** Build a single validated logical download with one episode or movie reference. */
export function createDownloadSelection(release, reference) {
  if (!release || typeof release !== 'object' || release.preview) return null;
  const { infoHash, fileIdx, magnet } = release;
  if (fileIdx !== null && !validIndex(fileIdx)) return null;
  const key = getReleaseIdentity({ infoHash, fileIdx });
  const normalizedReference = normalizeReference(reference);
  if (!key || !normalizedReference || !isValidSelectionMagnet(magnet, infoHash, fileIdx)) return null;
  return {
    key,
    infoHash: infoHash.toLowerCase(),
    fileIdx,
    magnet,
    title: typeof release.title === 'string' ? release.title : '',
    references: [normalizedReference]
  };
}

/** Convert an existing episode row and its series context to a selection. */
export function createEpisodeDownloadSelection(episode, context) {
  if (!episode || !context) return null;
  return createDownloadSelection({
    infoHash: episode.hash,
    fileIdx: episode.fileIdx,
    magnet: episode.magnet,
    title: episode.format,
    preview: episode.preview
  }, {
    type: 'episode',
    mediaId: context.seriesId,
    mediaTitle: context.seriesTitle,
    season: context.season,
    episode: episode.number,
    episodeTitle: typeof episode.title === 'string' ? episode.title : '',
    manuallySelected: Boolean(episode.manualSelectionId)
  });
}

// Revalidate callers' data, including every reference, snapshot and derived key.
// Missing/invalid snapshot metadata falls back to the validated group source,
// which also provides backwards compatibility with selections created earlier.
function normalizeSelection(selection) {
  if (!selection || typeof selection !== 'object' || !Array.isArray(selection.references)) return null;
  let normalized = null;
  const entries = [];
  for (const reference of selection.references) {
    const one = createDownloadSelection(selection, reference);
    if (!one || selection.key !== one.key) continue;
    normalized = one;
    entries.push({ reference: one.references[0] });
  }
  if (!normalized) return null;

  const snapshots = new Map();
  if (Array.isArray(selection._referenceSnapshots)) {
    for (const snapshot of selection._referenceSnapshots) {
      if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.id !== 'string'
        || typeof snapshot.title !== 'string'
        || !isValidSelectionMagnet(snapshot.magnet, normalized.infoHash, normalized.fileIdx)) continue;
      const previous = snapshots.get(snapshot.id);
      // Malformed duplicate IDs must not make the result depend on their order.
      if (!previous || compareText(snapshot.magnet, previous.magnet) < 0
        || (snapshot.magnet === previous.magnet && compareText(snapshot.title, previous.title) < 0)) {
        snapshots.set(snapshot.id, { magnet: snapshot.magnet, title: snapshot.title });
      }
    }
  }
  for (const entry of entries) {
    const snapshot = snapshots.get(referenceId(entry.reference)) || normalized;
    entry.magnet = snapshot.magnet;
    entry.title = snapshot.title;
  }
  return { key: normalized.key, infoHash: normalized.infoHash, fileIdx: normalized.fileIdx,
    magnet: normalized.magnet, title: normalized.title, entries };
}

/** Merge validated downloads, moving re-added episodes away from old releases. */
export function addDownloadSelections(current, additions) {
  const result = [];
  const existing = Array.isArray(current) ? current : [];
  const incoming = Array.isArray(additions) ? additions : additions == null ? [] : [additions];
  for (const candidate of [...existing, ...incoming]) {
    const selection = normalizeSelection(candidate);
    if (!selection) continue;
    for (const { reference, magnet, title } of selection.entries) {
      const id = referenceId(reference);
      if (reference.type === 'episode') {
        for (let i = result.length - 1; i >= 0; i -= 1) {
          if (result[i].key === selection.key) continue;
          result[i].references = result[i].references.filter(item => referenceId(item) !== id);
          result[i]._referenceSnapshots = result[i]._referenceSnapshots.filter(item => item.id !== id);
          if (!result[i].references.length) result.splice(i, 1);
        }
      }
      let target = result.find(item => item.key === selection.key);
      if (!target) {
        target = { key: selection.key, infoHash: selection.infoHash, fileIdx: selection.fileIdx,
          magnet: selection.magnet, title: selection.title, references: [], _referenceSnapshots: [] };
        result.push(target);
      } else {
        // The most recently supplied valid group source may update trackers or title.
        target.magnet = selection.magnet;
        target.title = selection.title;
      }
      const index = target.references.findIndex(item => referenceId(item) === id);
      const snapshot = { id, magnet, title };
      if (index < 0) {
        target.references.push(reference);
        target._referenceSnapshots.push(snapshot);
      } else {
        target.references[index] = reference;
        target._referenceSnapshots[index] = snapshot;
      }
    }
  }
  return sortSelections(result);
}

/** Remove an entire logical download, including every reference to it. */
export function removeDownloadSelection(current, key) {
  return addDownloadSelections(current, []).filter(selection => selection.key !== key);
}

/** Return one validated magnet per logical download in stable display order. */
export function serializeDownloadSelection(current) {
  return addDownloadSelections(current, []).map(selection => selection.magnet).join('\n');
}
