import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDownloadSelection,
  createEpisodeDownloadSelection,
  addDownloadSelections,
  removeDownloadSelection,
  serializeDownloadSelection
} from '../../src/utils/downloadSelection.js';
import { getEpisodeReleaseFields, getReleaseIdentity } from '../../src/utils/releaseSelection.js';
import { copyTextToClipboard } from '../../src/utils/clipboard.js';
import { normalizeStream } from '../utils/sourceParser.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const context = { seriesId: 'tt100', seriesTitle: 'Example Series', season: 1 };

function magnet(infoHash, fileIdx = null) {
  return `magnet:?xt=urn:btih:${infoHash}${fileIdx === null ? '' : `&so=${fileIdx}`}`;
}
function release(infoHash = A, fileIdx = null, overrides = {}) {
  return { infoHash, fileIdx, magnet: magnet(infoHash, fileIdx), title: 'Release title', ...overrides };
}
function episodeReference(episode = 1, overrides = {}) {
  return {
    type: 'episode', mediaId: 'tt100', mediaTitle: 'Example Series', season: 1,
    episode, episodeTitle: `Episode ${episode}`, manuallySelected: false, ...overrides
  };
}
function selection(infoHash = A, fileIdx = null, reference = episodeReference(), overrides = {}) {
  return createDownloadSelection(release(infoHash, fileIdx, overrides), reference);
}
function row(infoHash = A, fileIdx = null, number = 1, overrides = {}) {
  return {
    id: `tt100-1-${number}`, number, title: `Episode ${number}`, hash: infoHash,
    fileIdx, magnet: magnet(infoHash, fileIdx), format: '1080p WEB-DL',
    preview: false, manualSelectionId: '', ...overrides
  };
}

// Exercise the real server magnet generator and release field adapter together.
test('episode conversion accepts actual server magnets and preserves the row and context labels', () => {
  const source = normalizeStream({ infoHash: A.toUpperCase(), fileIdx: 0, title: '1080p release', sources: [] });
  const episode = { id: 'show-1-2', number: 2, title: 'A title', ...getEpisodeReleaseFields(source) };
  const result = createEpisodeDownloadSelection(episode, context);
  assert.deepEqual(result, {
    key: getReleaseIdentity({ infoHash: A, fileIdx: 0 }), infoHash: A, fileIdx: 0,
    magnet: source.magnet, title: '1080p release',
    references: [{ type: 'episode', mediaId: 'tt100', mediaTitle: 'Example Series', season: 1,
      episode: 2, episodeTitle: 'A title', manuallySelected: false }]
  });
});

test('episode manual flags are explicit and specials and whole torrents remain valid', () => {
  const selected = createEpisodeDownloadSelection(row(A, null, 1, {
    manualSelectionId: `${A}:all`
  }), { ...context, season: 0 });
  assert.equal(selected.fileIdx, null);
  assert.equal(selected.key, `${A}:all`);
  assert.equal(selected.references[0].season, 0);
  assert.equal(selected.references[0].manuallySelected, true);
  assert.equal(createEpisodeDownloadSelection(row(), context).references[0].manuallySelected, false);
});

test('generic selection supports movie IDs, titles, labels and explicit manual flags', () => {
  const movie = createDownloadSelection(release(A, 2), {
    type: 'movie', mediaId: 1234, mediaTitle: 'A Movie', label: 'The movie label', manuallySelected: false
  });
  assert.deepEqual(movie.references, [{
    type: 'movie', mediaId: '1234', mediaTitle: 'A Movie', label: 'The movie label', manuallySelected: false
  }]);
  const merged = addDownloadSelections([movie], [selection(A, 2)]);
  assert.equal(merged.length, 1);
  assert.deepEqual(new Set(merged[0].references.map(ref => ref.type)), new Set(['episode', 'movie']));
  assert.equal(merged[0].references.find(ref => ref.type === 'movie').label, 'The movie label');
});

test('bad or incomplete references and episodes are rejected without throwing', () => {
  for (const ref of [null, {}, { type: 'movie', mediaTitle: 'Film' },
    { type: 'movie', mediaId: 'x', mediaTitle: '  ' },
    { type: 'podcast', mediaId: 'x', mediaTitle: 'Podcast' },
    episodeReference(1, { mediaId: '' }), episodeReference(1, { season: -1 }),
    episodeReference(1, { season: '1' }), episodeReference(-1),
    episodeReference(1.5), episodeReference(1, { episodeTitle: 3 }),
    episodeReference(1, { manuallySelected: 'false' })]) {
    assert.equal(createDownloadSelection(release(), ref), null);
  }
  assert.equal(createEpisodeDownloadSelection(null, context), null);
  assert.equal(createEpisodeDownloadSelection(row(), null), null);
  assert.equal(createEpisodeDownloadSelection(row(), { ...context, seriesId: '' }), null);
  assert.equal(createEpisodeDownloadSelection(row(A, null, undefined, { number: NaN }), context), null);
});

test('file indexes must be explicit nonnegative safe integers or null; zero is not null', () => {
  assert.equal(selection(A, 0).key, `${A}:0`);
  assert.equal(selection(A, null).key, `${A}:all`);
  for (const fileIdx of [undefined, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', false, {}]) {
    assert.equal(createDownloadSelection(release(A, null, { fileIdx }), episodeReference()), null, String(fileIdx));
  }
});

test('magnets must match the hash and have exactly one matching xt', () => {
  for (const invalid of ['', 'https://example.test/file', `magnet:?xt=urn:btih:${B}`,
    `magnet:?xt=urn:btih:${A}&xt=urn:btih:${A}`,
    `magnet:?xt=urn:btih:${A}&xt=urn:btih:${B}`,
    `magnet:?xt=urn:btih:${A}&XT=urn:btih:${B}`,
    `magnet:?xt=urn:btih:${A}&%78t=urn:btih:${B}`,
    `magnet://example.test/?xt=urn:btih:${A}`, 'magnet:?dn=missing']) {
    assert.equal(createDownloadSelection(release(A, null, { magnet: invalid }), episodeReference()), null, invalid);
  }
  assert.equal(createDownloadSelection(release('not-a-hash', null, { magnet: magnet(A) }), episodeReference()), null);
  assert.equal(selection(A.toUpperCase()).infoHash, A);
  assert.equal(selection(A.toUpperCase()).key, `${A}:all`);
});

test('file-specific magnets require exactly one canonical matching so and whole torrents require none', () => {
  const invalid = [
    [0, magnet(A)], [2, magnet(A, 3)], [2, `${magnet(A, 2)}&so=2`],
    [2, `${magnet(A, 2)}&so=3`], [2, `${magnet(A, 2)}&SO=2`],
    [2, `magnet:?xt=urn:btih:${A}&so=02`], [2, `magnet:?xt=urn:btih:${A}&so=2,3`],
    [2, `magnet:?xt=urn:btih:${A}&so=-2`], [null, magnet(A, 0)],
    [null, `magnet:?xt=urn:btih:${A}&so=`], [null, `magnet:?xt=urn:btih:${A}&SO=1`]
  ];
  for (const [fileIdx, value] of invalid) {
    assert.equal(createDownloadSelection(release(A, fileIdx, { magnet: value }), episodeReference()), null, value);
  }
  assert.ok(selection(A, 0));
  assert.ok(selection(A, 2));
  assert.ok(selection(A, null));
});

test('rejects raw spaces, whitespace and control characters including newline injection', () => {
  for (const suffix of ['&dn=raw space', '\nmagnet:?xt=urn:btih:' + B, '\r\nextra', '\t&dn=x',
    '\0', '\u007f', '\u0085', '\u200b', '\u2028']) {
    const value = magnet(A) + suffix;
    assert.equal(createDownloadSelection(release(A, null, { magnet: value }), episodeReference()), null, JSON.stringify(suffix));
  }
  assert.ok(createDownloadSelection(release(A, null, { magnet: `${magnet(A)}&dn=encoded%20space` }), episodeReference()));
  assert.ok(createDownloadSelection(release(A, null, { magnet: `${magnet(A)}&dn=encoded%0Aname` }), episodeReference()));
});

test('previews cannot be selected even if a valid magnet is present', () => {
  assert.equal(createEpisodeDownloadSelection(row(A, null, 1, { preview: true }), context), null);
  assert.equal(createDownloadSelection(release(A, null, { preview: true }), episodeReference()), null);
  assert.equal(serializeDownloadSelection([{ ...selection(), preview: true }]), '');
});

test('deduplicates normalized hash and file index while merging all distinct references', () => {
  const first = selection(A, 2, episodeReference(1, { label: 'Pilot', manuallySelected: true }));
  const second = selection(A.toUpperCase(), 2, episodeReference(2, { label: 'Next' }));
  const result = addDownloadSelections([first], [second, first]);
  assert.equal(result.length, 1);
  assert.equal(result[0].key, `${A}:2`);
  assert.deepEqual(result[0].references.map(ref => ref.episode), [1, 2]);
  assert.equal(result[0].references[0].label, 'Pilot');
  assert.equal(result[0].references[0].manuallySelected, true);
  assert.equal(result[0].references[1].label, 'Next');
});

test('same torrent with different file indexes and whole-torrent selection are distinct', () => {
  const items = addDownloadSelections([], [
    selection(A, null, episodeReference(1)),
    selection(A, 0, episodeReference(2)),
    selection(A, 1, episodeReference(3))
  ]);
  assert.deepEqual(items.map(item => item.key), [`${A}:all`, `${A}:0`, `${A}:1`]);
  assert.equal(new Set(items.map(item => item.magnet)).size, 3);
});

test('moving one episode keeps a shared old download and all other references', () => {
  const one = selection(A, 0, episodeReference(1));
  const two = selection(A, 0, episodeReference(2));
  const old = addDownloadSelections([], [one, two]);
  const moved = selection(B, 7, episodeReference(1, { manuallySelected: true, episodeTitle: 'New label' }));
  const updated = addDownloadSelections(old, [moved]);
  assert.equal(updated.length, 2);
  assert.deepEqual(updated.find(item => item.key === `${A}:0`).references.map(ref => ref.episode), [2]);
  assert.deepEqual(updated.find(item => item.key === `${B}:7`).references.map(ref => ref.episode), [1]);
  assert.equal(updated.find(item => item.key === `${B}:7`).references[0].manuallySelected, true);
  assert.equal(updated.find(item => item.key === `${B}:7`).references[0].episodeTitle, 'New label');
});

test('moving the latest shared reference restores the surviving reference source snapshot', () => {
  const firstMagnet = `${magnet(A, 0)}&tr=https%3A%2F%2Ffirst.example%2Fannounce`;
  const secondMagnet = `${magnet(A, 0)}&tr=https%3A%2F%2Fsecond.example%2Fannounce`;
  const first = selection(A, 0, episodeReference(1), { magnet: firstMagnet, title: 'First source' });
  const second = selection(A, 0, episodeReference(2), { magnet: secondMagnet, title: 'Second source' });
  const shared = addDownloadSelections([], [first, second]);
  const unchanged = structuredClone(shared);
  assert.equal(shared[0].magnet, secondMagnet);
  assert.equal(shared[0].title, 'Second source');

  // Round-trip and re-normalization must preserve both snapshots, not just the representative.
  const reloaded = JSON.parse(JSON.stringify(shared));
  const moved = addDownloadSelections(reloaded, [selection(B, 7, episodeReference(2))]);
  const survivor = moved.find(item => item.key === `${A}:0`);
  assert.equal(survivor.magnet, firstMagnet);
  assert.equal(survivor.title, 'First source');
  assert.deepEqual(survivor.references.map(ref => ref.episode), [1]);
  assert.equal(serializeDownloadSelection(moved), `${firstMagnet}\n${magnet(B, 7)}`);
  assert.deepEqual(shared, unchanged);

  // Moving a non-representative keeps the still-referenced latest source.
  const otherMove = addDownloadSelections(shared, [selection(B, 7, episodeReference(1))]);
  assert.equal(otherMove.find(item => item.key === `${A}:0`).magnet, secondMagnet);
  assert.equal(otherMove.find(item => item.key === `${A}:0`).title, 'Second source');
  assert.deepEqual(shared, unchanged);
});

test('re-adding a shared reference refreshes only its snapshot', () => {
  const firstMagnet = `${magnet(A, 1)}&tr=first`;
  const secondMagnet = `${magnet(A, 1)}&tr=second`;
  const updatedMagnet = `${magnet(A, 1)}&tr=updated`;
  const first = selection(A, 1, episodeReference(1), { magnet: firstMagnet, title: 'First' });
  const second = selection(A, 1, episodeReference(2), { magnet: secondMagnet, title: 'Second' });
  const refreshed = selection(A, 1, episodeReference(1), { magnet: updatedMagnet, title: 'Updated' });
  const shared = addDownloadSelections(addDownloadSelections([], [first, second]), [refreshed]);
  assert.equal(shared[0].magnet, updatedMagnet);
  assert.equal(shared[0].title, 'Updated');
  const afterMove = addDownloadSelections(shared, [selection(B, 0, episodeReference(1))]);
  assert.equal(afterMove.find(item => item.key === `${A}:1`).magnet, secondMagnet);
  assert.equal(afterMove.find(item => item.key === `${A}:1`).title, 'Second');
});

test('snapshot metadata is revalidated, isolated, and cannot bypass top-level validation', () => {
  const firstMagnet = `${magnet(A, 1)}&tr=first`;
  const secondMagnet = `${magnet(A, 1)}&tr=second`;
  const shared = addDownloadSelections([], [
    selection(A, 1, episodeReference(1), { magnet: firstMagnet, title: 'First' }),
    selection(A, 1, episodeReference(2), { magnet: secondMagnet, title: 'Second' })
  ]);
  const goodSnapshot = shared[0]._referenceSnapshots[0];
  for (const badMagnet of [magnet(B, 1), magnet(A, 2), `${magnet(A, 1)}&SO=1`,
    `${magnet(A, 1)}&xt=urn:btih:${A}`, `${magnet(A, 1)}\nINJECTED`, null]) {
    const malformed = structuredClone(shared);
    malformed[0]._referenceSnapshots[1].magnet = badMagnet;
    malformed[0]._referenceSnapshots.push(null, {}, { id: goodSnapshot.id, magnet: badMagnet, title: 'bad' });
    const before = structuredClone(malformed);
    const afterMove = addDownloadSelections(malformed, [selection(B, 0, episodeReference(2))]);
    assert.equal(afterMove.find(item => item.key === `${A}:1`).magnet, firstMagnet);
    assert.equal(afterMove.find(item => item.key === `${A}:1`).title, 'First');
    assert.equal(serializeDownloadSelection(afterMove).includes('INJECTED'), false);
    const invalidSurvivor = addDownloadSelections(malformed, [selection(B, 0, episodeReference(1))]);
    assert.equal(invalidSurvivor.find(item => item.key === `${A}:1`).magnet, secondMagnet);
    assert.equal(invalidSurvivor.find(item => item.key === `${A}:1`).title, 'Second');
    assert.equal(serializeDownloadSelection(invalidSurvivor).includes('INJECTED'), false);
    assert.deepEqual(malformed, before);
  }
  const invalidTop = structuredClone(shared);
  invalidTop[0].magnet += '\nINJECTED';
  assert.deepEqual(addDownloadSelections(invalidTop, []), []);
  assert.equal(serializeDownloadSelection(invalidTop), '');

  // Missing or malformed metadata is treated as a legacy group using its valid source.
  for (const metadata of [undefined, null, {}, 'bad', [null, {}]]) {
    const legacy = { ...shared[0], _referenceSnapshots: metadata };
    const surviving = addDownloadSelections([legacy], [selection(B, 0, episodeReference(2))]);
    assert.equal(surviving.find(item => item.key === `${A}:1`).magnet, secondMagnet);
  }

  const malformedTitle = structuredClone(shared);
  malformedTitle[0]._referenceSnapshots[0].title = { unsafe: true };
  const moved = addDownloadSelections(malformedTitle, [selection(B, 0, episodeReference(2))]);
  assert.equal(moved.find(item => item.key === `${A}:1`).magnet, secondMagnet);
  assert.equal(moved.find(item => item.key === `${A}:1`).title, 'Second');
  const clone = addDownloadSelections(shared, []);
  clone[0]._referenceSnapshots[0].magnet = 'changed';
  assert.equal(shared[0]._referenceSnapshots[0].magnet, firstMagnet);
});

test('duplicate snapshot IDs are resolved deterministically after validation', () => {
  const firstMagnet = `${magnet(A)}&tr=first`;
  const secondMagnet = `${magnet(A)}&tr=second`;
  const alternative = `${magnet(A)}&tr=alternative`;
  const shared = addDownloadSelections([], [
    selection(A, null, episodeReference(1), { magnet: firstMagnet, title: 'First' }),
    selection(A, null, episodeReference(2), { magnet: secondMagnet, title: 'Second' })
  ]);
  const duplicate = { ...shared[0]._referenceSnapshots[0], magnet: alternative, title: 'Alternative' };
  const snapshots = [...shared[0]._referenceSnapshots, duplicate];
  for (const list of [snapshots, [...snapshots].reverse()]) {
    const modified = { ...shared[0], _referenceSnapshots: list };
    const moved = addDownloadSelections([modified], [selection(B, null, episodeReference(2))]);
    const survivor = moved.find(item => item.key === `${A}:all`);
    assert.equal(survivor.magnet, alternative);
    assert.equal(survivor.title, 'Alternative');
  }
});

test('moving the only episode removes its old release; restoring clears the manual flag', () => {
  const original = selection(A, null, episodeReference(1));
  const manual = selection(B, null, episodeReference(1, { manuallySelected: true }));
  const changed = addDownloadSelections([original], [manual]);
  assert.deepEqual(changed.map(item => item.key), [`${B}:all`]);
  const restored = addDownloadSelections(changed, [original]);
  assert.deepEqual(restored.map(item => item.key), [`${A}:all`]);
  assert.equal(restored[0].references[0].manuallySelected, false);
});

test('episode identity includes series and season, not merely number, title or local row ID', () => {
  const one = selection(A, null, episodeReference(1));
  const otherSeries = selection(A, null, episodeReference(1, { mediaId: 'tt200', mediaTitle: 'Other' }));
  const otherSeason = selection(A, null, episodeReference(1, { season: 2 }));
  const merged = addDownloadSelections([], [one, otherSeries, otherSeason]);
  assert.equal(merged[0].references.length, 3);
  const moved = addDownloadSelections(merged, [selection(B, null, episodeReference(1))]);
  assert.equal(moved.find(item => item.key === `${A}:all`).references.length, 2);
  assert.equal(moved.find(item => item.key === `${B}:all`).references[0].mediaId, 'tt100');
});

test('re-adding the same reference replaces its labels and explicit manual flag', () => {
  const initial = selection(A, 1, episodeReference(2, { label: 'Old', manuallySelected: true }));
  const newer = selection(A, 1, episodeReference(2, { label: 'New', manuallySelected: false }), { title: 'Updated' });
  const result = addDownloadSelections([initial], [newer]);
  assert.equal(result.length, 1);
  assert.equal(result[0].references.length, 1);
  assert.equal(result[0].references[0].label, 'New');
  assert.equal(result[0].references[0].manuallySelected, false);
  assert.equal(result[0].title, 'Updated');
});

test('invalid additions do not evict existing references; malformed references are filtered individually', () => {
  const original = selection(A, null, episodeReference(1));
  const invalid = { ...selection(B, null, episodeReference(1)), magnet: `${magnet(B)}\ninjected` };
  assert.deepEqual(addDownloadSelections([original], [invalid, null, {}, undefined]), [original]);
  const mixed = { ...original, references: [null, episodeReference(1), {}, episodeReference(2)] };
  assert.deepEqual(addDownloadSelections([], [mixed])[0].references.map(ref => ref.episode), [1, 2]);
  assert.deepEqual(addDownloadSelections([], [{ ...original, key: 'wrong' }]), []);
});

test('removal deletes an entire unique download, handles unknown keys and allows clear/empty', () => {
  const shared = addDownloadSelections([], [selection(A, 2, episodeReference(1)), selection(A, 2, episodeReference(2)), selection(B, null, episodeReference(3))]);
  assert.deepEqual(shared.find(item => item.key === `${A}:2`).references.map(ref => ref.episode), [1, 2]);
  const remaining = removeDownloadSelection(shared, `${A}:2`);
  assert.deepEqual(remaining.map(item => item.key), [`${B}:all`]);
  assert.deepEqual(remaining.flatMap(item => item.references.map(ref => ref.episode)), [3]);
  assert.deepEqual(shared.find(item => item.key === `${A}:2`).references.map(ref => ref.episode), [1, 2]);
  assert.deepEqual(removeDownloadSelection(remaining, 'not-selected'), remaining);
  assert.deepEqual(removeDownloadSelection(remaining, `${B}:all`), []);
  assert.deepEqual(addDownloadSelections(null, null), []);
  assert.deepEqual(removeDownloadSelection(null, 'x'), []);
  assert.equal(serializeDownloadSelection([]), '');
  assert.equal(serializeDownloadSelection(null), '');
});

test('sorts by canonical media title, media ID, numeric season and episode regardless of insertion order', () => {
  const items = [
    selection(D, null, episodeReference(10, { mediaTitle: 'Beta', season: 1 })),
    selection(C, null, episodeReference(2, { mediaTitle: 'Beta', season: 1 })),
    selection(B, null, episodeReference(1, { mediaTitle: 'Beta', season: 2 })),
    selection(A, null, episodeReference(1, { mediaTitle: 'Alpha' }))
  ];
  const expected = [A, C, D, B].map(hash => `${hash}:all`);
  assert.deepEqual(addDownloadSelections([], items).map(item => item.key), expected);
  assert.deepEqual(addDownloadSelections([], [...items].reverse()).map(item => item.key), expected);
  // Different media IDs permit the same displayed title/season/episode on separate releases.
  const tie = [selection(B, null, episodeReference(1)), selection(A, null, episodeReference(1, { mediaId: 'tt999' }))];
  assert.deepEqual(addDownloadSelections([], tie).map(item => item.key), [`${B}:all`, `${A}:all`]);
});

test('same-media title changes cannot split or misorder series across mixed media', () => {
  const E = 'e'.repeat(40);
  const items = [
    selection(A, null, episodeReference(10, { mediaId: 'x', mediaTitle: 'Zulu', season: 1 })),
    selection(B, null, episodeReference(2, { mediaId: 'x', mediaTitle: 'zULU', season: 1 })),
    selection(C, null, episodeReference(1, { mediaId: 'x', mediaTitle: 'A series', season: 2 })),
    selection(D, null, episodeReference(1, { mediaId: 'y', mediaTitle: 'Middle' })),
    selection(E, null, episodeReference(1, { mediaId: 'z', mediaTitle: 'A series' }))
  ];
  const expected = [B, A, C, E, D].map(hash => `${hash}:all`);
  function permutations(values) {
    if (values.length < 2) return [values];
    return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index))
      .map(rest => [value, ...rest]));
  }
  for (const ordering of permutations(items)) {
    assert.deepEqual(addDownloadSelections([], ordering).map(item => item.key), expected);
  }

  const shared = addDownloadSelections([], [
    selection(A, null, episodeReference(10, { mediaId: 'x', mediaTitle: 'A series', season: 1 })),
    selection(A, null, episodeReference(2, { mediaId: 'x', mediaTitle: 'zULU', season: 1 })),
    selection(A, null, episodeReference(1, { mediaId: 'x', mediaTitle: 'Zulu', season: 2 })),
    selection(A, null, episodeReference(1, { mediaId: 'y', mediaTitle: 'Middle' }))
  ]);
  assert.deepEqual(shared[0].references.map(ref => [ref.mediaId, ref.season, ref.episode]), [
    ['x', 1, 2], ['x', 1, 10], ['x', 2, 1], ['y', 1, 1]
  ]);
  assert.deepEqual(addDownloadSelections(shared, [])[0].references, shared[0].references);
});

test('a shared download is ordered by its earliest sorted reference', () => {
  const shared = addDownloadSelections([], [selection(A, null, episodeReference(10)), selection(A, null, episodeReference(2))]);
  const other = selection(B, null, episodeReference(5));
  const ordered = addDownloadSelections([other], shared);
  assert.deepEqual(ordered.map(item => item.key), [`${A}:all`, `${B}:all`]);
  assert.deepEqual(ordered[0].references.map(ref => ref.episode), [2, 10]);
});

test('clipboard serialization emits exactly sorted valid magnets, one per release, without trailing newline', async () => {
  const ten = selection(B, 1, episodeReference(10));
  const two = selection(A, 0, episodeReference(2));
  const shared = selection(A, 0, episodeReference(3));
  const malformed = { ...selection(C, null, episodeReference(4)), magnet: `${magnet(C)}\nINJECTED` };
  const preview = { ...selection(D, null, episodeReference(5)), preview: true };
  const payload = serializeDownloadSelection([ten, two, shared, malformed, preview, null]);
  assert.equal(payload, `${magnet(A, 0)}\n${magnet(B, 1)}`);
  assert.equal(payload.endsWith('\n'), false);
  let copied = null;
  await copyTextToClipboard(payload, { clipboard: { writeText: async value => { copied = value; } } });
  assert.equal(copied, payload);
});

test('operations leave inputs and their references unchanged', () => {
  const current = [selection(A, null, episodeReference(1)), selection(A, null, episodeReference(2))];
  const additions = [selection(B, 0, episodeReference(1, { manuallySelected: true }))];
  const originalCurrent = structuredClone(current);
  const originalAdditions = structuredClone(additions);
  const result = addDownloadSelections(current, additions);
  removeDownloadSelection(result, `${A}:all`);
  serializeDownloadSelection(current);
  assert.deepEqual(current, originalCurrent);
  assert.deepEqual(additions, originalAdditions);
  result[0].references[0].mediaTitle = 'Changed';
  assert.deepEqual(current, originalCurrent);
  assert.deepEqual(additions, originalAdditions);
});
