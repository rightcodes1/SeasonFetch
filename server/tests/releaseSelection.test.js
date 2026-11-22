import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEpisodeReleaseFields,
  getReleaseIdentity,
  isValidReleaseMagnet,
  restoreEpisodeRecommendation,
  selectEpisodeRelease
} from '../../src/utils/releaseSelection.js';

const hashA = 'a'.repeat(40);
const hashB = 'b'.repeat(40);

function release(infoHash, overrides = {}) {
  return {
    infoHash,
    fileIdx: 2,
    title: `Release ${infoHash[0]}`,
    magnet: `magnet:?xt=urn:btih:${infoHash}&dn=release`,
    rawMagnet: `magnet:?xt=urn:btih:${infoHash}`,
    sourceUrl: 'https://torrentio.example/source',
    provider: 'Torrentio',
    resolution: '1080p',
    sizeBytes: 1024,
    sizeLabel: '1.0 KB',
    seeders: 25,
    audio: 'english-dubbed',
    audioEvidence: 'explicit-english-dub',
    releaseGroup: 'ExampleGroup',
    ...overrides
  };
}

function episode(id, recommended, candidates) {
  return {
    id,
    candidates,
    recommendedSource: recommended,
    recommendedSelectionId: getReleaseIdentity(recommended),
    activeSelectionId: getReleaseIdentity(recommended),
    manualSelectionId: '',
    recommendedSelectionReason: 'Automatic recommendation reason.',
    ...getEpisodeReleaseFields(recommended)
  };
}

test('manual selection updates the active source fields and marks it unverified', () => {
  const recommendation = release(hashA);
  const alternative = release(hashB, { fileIdx: 7, title: 'Alternative release', seeders: 0 });
  const item = episode('s1e1', recommendation, [recommendation, alternative]);
  const selected = selectEpisodeRelease([item], item.id, alternative)[0];

  assert.equal(selected.hash, hashB);
  assert.equal(selected.magnet, alternative.magnet);
  assert.equal(selected.rawMagnet, alternative.rawMagnet);
  assert.equal(selected.fileIdx, 7);
  assert.equal(selected.sourceUrl, alternative.sourceUrl);
  assert.equal(selected.format, 'Alternative release');
  assert.equal(selected.manualSelectionId, getReleaseIdentity(alternative));
  assert.match(selected.selectionReason, /not verified/i);
  assert.equal(selected.recommendedSource, recommendation);
});

test('restoring recommendation replaces the manual source without changing other episodes', () => {
  const recommendation = release(hashA);
  const alternative = release(hashB);
  const first = episode('s1e1', recommendation, [recommendation, alternative]);
  const second = episode('s1e2', release('c'.repeat(40)), []);
  const selected = selectEpisodeRelease([first, second], first.id, alternative);
  const restored = restoreEpisodeRecommendation(selected, first.id);

  assert.equal(restored[0].hash, hashA);
  assert.equal(restored[0].magnet, recommendation.magnet);
  assert.equal(restored[0].rawMagnet, recommendation.rawMagnet);
  assert.equal(restored[0].fileIdx, recommendation.fileIdx);
  assert.equal(restored[0].manualSelectionId, '');
  assert.equal(restored[0].selectionReason, 'Automatic recommendation reason.');
  assert.equal(restored[1], second);
});

test('episode selections are independent and duplicate identities include file indexes', () => {
  const firstRecommended = release(hashA, { fileIdx: 1 });
  const firstAlternative = release(hashB, { fileIdx: 4 });
  const secondRecommended = release('c'.repeat(40));
  const first = episode('s1e1', firstRecommended, [firstRecommended, firstAlternative]);
  const second = episode('s1e2', secondRecommended, []);

  const changed = selectEpisodeRelease([first, second], first.id, firstAlternative);
  assert.equal(changed[0].hash, hashB);
  assert.equal(changed[1], second);
  assert.notEqual(getReleaseIdentity(release(hashA, { fileIdx: 1 })), getReleaseIdentity(release(hashA, { fileIdx: 2 })));
  assert.equal(getReleaseIdentity(release(hashA, { fileIdx: 1 })), getReleaseIdentity(release(hashA.toUpperCase(), { fileIdx: 1 })));
});

test('missing metadata stays unknown and is not fabricated', () => {
  const fields = getEpisodeReleaseFields(release(hashA, {
    title: undefined,
    resolution: undefined,
    sizeBytes: null,
    sizeLabel: undefined,
    seeders: undefined,
    audio: undefined,
    audioEvidence: undefined,
    releaseGroup: undefined,
    provider: undefined,
    name: undefined,
    sourceUrl: undefined,
    externalUrl: undefined
  }));

  assert.equal(fields.format, '');
  assert.equal(fields.resolution, null);
  assert.equal(fields.size, 'Unknown');
  assert.equal(fields.seeders, null);
  assert.equal(fields.audio, null);
  assert.equal(fields.audioEvidence, 'unverified');
  assert.equal(fields.releaseGroup, null);
  assert.equal(fields.provider, '');
  assert.equal(fields.sourceUrl, '');
  assert.equal(fields.status, 'size-unknown');
});

test('empty, invalid, or mismatched magnets cannot be activated', () => {
  const recommendation = release(hashA);
  const noMagnet = release(hashB, { magnet: '' });
  const mismatched = release(hashB, { magnet: `magnet:?xt=urn:btih:${hashA}` });
  const item = episode('s1e1', recommendation, [recommendation, noMagnet, mismatched]);

  assert.equal(isValidReleaseMagnet('', hashB), false);
  assert.equal(isValidReleaseMagnet('https://example.com/file', hashB), false);
  assert.equal(isValidReleaseMagnet(`magnet:?xt=urn:btih:${hashA}`, hashB), false);
  assert.equal(isValidReleaseMagnet(`magnet:?xt=urn:btih:${hashB}&xt=urn:btih:${hashA}`, hashB), false);
  assert.equal(selectEpisodeRelease([item], item.id, noMagnet)[0], item);
  assert.equal(selectEpisodeRelease([item], item.id, mismatched)[0], item);
  assert.equal(selectEpisodeRelease([item], item.id, { ...release(hashB), title: 'Not in this episode' })[0], item);
  assert.equal(selectEpisodeRelease([item], 'missing-episode', recommendation)[0], item);
});
