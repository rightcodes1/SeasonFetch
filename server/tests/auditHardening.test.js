import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import app from "../app.js";
import { getSeries } from "../services/cinemeta.js";
import { explainSourceCandidates, GEMINI_TIMEOUT_MS, suggestSearchQueries } from "../services/gemini.js";
import { supabaseRequest, verifySupabaseToken } from "../services/supabaseAuth.js";

const execFileAsync = promisify(execFile);

async function withServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function mockUpstreamFetch(t, handler) {
  const originalFetch = global.fetch;
  global.fetch = (input, options) => {
    const url = new URL(input);
    if (url.hostname === "127.0.0.1") return originalFetch(input, options);
    return handler(input, options);
  };
  t.after(() => { global.fetch = originalFetch; });
}

test("CORS returns 403 for disallowed origins without executing route handlers or logging unhandled 500s", async t => {
  const upstreamCalls = [];
  mockUpstreamFetch(t, async url => {
    upstreamCalls.push(String(url));
    return Response.json({ unexpected: true });
  });

  const base = await withServer(t);
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => { loggedErrors.push(args.map(String).join(" ")); };
  t.after(() => { console.error = originalConsoleError; });

  const disallowedGet = await fetch(`${base}/api/health`, {
    headers: { Origin: "https://evil.example" }
  });
  assert.equal(disallowedGet.status, 403);
  assert.equal(disallowedGet.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await disallowedGet.json(), { error: "Origin is not allowed by SeasonFetch." });

  const disallowedSearch = await fetch(`${base}/api/cinemeta/search?q=severance`, {
    headers: { Origin: "https://evil.example" }
  });
  assert.equal(disallowedSearch.status, 403);

  const disallowedAdmin = await fetch(`${base}/api/admin/users`, {
    headers: { Origin: "https://evil.example", Authorization: "Bearer fake" }
  });
  assert.equal(disallowedAdmin.status, 403);
  assert.deepEqual(upstreamCalls, []);

  const disallowedPreflight = await fetch(`${base}/api/gemini/search-assist`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.example",
      "Access-Control-Request-Method": "POST"
    }
  });
  assert.equal(disallowedPreflight.status, 403);
  assert.equal(disallowedPreflight.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await disallowedPreflight.json(), { error: "Origin is not allowed by SeasonFetch." });

  assert.equal(
    loggedErrors.some(line => line.includes("Unhandled server error:")),
    false,
    `Expected no unhandled 500 log for CORS 403, got: ${JSON.stringify(loggedErrors)}`
  );

  const allowedGet = await fetch(`${base}/api/health`, {
    headers: { Origin: "https://season-fetch.vercel.app" }
  });
  assert.equal(allowedGet.status, 200);
  assert.equal(allowedGet.headers.get("access-control-allow-origin"), "https://season-fetch.vercel.app");

  const noOriginGet = await fetch(`${base}/api/health`);
  assert.equal(noOriginGet.status, 200);
});

test("invalid series IMDb ID returns 400 with zero upstream fetches and getSeries sets statusCode 400", async t => {
  const requested = [];
  mockUpstreamFetch(t, async url => {
    requested.push(String(url));
    return Response.json({ meta: null });
  });

  await assert.rejects(
    () => getSeries("not-an-id"),
    error => error.statusCode === 400 && /Invalid series IMDb ID/i.test(error.message)
  );

  const base = await withServer(t);
  const response = await fetch(`${base}/api/cinemeta/series/not-an-id`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid series IMDb ID." });
  assert.deepEqual(requested, []);
});

test("ESM startup loads .env.local before sibling service modules capture environment variables", async t => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "seasonfetch-dotenv-"));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));

  await writeFile(
    path.join(tmpDir, ".env.local"),
    [
      "CINEMETA_BASE_URL=https://dotenv-order.test",
      "VITE_SUPABASE_URL=https://dotenv-order.supabase.co",
      "VITE_SUPABASE_ANON_KEY=dotenv-anon-key"
    ].join("\n"),
    "utf8"
  );

  const appUrl = pathToFileURL(path.resolve("server/app.js")).href;
  const cinemetaUrl = pathToFileURL(path.resolve("server/services/cinemeta.js")).href;
  const supabaseAuthUrl = pathToFileURL(path.resolve("server/services/supabaseAuth.js")).href;

  const probeScript = `
    const calls = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), headers: init?.headers || {} });
      if (String(input).startsWith("https://dotenv-order.test/meta/series/")) {
        return Response.json({ meta: { id: "tt1234567", type: "series", name: "Env Test", videos: [] } });
      }
      if (String(input).startsWith("https://dotenv-order.supabase.co/rest/v1/")) {
        return Response.json([]);
      }
      throw new Error("Unexpected URL: " + input);
    };
    await import(${JSON.stringify(appUrl)});
    const { getSeries } = await import(${JSON.stringify(cinemetaUrl)});
    const { supabaseRequest } = await import(${JSON.stringify(supabaseAuthUrl)});
    await getSeries("tt1234567");
    await supabaseRequest("profiles?select=id&limit=1", "fake-token");
    console.log(JSON.stringify(calls));
  `;

  const childEnv = { ...process.env };
  delete childEnv.CINEMETA_BASE_URL;
  delete childEnv.SUPABASE_URL;
  delete childEnv.VITE_SUPABASE_URL;
  delete childEnv.SUPABASE_ANON_KEY;
  delete childEnv.VITE_SUPABASE_ANON_KEY;

  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", probeScript], {
    cwd: tmpDir,
    env: childEnv
  });
  const calls = JSON.parse(stdout.trim().split(/\r?\n/).pop());
  assert.equal(calls[0].url, "https://dotenv-order.test/meta/series/tt1234567.json");
  assert.equal(calls[1].url, "https://dotenv-order.supabase.co/rest/v1/profiles?select=id&limit=1");
  assert.equal(calls[1].headers.apikey, "dotenv-anon-key");
});

test("App defines the spark icon and every Icon name referenced in JSX", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const iconsBlock = source.match(/const ICONS = \{([\s\S]*?)\n\};/)?.[1];
  assert.ok(iconsBlock, "ICONS map should exist in src/App.jsx");

  const definedIcons = new Map();
  for (const match of iconsBlock.matchAll(/^\s*([a-z0-9_-]+):\s*'([^']+)'/gm)) {
    definedIcons.set(match[1], match[2]);
  }
  assert.ok(definedIcons.has("spark"), "ICONS must define spark");
  assert.ok(definedIcons.get("spark").length > 0, "spark icon path must be non-empty");

  const referencedIcons = [...source.matchAll(/<Icon\s+name="([^"]+)"/g)].map(match => match[1]);
  assert.ok(referencedIcons.includes("spark"), "src/App.jsx should reference spark icon");
  for (const name of new Set(referencedIcons)) {
    assert.ok(definedIcons.has(name), `Icon "${name}" is referenced in src/App.jsx but missing from ICONS`);
  }
});

test("Gemini sends API key in x-goog-api-key header (not URL query) and configures a 15-second AbortSignal timeout", async t => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-secret-gemini-key";
  t.after(() => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });

  assert.equal(GEMINI_TIMEOUT_MS, 15_000);

  const captured = [];
  mockUpstreamFetch(t, async (input, options) => {
    captured.push({ url: String(input), options });
    if (captured.length === 1) {
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ queries: ["Breaking Bad"] }) }] } }]
      });
    }
    return Response.json({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              recommendedIndex: 0,
              confidence: "high",
              reason: "Smallest known 1080p release.",
              warnings: []
            })
          }]
        }
      }]
    });
  });

  const suggestions = await suggestSearchQueries("breking bad");
  assert.deepEqual(suggestions, ["Breaking Bad"]);

  const explanation = await explainSourceCandidates({
    seriesTitle: "Breaking Bad",
    season: 1,
    episode: 1,
    candidates: [{ title: "Breaking Bad S01E01 1080p", sizeBytes: 1_000_000_000, seeders: 100 }]
  });
  assert.equal(explanation.recommendation.recommendedIndex, 0);

  assert.equal(captured.length, 2);
  for (const call of captured) {
    const parsedUrl = new URL(call.url);
    assert.equal(parsedUrl.searchParams.has("key"), false, "Gemini URL must not include key query param");
    assert.equal(call.url.includes("test-secret-gemini-key"), false, "Gemini URL must not contain API key");
    assert.equal(call.options.headers["x-goog-api-key"], "test-secret-gemini-key");
    assert.ok(call.options.signal instanceof AbortSignal, "Gemini fetch must receive an AbortSignal timeout");
  }
});

test("Gemini endpoints return 502 cleanly when upstream requests time out", async t => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-secret-gemini-key";
  t.after(() => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });

  mockUpstreamFetch(t, async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });

  const base = await withServer(t);
  const searchRes = await fetch(`${base}/api/gemini/search-assist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "breking bad" })
  });
  assert.equal(searchRes.status, 502);

  const explainRes = await fetch(`${base}/api/gemini/explain-source`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidates: [{ title: "Show S01E01 1080p" }] })
  });
  assert.equal(explainRes.status, 502);
});

test("supabaseAuth normalizes trailing slashes and does not poison JWKS cache on malformed URLs", async t => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevViteUrl = process.env.VITE_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_ANON_KEY;
  const prevViteKey = process.env.VITE_SUPABASE_ANON_KEY;
  t.after(() => {
    const restore = (name, val) => { if (val === undefined) delete process.env[name]; else process.env[name] = val; };
    restore("SUPABASE_URL", prevUrl);
    restore("VITE_SUPABASE_URL", prevViteUrl);
    restore("SUPABASE_ANON_KEY", prevKey);
    restore("VITE_SUPABASE_ANON_KEY", prevViteKey);
  });

  const capturedUrls = [];
  mockUpstreamFetch(t, async url => {
    capturedUrls.push(String(url));
    return Response.json([]);
  });

  process.env.SUPABASE_URL = "https://project-a.supabase.co/";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  await supabaseRequest("profiles?select=id", "tok");
  assert.equal(capturedUrls[0], "https://project-a.supabase.co/rest/v1/profiles?select=id");

  await assert.rejects(() => verifySupabaseToken("not.a.jwt"), error => error.code === "ERR_JWS_INVALID");

  process.env.SUPABASE_URL = "not-a-valid-url";
  await assert.rejects(() => verifySupabaseToken("not.a.jwt"), error => error.code === "ERR_INVALID_URL");
  await assert.rejects(() => verifySupabaseToken("not.a.jwt"), error => error.code === "ERR_INVALID_URL");
});
