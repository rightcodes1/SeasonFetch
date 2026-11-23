import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStream } from '../utils/sourceParser.js';
import { getEpisodeReleaseFields, getReleaseIdentity, selectEpisodeRelease, restoreEpisodeRecommendation } from '../../src/utils/releaseSelection.js';
import { copyTextToClipboard } from '../../src/utils/clipboard.js';
import { buildStremioDownloadLink } from '../../src/utils/downloadLinks.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function source(hash, fileIdx, title) {
  return normalizeStream({
    infoHash: hash,
    fileIdx,
    title,
    sources: ['tracker:udp://tracker.example:80/announce']
  });
}

test('individual tracker and raw magnets remain distinct and copy without tray data', async () => {
  const item = getEpisodeReleaseFields(source(A, 0, '1080p first episode'));
  assert.ok(item.magnet.startsWith('magnet:?'));
  assert.ok(item.rawMagnet.startsWith('magnet:?'));
  assert.equal(new URL(item.magnet).searchParams.get('so'), '0');
  assert.equal(new URL(item.rawMagnet).searchParams.get('so'), '0');
  assert.equal(new URL(item.magnet).searchParams.get('tr'), 'udp://tracker.example:80/announce');
  assert.equal(new URL(item.rawMagnet).searchParams.get('tr'), null);
  const copied = [];
  const clipboard = { writeText: async value => copied.push(value) };
  await copyTextToClipboard(item.magnet, { clipboard });
  await copyTextToClipboard(item.rawMagnet, { clipboard });
  assert.deepEqual(copied, [item.magnet, item.rawMagnet]);
});

test('Stremio link preserves hash, zero file index, flags and missing-file behavior', async () => {
  const item = getEpisodeReleaseFields(source(A, 0, '1080p first episode'));
  const expected = `http://127.0.0.1:11470/${A}/0?external=1&download=1`;
  assert.equal(buildStremioDownloadLink(item), expected);
  let copied = '';
  await copyTextToClipboard(expected, { clipboard: { writeText: async value => { copied = value; } } });
  assert.equal(copied, expected);
  assert.equal(buildStremioDownloadLink(null), '');
  assert.equal(buildStremioDownloadLink({ hash: A, fileIdx: null }), '');
  assert.equal(buildStremioDownloadLink({ hash: A, fileIdx: -1 }), '');
  assert.equal(buildStremioDownloadLink({ hash: A, fileIdx: '0' }), '');
  assert.equal(buildStremioDownloadLink({ hash: '', fileIdx: 0 }), '');
});

test('individual magnet and Stremio links follow manual selection and recommendation restore', () => {
  const recommended = source(A, 1, 'Recommended');
  const manual = source(B, 3, 'Alternative');
  const item = {
    id: 'episode-2', candidates: [recommended, manual], recommendedSource: recommended,
    recommendedSelectionId: getReleaseIdentity(recommended),
    activeSelectionId: getReleaseIdentity(recommended), manualSelectionId: '',
    recommendedSelectionReason: 'Recommended', ...getEpisodeReleaseFields(recommended)
  };
  const selected = selectEpisodeRelease([item], item.id, manual)[0];
  assert.equal(selected.magnet, manual.magnet);
  assert.equal(selected.rawMagnet, manual.rawMagnet);
  assert.equal(buildStremioDownloadLink(selected), `http://127.0.0.1:11470/${B}/3?external=1&download=1`);
  const restored = restoreEpisodeRecommendation([selected], item.id)[0];
  assert.equal(restored.magnet, recommended.magnet);
  assert.equal(restored.rawMagnet, recommended.rawMagnet);
  assert.equal(buildStremioDownloadLink(restored), `http://127.0.0.1:11470/${A}/1?external=1&download=1`);
});
