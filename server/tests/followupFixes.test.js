import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSearchCoordinator } from "../../src/utils/searchCoordinator.js";
import { toGeminiCandidate } from "../../src/utils/geminiCandidates.js";
import { rankingPreferenceDescription, RANKING_PREFERENCES } from "../../shared/rankingPreferences.js";
import { calculateSeasonSizeEstimate } from "../services/seasonSizeEstimate.js";
import { sanitizeCandidates } from "../services/gemini.js";
import { scoreRelease } from "../intelligence/ranking/scoreRelease.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("search timer invalidation prevents a delayed request from starting", async () => {
  const coordinator = createSearchCoordinator();
  let started = 0;
  coordinator.schedule(() => { started += 1; }, 30);
  coordinator.invalidate();
  await delay(45);
  assert.equal(started, 0);
});

for (const action of ["reset", "series selection"]) {
  test(`a late search response cannot restore results after ${action}`, async () => {
    const coordinator = createSearchCoordinator();
    let finishRequest;
    const pendingResponse = new Promise(resolve => { finishRequest = resolve; });
    const applied = [];

    coordinator.schedule(async requestId => {
      const response = await pendingResponse;
      if (coordinator.isCurrent(requestId)) applied.push(response);
    });
    await delay(5);
    coordinator.invalidate(); // The App uses this when reset() or chooseSeries() runs.
    finishRequest(["stale series"]);
    await delay(0);

    assert.deepEqual(applied, []);
  });
}

test("App wires search invalidation to reset, series selection and the delayed main search", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const reset = source.match(/function reset\(\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  const chooseSeries = source.match(/async function chooseSeries\(series\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(reset, /invalidateSearch\(\)/);
  assert.match(chooseSeries, /invalidateSearch\(\)/);
  assert.match(source, /searchCoordinatorRef\.current\.schedule\(async requestId/);
  assert.match(source, /searchCoordinatorRef\.current\.isCurrent\(requestId\)/);
});

test("profile RLS keeps private rows restricted while granting active administrators the directory read", async () => {
  const basePolicy = await readFile(new URL("../../supabase/migrations/0004_enforce_suspensions.sql", import.meta.url), "utf8");
  const adminPolicy = await readFile(new URL("../../supabase/migrations/0005_admin_private_profile_reads.sql", import.meta.url), "utf8");
  const api = await readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.match(basePolicy, /create policy "Read public profiles or own profile"[\s\S]*?on public\.profiles for select[\s\S]*?to anon, authenticated[\s\S]*?using \(is_public = true or \(\(select auth\.uid\(\)\) = id and public\.is_account_active\(\)\)\)/i);
  assert.match(adminPolicy, /on public\.profiles for select\s+to authenticated\s+using \(public\.is_admin\(\)\)/i);
  assert.doesNotMatch(adminPolicy, /\bto anon\b/i);
  assert.match(basePolicy, /select public\.is_account_active\(\) and exists[\s\S]*?from public\.admin_roles[\s\S]*?role = 'admin'/i);
  assert.match(api, /app\.get\("\/api\/admin\/users", requireUser, requireAdmin/);
  assert.match(api, /profiles\?select=id,username,display_name,bio,is_public,created_at,updated_at/);
});

test("anonymous public discovery APIs work while admin directory remains authentication protected", async t => {
  const originalFetch = globalThis.fetch;
  const oldEnvironment = Object.fromEntries(["CINEMETA_BASE_URL", "TORRENTIO_BASE_URL", "GEMINI_API_KEY"].map(key => [key, process.env[key]]));
  process.env.CINEMETA_BASE_URL = "https://seasonfetch-cinemeta.test";
  process.env.TORRENTIO_BASE_URL = "https://seasonfetch-torrentio.test";
  process.env.GEMINI_API_KEY = "";
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.startsWith("https://seasonfetch-cinemeta.test/catalog/")) {
      return new Response(JSON.stringify({ metas: [{ id: "tt1234567", type: "series", name: "Example Series", year: "2020" }] }), { status: 200 });
    }
    if (url.startsWith("https://seasonfetch-cinemeta.test/meta/")) {
      return new Response(JSON.stringify({ meta: { id: "tt1234567", type: "series", name: "Example Series", videos: [{ season: 1, episode: 1, title: "Pilot" }] } }), { status: 200 });
    }
    if (url.startsWith("https://seasonfetch-torrentio.test/")) {
      return new Response(JSON.stringify({ streams: [] }), { status: 200 });
    }
    return originalFetch(input);
  };

  const { default: app } = await import(`../app.js?public-discovery-test=${Date.now()}`);
  const server = app.listen(0);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (path, init) => originalFetch(`${origin}${path}`, init);

  const search = await get("/api/cinemeta/search?q=Example%20Series", { headers: { authorization: "Bearer suspended" } });
  assert.equal(search.status, 200);
  assert.equal((await search.json()).results[0].title, "Example Series");

  const series = await get("/api/cinemeta/series/tt1234567");
  assert.equal(series.status, 200);
  assert.equal((await series.json()).episodes["1"][0].number, 1);

  const torrentio = await get("/api/torrentio/season/tt1234567/1?episodes=1");
  assert.equal(torrentio.status, 200);
  assert.equal((await torrentio.json()).totalEpisodes, 1);

  const geminiStatus = await get("/api/gemini/status");
  assert.equal(geminiStatus.status, 200);
  const geminiSearch = await get("/api/gemini/search-assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "Example" }) });
  assert.equal(geminiSearch.status, 200);
  const geminiExplain = await get("/api/gemini/explain-source", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidates: [{ title: "Example" }] }) });
  assert.equal(geminiExplain.status, 200);

  const admin = await get("/api/admin/users");
  assert.equal(admin.status, 401);
});

test("unknown Gemini resolution stays null through client mapping and server sanitization", () => {
  const mappedUnknown = toGeminiCandidate({ title: "Release", resolution: undefined });
  assert.equal(mappedUnknown.resolution, null);
  const [sanitizedUnknown, sanitizedKnown] = sanitizeCandidates([mappedUnknown, { title: "Known", resolution: " 2160p " }]);
  assert.equal(sanitizedUnknown.resolution, null);
  assert.equal(sanitizedKnown.resolution, "2160p");
  assert.equal(scoreRelease({ resolution: null }, "best-overall").scoreBreakdown.quality, 0.575);
});

test("season size estimate is complete only when every requested episode has a known positive size", () => {
  const complete = calculateSeasonSizeEstimate([
    { selected: { sizeBytes: 1024 } },
    { selected: { sizeBytes: 2048 } },
    { selected: { sizeBytes: 3072 } }
  ]);
  assert.deepEqual(complete, { knownSizeBytes: 6144, knownEpisodeCount: 3, unknownEpisodeCount: 0, complete: true });

  const partial = calculateSeasonSizeEstimate([
    { selected: { sizeBytes: 1024 } },
    { selected: { sizeBytes: null } },
    { selected: null }
  ]);
  assert.deepEqual(partial, { knownSizeBytes: 1024, knownEpisodeCount: 1, unknownEpisodeCount: 2, complete: false });
  assert.deepEqual(calculateSeasonSizeEstimate([{ selected: { sizeBytes: 0 } }]), {
    knownSizeBytes: null, knownEpisodeCount: 0, unknownEpisodeCount: 1, complete: false
  });
});

test("each canonical ranking preference supplies distinct hero copy", () => {
  const descriptions = RANKING_PREFERENCES.map(({ value, description }) => {
    assert.ok(description.length > 0, `${value} needs a hero description`);
    assert.equal(rankingPreferenceDescription(value), description);
    return description;
  });
  assert.equal(new Set(descriptions).size, RANKING_PREFERENCES.length);
  assert.equal(rankingPreferenceDescription("missing-preference"), rankingPreferenceDescription("smallest-acceptable"));
});
