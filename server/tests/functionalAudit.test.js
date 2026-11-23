import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createScanCoordinator } from "../../src/utils/scanCoordinator.js";
import { copyTextToClipboard } from "../../src/utils/clipboard.js";
import { sendPasswordRecovery, signOutFromAuth } from "../../src/utils/accountActions.js";
import { normalizeRankingPreference, RANKING_PREFERENCES } from "../../shared/rankingPreferences.js";
import { processReleases, recommendationProfileForPreference } from "../intelligence/pipeline.js";
import { RECOMMENDATION_PROFILES } from "../intelligence/ranking/recommendationProfiles.js";
import { createRequireUser } from "../services/supabaseAuth.js";
import { avatarPathForSelection, getAvatarPresentation } from "../../src/utils/profileAvatar.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const HASHES = ['a', 'b', 'c', 'd', 'e', 'f'].map(char => char.repeat(40));

test('invalidating a pending scan clears checking and ignores its late response', async () => {
  const checking = [];
  let finishRequest;
  let successCount = 0;
  const coordinator = createScanCoordinator({ onCheckingChange: value => checking.push(value) });
  coordinator.start({ request: () => new Promise(resolve => { finishRequest = resolve; }), onSuccess: () => { successCount += 1; } });
  await delay(0);
  assert.deepEqual(checking, [true]);
  coordinator.invalidate();
  assert.deepEqual(checking, [true, false]);
  finishRequest({ stale: true });
  await delay(0);
  assert.equal(successCount, 0);
  assert.equal(coordinator.isCurrent(1), false);
});

test('a filter-change invalidation allows a replacement scan to finish', async () => {
  const checking = [];
  const completed = [];
  let finishOld;
  const coordinator = createScanCoordinator({ onCheckingChange: value => checking.push(value) });
  coordinator.start({ request: () => new Promise(resolve => { finishOld = resolve; }), onSuccess: data => completed.push(data) });
  await delay(0);
  coordinator.invalidate(); // Same invalidation path used by season/filter changes.
  coordinator.start({ request: async () => ({ filter: '720p' }), onSuccess: data => completed.push(data) });
  await delay(0);
  finishOld({ filter: 'stale' });
  await delay(0);
  assert.deepEqual(completed, [{ filter: '720p' }]);
  assert.deepEqual(checking, [true, false, true, false]);
});

test('invalidating during the delayed loading period prevents the request from starting', async () => {
  const checking = [];
  let requestCalls = 0;
  const coordinator = createScanCoordinator({ onCheckingChange: value => checking.push(value) });
  coordinator.start({ delayMs: 30, request: async () => { requestCalls += 1; }, onSuccess() {} });
  coordinator.invalidate();
  await delay(40);
  assert.equal(requestCalls, 0);
  assert.deepEqual(checking, [true, false]);
});

test('all visible ranking preferences have a canonical backend profile', () => {
  assert.equal(RANKING_PREFERENCES.length, 6);
  for (const { value } of RANKING_PREFERENCES) {
    assert.equal(normalizeRankingPreference(value), value);
    assert.equal(recommendationProfileForPreference(value), value);
  }
  assert.equal(new Set(RANKING_PREFERENCES.map(({ value }) => JSON.stringify(RECOMMENDATION_PROFILES[value]))).size, 6);
  assert.equal(normalizeRankingPreference(undefined), 'smallest-acceptable');
  assert.equal(normalizeRankingPreference('default'), 'smallest-acceptable');
});

test('ranking profiles select intentionally different candidates including 1337x evidence', () => {
  const candidates = [
    { title: 'Show S01E01 1080p WEB-DL 450 MB 👤 10', infoHash: HASHES[0] },
    { title: 'Show S01E01 1080p WEB-DL 2 GB 👤 800', infoHash: HASHES[1] },
    { title: 'Show S01E01 2160p WEB-DL HEVC 2 GB 👤 250', infoHash: HASHES[2] },
    { title: 'Show S01E01 1080p WEB-DL 1 GB 👤 200 1337x', infoHash: HASHES[3] },
    { title: 'Show S01E01 1080p WEB-DL HEVC 1 GB 👤 150', infoHash: HASHES[4] }
  ];
  const results = Object.fromEntries(RANKING_PREFERENCES.map(({ value }) => {
    const processed = processReleases(candidates, { profile: value, filters: { resolution: 'any' } });
    return [value, processed.ranked[0]?.infoHash];
  }));
  assert.equal(results['smallest-acceptable'], HASHES[0]);
  assert.equal(results['most-reliable'], HASHES[1]);
  assert.equal(results['prefer-1337x'], HASHES[3]);
  assert.equal(results['highest-quality'], HASHES[2]);
  assert.ok(new Set(Object.values(results)).size >= 4, `Expected distinct rankings, got ${JSON.stringify(results)}`);
});

test('clipboard reports successful write and legacy fallback only when copy succeeds', async () => {
  let copied = '';
  await copyTextToClipboard('magnet:?xt=urn:btih:test', { clipboard: { writeText: async value => { copied = value; } } });
  assert.equal(copied, 'magnet:?xt=urn:btih:test');

  let removed = false;
  const element = { value: '', style: {}, setAttribute() {}, select() {}, remove() { removed = true; } };
  await copyTextToClipboard('stremio://download', {
    clipboard: { writeText: async () => { throw new Error('denied'); } },
    documentRef: { createElement: () => element, body: { appendChild() {} }, execCommand: command => command === 'copy' }
  });
  assert.equal(element.value, 'stremio://download');
  assert.equal(removed, true);
});

test('clipboard reports denial when both native access and fallback fail', async () => {
  await assert.rejects(
    copyTextToClipboard('magnet:test', {
      clipboard: { writeText: async () => { throw new Error('permission denied'); } },
      documentRef: { createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }), body: { appendChild() {} }, execCommand: () => false }
    }), /permission denied/);
  await assert.rejects(copyTextToClipboard('magnet:test', { clipboard: null, documentRef: null }), /unavailable/);
});

test('avatar preset changes override an existing uploaded path; uploads remain images', () => {
  assert.equal(avatarPathForSelection('users/u1/avatar.png', '✦', true), 'preset:✦');
  assert.equal(avatarPathForSelection('users/u1/avatar.png', 'SF', false), 'users/u1/avatar.png');
  assert.deepEqual(getAvatarPresentation('preset:SF'), { type: 'preset', mark: 'SF' });
  assert.deepEqual(getAvatarPresentation('users/u1/avatar.png', 'https://cdn.test/avatar.png'), { type: 'image', url: 'https://cdn.test/avatar.png' });
});

test('password recovery and sign-out helpers propagate Supabase errors accurately', async () => {
  await assert.rejects(sendPasswordRecovery({ resetPasswordForEmail: async () => ({ error: new Error('recovery denied') }) }, 'user@example.com', 'https://example.test'), /recovery denied/);
  await assert.rejects(signOutFromAuth({ signOut: async () => ({ error: new Error('sign-out failed') }) }), /sign-out failed/);
  await sendPasswordRecovery({ resetPasswordForEmail: async () => ({ error: null }) }, 'user@example.com', 'https://example.test');
  await signOutFromAuth({ signOut: async () => ({ error: null }) });
});

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('protected-request middleware denies suspended users and permits active users', async () => {
  let nextCalls = 0;
  const suspended = createRequireUser({ verifyToken: async () => ({ sub: 'user-1' }), checkSuspension: async id => id === 'user-1' });
  const suspendedResponse = responseRecorder();
  await suspended({ headers: { authorization: 'Bearer token' } }, suspendedResponse, () => { nextCalls += 1; });
  assert.equal(suspendedResponse.statusCode, 403);
  assert.deepEqual(suspendedResponse.body, { error: 'Account suspended.' });
  assert.equal(nextCalls, 0);

  const active = createRequireUser({ verifyToken: async () => ({ sub: 'user-2' }), checkSuspension: async () => false });
  const activeReq = { headers: { authorization: 'Bearer token' } };
  const activeResponse = responseRecorder();
  await active(activeReq, activeResponse, () => { nextCalls += 1; });
  assert.equal(activeResponse.statusCode, 200);
  assert.equal(nextCalls, 1);
  assert.equal(activeReq.supabaseUser.sub, 'user-2');
});

test('suspension middleware gates protected HTTP API access', async t => {
  const app = express();
  app.get('/api/protected', createRequireUser({
    verifyToken: async token => ({ sub: token === 'suspended' ? 'user-suspended' : 'user-active' }),
    checkSuspension: async id => id === 'user-suspended'
  }), (req, res) => res.json({ userId: req.supabaseUser.sub }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  const suspended = await fetch(`http://127.0.0.1:${address.port}/api/protected`, { headers: { authorization: 'Bearer suspended' } });
  assert.equal(suspended.status, 403);
  assert.deepEqual(await suspended.json(), { error: 'Account suspended.' });
  const active = await fetch(`http://127.0.0.1:${address.port}/api/protected`, { headers: { authorization: 'Bearer active' } });
  assert.equal(active.status, 200);
  assert.deepEqual(await active.json(), { userId: 'user-active' });
});

test('protected-request middleware fails closed if suspension status cannot be verified', async () => {
  const middleware = createRequireUser({ verifyToken: async () => ({ sub: 'user-3' }), checkSuspension: async () => { throw new Error('database unavailable'); } });
  const response = responseRecorder();
  let nextCalls = 0;
  await middleware({ headers: { authorization: 'Bearer token' } }, response, () => { nextCalls += 1; });
  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /verify account status/i);
  assert.equal(nextCalls, 0);
});
