import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import { createRequireUser } from "../services/supabaseAuth.js";
import {
  createLibraryService,
  sanitizeLibraryPatch,
  sanitizeLibraryPayload,
  validateLibraryKey
} from "../services/library.js";
import { createLibraryRouter } from "../routes/library.js";
import {
  buildLibrarySnapshot,
  computeLibraryCounts,
  filterLibraryItems,
  removeLocalLibraryItem,
  upsertLocalLibraryItem
} from "../../src/utils/libraryState.js";
import { parseSectionFromPath, pathForSection } from "../../src/utils/navigation.js";

function createInMemorySupabaseStub() {
  const libraryRows = new Map();
  const activeDays = new Set();
  const events = [];
  const calls = [];
  let failEvents = false;

  async function request(path, token, options = {}) {
    calls.push({ path, token, method: options.method || "GET", headers: options.headers || {} });
    const method = (options.method || "GET").toUpperCase();
    const [resource, query = ""] = path.split("?");
    const params = new URLSearchParams(query);

    if (resource === "product_events" && method === "POST") {
      if (failEvents) throw new Error("telemetry outage");
      events.push(JSON.parse(options.body));
      return null;
    }

    if (resource === "user_active_days" && method === "POST") {
      const body = JSON.parse(options.body);
      activeDays.add(`${body.user_id}:${body.active_date}`);
      return null;
    }

    if (resource === "user_library_items") {
      const eqValue = name => {
        const raw = params.get(name);
        return raw && raw.startsWith("eq.") ? raw.slice(3) : null;
      };
      const userId = eqValue("user_id");
      const mediaType = eqValue("media_type");
      const imdbId = eqValue("imdb_id");
      const status = eqValue("status");
      const isFavorite = eqValue("is_favorite");

      if (method === "GET") {
        let rows = [...libraryRows.values()].filter(row => {
          if (userId && row.user_id !== userId) return false;
          if (mediaType && row.media_type !== mediaType) return false;
          if (imdbId && row.imdb_id !== imdbId) return false;
          if (status && row.status !== status) return false;
          if (isFavorite === "true" && !row.is_favorite) return false;
          return true;
        });
        rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        const limit = Number(params.get("limit"));
        if (Number.isInteger(limit) && limit > 0) rows = rows.slice(0, limit);
        return rows;
      }

      if (method === "POST") {
        assert.equal(params.get("on_conflict"), "user_id,media_type,imdb_id");
        const body = JSON.parse(options.body);
        const key = `${body.user_id}:${body.media_type}:${body.imdb_id}`;
        const existing = libraryRows.get(key);
        const nowIso = new Date(Date.now() + libraryRows.size).toISOString();
        const saved = {
          id: existing?.id || `row-${libraryRows.size + 1}`,
          added_at: existing?.added_at || nowIso,
          updated_at: nowIso,
          ...body
        };
        libraryRows.set(key, saved);
        return [saved];
      }

      if (method === "PATCH") {
        const key = `${userId}:${mediaType}:${imdbId}`;
        const existing = libraryRows.get(key);
        if (!existing) return [];
        const patch = JSON.parse(options.body);
        const updated = {
          ...existing,
          ...patch,
          updated_at: new Date(Date.now() + 1000).toISOString()
        };
        libraryRows.set(key, updated);
        return [updated];
      }

      if (method === "DELETE") {
        const key = `${userId}:${mediaType}:${imdbId}`;
        const existing = libraryRows.get(key);
        if (!existing) return [];
        libraryRows.delete(key);
        return [existing];
      }
    }

    throw new Error(`Unhandled stub request: ${method} ${path}`);
  }

  return {
    request,
    libraryRows,
    activeDays,
    events,
    calls,
    setFailEvents(value) { failEvents = value; }
  };
}

async function withRouterServer(t, router) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("library validation rejects invalid keys, statuses, poster URLs, and empty patches", () => {
  assert.throws(() => validateLibraryKey({ mediaType: "anime", imdbId: "tt0903747" }), err => err.statusCode === 400);
  assert.throws(() => validateLibraryKey({ mediaType: "series", imdbId: "not-imdb" }), err => err.statusCode === 400);
  assert.throws(() => sanitizeLibraryPayload({ title: "" }, "movie"), err => err.statusCode === 400);
  assert.throws(() => sanitizeLibraryPayload({ title: "Dune", status: "paused" }, "movie"), err => err.statusCode === 400);
  assert.throws(() => sanitizeLibraryPayload({ title: "Dune", isFavorite: "yes" }, "movie"), err => err.statusCode === 400);
  assert.throws(() => sanitizeLibraryPayload({ title: "Dune", posterUrl: "javascript:alert(1)" }, "movie"), err => err.statusCode === 400);
  assert.throws(() => sanitizeLibraryPayload({ title: "Dune", posterUrl: "data:image/svg+xml,<svg/>" }, "movie"), err => err.statusCode === 400);
  assert.throws(() => sanitizeLibraryPayload({ title: "Show", seasonCount: -1 }, "series"), err => err.statusCode === 400);
  assert.throws(() => sanitizeLibraryPatch({}), err => err.statusCode === 400);
  assert.throws(() => sanitizeLibraryPatch({ status: "bogus" }), err => err.statusCode === 400);

  const sanitized = sanitizeLibraryPayload({
    title: "  Breaking Bad  ",
    year: "2008",
    poster: "https://images.metahub.space/poster/medium/tt0903747/img",
    rating: "9.5",
    genres: ["Crime", "Drama", "crime", "Thriller"],
    seasons: 5
  }, "series");
  assert.equal(sanitized.title, "Breaking Bad");
  assert.equal(sanitized.status, "want_to_watch");
  assert.equal(sanitized.is_favorite, false);
  assert.deepEqual(sanitized.genres, ["Crime", "Drama", "Thriller"]);
  assert.equal(sanitized.season_count, 5);
});

test("duplicate saves are idempotent, preserve favorites on re-save, and record first_library_save once", async () => {
  const stub = createInMemorySupabaseStub();
  const service = createLibraryService({ request: stub.request, now: () => new Date("2026-11-25T10:00:00Z") });

  const first = await service.upsertLibraryItem("user-1", "tok-1", {
    mediaType: "series",
    imdbId: "tt0903747",
    payload: { title: "Breaking Bad", year: "2008", status: "watching", isFavorite: true, genres: ["Crime", "Drama"], seasons: 5 }
  });
  assert.equal(first.created, true);
  assert.equal(first.isFirstSave, true);
  assert.equal(first.item.isFavorite, true);
  assert.equal(stub.libraryRows.size, 1);

  // Re-save same title without explicit isFavorite: must stay 1 row, preserve favorite, and not re-emit first_library_save
  const duplicate = await service.upsertLibraryItem("user-1", "tok-1", {
    mediaType: "series",
    imdbId: "tt0903747",
    payload: { title: "Breaking Bad", year: "2008", status: "watching", genres: ["Crime", "Drama"], seasons: 5 }
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.isFirstSave, false);
  assert.equal(duplicate.item.isFavorite, true);
  assert.equal(stub.libraryRows.size, 1);

  // Save a second title (movie): must NOT emit first_library_save again
  const second = await service.upsertLibraryItem("user-1", "tok-1", {
    mediaType: "movie",
    imdbId: "tt0133093",
    payload: { title: "The Matrix", year: "1999", status: "completed" }
  });
  assert.equal(second.created, true);
  assert.equal(second.isFirstSave, false);
  assert.equal(stub.libraryRows.size, 2);

  const eventNames = stub.events.map(event => event.event_name);
  assert.deepEqual(eventNames, ["first_library_save", "library_item_saved", "library_item_saved"]);

  // Active-day ping is idempotent per UTC date
  const day1 = await service.recordActiveDay("user-1", "tok-1");
  const day2 = await service.recordActiveDay("user-1", "tok-1");
  assert.equal(day1.activeDate, "2026-11-25");
  assert.equal(day2.activeDate, "2026-11-25");
  assert.equal(stub.activeDays.size, 1);

  // Telemetry errors must never break user library saves or updates
  stub.setFailEvents(true);
  const updated = await service.updateLibraryItem("user-1", "tok-1", {
    mediaType: "series",
    imdbId: "tt0903747",
    patch: { status: "completed" }
  });
  assert.equal(updated.item.status, "completed");
});

test("library HTTP routes enforce authentication, suspension fail-closed, per-user isolation, and full CRUD", async t => {
  const stub = createInMemorySupabaseStub();
  const service = createLibraryService({ request: stub.request, now: () => new Date("2026-11-25T10:00:00Z") });
  const requireUserMiddleware = createRequireUser({
    verifyToken: async token => {
      if (token === "token-alice") return { sub: "user-alice" };
      if (token === "token-bob") return { sub: "user-bob" };
      if (token === "token-suspended") return { sub: "user-suspended" };
      throw new Error("Invalid token");
    },
    checkSuspension: async userId => userId === "user-suspended"
  });

  const base = await withRouterServer(t, createLibraryRouter({ requireUserMiddleware, service }));

  // 1. Unauthenticated requests rejected with 401
  for (const [method, endpoint] of [
    ["GET", "/api/library"],
    ["PUT", "/api/library/movie/tt0133093"],
    ["PATCH", "/api/library/movie/tt0133093"],
    ["DELETE", "/api/library/movie/tt0133093"],
    ["POST", "/api/activity/active-day"]
  ]) {
    const res = await fetch(`${base}${endpoint}`, {
      method,
      headers: method === "PUT" || method === "PATCH" ? { "content-type": "application/json" } : {},
      body: method === "PUT" ? JSON.stringify({ title: "The Matrix" }) : method === "PATCH" ? JSON.stringify({ status: "watching" }) : undefined
    });
    assert.equal(res.status, 401, `Expected 401 for unauthenticated ${method} ${endpoint}`);
  }
  assert.equal(stub.calls.length, 0);

  // 2. Suspended user rejected with 403
  const suspendedRes = await fetch(`${base}/api/library`, {
    headers: { Authorization: "Bearer token-suspended" }
  });
  assert.equal(suspendedRes.status, 403);
  assert.deepEqual(await suspendedRes.json(), { error: "Account suspended." });

  // 3. Alice saves a movie and a series
  const saveMovie = await fetch(`${base}/api/library/movie/tt0133093`, {
    method: "PUT",
    headers: { Authorization: "Bearer token-alice", "content-type": "application/json" },
    body: JSON.stringify({ title: "The Matrix", year: "1999", status: "want_to_watch", genres: ["Sci-Fi", "Action"] })
  });
  assert.equal(saveMovie.status, 201);
  const savedMovieBody = await saveMovie.json();
  assert.equal(savedMovieBody.created, true);
  assert.equal(savedMovieBody.item.imdbId, "tt0133093");

  // Duplicate PUT returns 200 and updates status
  const resavedMovie = await fetch(`${base}/api/library/movie/tt0133093`, {
    method: "PUT",
    headers: { Authorization: "Bearer token-alice", "content-type": "application/json" },
    body: JSON.stringify({ title: "The Matrix", year: "1999", status: "completed", isFavorite: true })
  });
  assert.equal(resavedMovie.status, 200);
  const resavedBody = await resavedMovie.json();
  assert.equal(resavedBody.created, false);
  assert.equal(resavedBody.item.status, "completed");
  assert.equal(resavedBody.item.isFavorite, true);

  // Alice's Bearer token is forwarded directly (no service role)
  assert.ok(stub.calls.every(call => call.token === "token-alice"));

  // 4. Bob cannot see or mutate Alice's library item
  const bobList = await fetch(`${base}/api/library`, {
    headers: { Authorization: "Bearer token-bob" }
  });
  assert.equal(bobList.status, 200);
  assert.deepEqual((await bobList.json()).items, []);

  const bobPatch = await fetch(`${base}/api/library/movie/tt0133093`, {
    method: "PATCH",
    headers: { Authorization: "Bearer token-bob", "content-type": "application/json" },
    body: JSON.stringify({ status: "dropped" })
  });
  assert.equal(bobPatch.status, 404);

  // 5. Alice filters, cycles all 4 statuses, toggles favorite, reloads, pings active day, and removes item
  const aliceFavorites = await fetch(`${base}/api/library?favorite=true&mediaType=movie`, {
    headers: { Authorization: "Bearer token-alice" }
  });
  assert.equal(aliceFavorites.status, 200);
  const favData = await aliceFavorites.json();
  assert.equal(favData.items.length, 1);
  assert.equal(favData.counts.favorites, 1);

  for (const nextStatus of ["want_to_watch", "watching", "completed", "dropped"]) {
    const patchRes = await fetch(`${base}/api/library/movie/tt0133093`, {
      method: "PATCH",
      headers: { Authorization: "Bearer token-alice", "content-type": "application/json" },
      body: JSON.stringify({ status: nextStatus })
    });
    assert.equal(patchRes.status, 200);
    assert.equal((await patchRes.json()).item.status, nextStatus);
  }

  const unfavRes = await fetch(`${base}/api/library/movie/tt0133093`, {
    method: "PATCH",
    headers: { Authorization: "Bearer token-alice", "content-type": "application/json" },
    body: JSON.stringify({ isFavorite: false })
  });
  assert.equal(unfavRes.status, 200);
  assert.equal((await unfavRes.json()).item.isFavorite, false);

  // Reload persistence check (fresh GET after mutations)
  const reloadList = await fetch(`${base}/api/library?status=dropped`, {
    headers: { Authorization: "Bearer token-alice" }
  });
  assert.equal(reloadList.status, 200);
  const reloadBody = await reloadList.json();
  assert.equal(reloadBody.items.length, 1);
  assert.equal(reloadBody.items[0].status, "dropped");
  assert.equal(reloadBody.items[0].isFavorite, false);

  const activePing = await fetch(`${base}/api/activity/active-day`, {
    method: "POST",
    headers: { Authorization: "Bearer token-alice" }
  });
  assert.equal(activePing.status, 200);
  assert.deepEqual(await activePing.json(), { recorded: true, activeDate: "2026-11-25" });

  const removeRes = await fetch(`${base}/api/library/movie/tt0133093`, {
    method: "DELETE",
    headers: { Authorization: "Bearer token-alice" }
  });
  assert.equal(removeRes.status, 200);
  assert.equal((await removeRes.json()).removed, true);

  // 6. Invalid route params return 400 cleanly
  const badId = await fetch(`${base}/api/library/movie/invalid`, {
    method: "PUT",
    headers: { Authorization: "Bearer token-alice", "content-type": "application/json" },
    body: JSON.stringify({ title: "Nope" })
  });
  assert.equal(badId.status, 400);
});

test("migration 0006 enforces uniqueness, RLS ownership, active-account gating, and revokes anon access", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/0006_personal_library_and_retention.sql", import.meta.url), "utf8");

  assert.match(sql, /to_regprocedure\('public\.is_account_active\(\)'\)\s+is\s+null/i);
  assert.match(sql, /constraint user_library_items_user_media_unique unique \(user_id, media_type, imdb_id\)/i);
  assert.match(sql, /check \(media_type in \('movie', 'series'\)\)/i);
  assert.match(sql, /check \(imdb_id ~ '\^tt\[0-9\]\+\$'\)/i);
  assert.match(sql, /check \(status in \('want_to_watch', 'watching', 'completed', 'dropped'\)\)/i);
  assert.match(sql, /char_length\(poster_url\) <= 1000/i);
  assert.match(sql, /check \(cardinality\(genres\) <= 12\)/i);
  assert.match(sql, /check \(pg_column_size\(metadata\) <= 4096\)/i);
  assert.match(sql, /revoke all on function public\.set_library_item_updated_at\(\) from public/i);

  for (const table of ["user_library_items", "user_active_days", "product_events"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon`, "i"));
  }

  assert.match(sql, /on public\.user_library_items for select\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id and public\.is_account_active\(\)\)/i);
  assert.match(sql, /on public\.user_library_items for insert\s+to authenticated\s+with check \(\(select auth\.uid\(\)\) = user_id and public\.is_account_active\(\)\)/i);
  assert.match(sql, /on public\.user_library_items for update\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id and public\.is_account_active\(\)\)\s+with check \(\(select auth\.uid\(\)\) = user_id and public\.is_account_active\(\)\)/i);
  assert.match(sql, /on public\.user_library_items for delete\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id and public\.is_account_active\(\)\)/i);

  assert.doesNotMatch(sql, /\bsecurity definer\b/i);
  assert.doesNotMatch(sql, /\bto anon\b/i);
});

test("frontend library state helpers and lightweight navigation handle snapshots, filtering, and routing", () => {
  const snapshot = buildLibrarySnapshot(
    { id: "tt0903747", title: "Breaking Bad", year: "2008", poster: "https://cdn.test/bb.jpg", rating: "9.5", genres: ["Crime", "Drama"], seasons: 5 },
    { fallbackMediaType: "series", status: "watching", isFavorite: true }
  );
  assert.equal(snapshot.mediaType, "series");
  assert.equal(snapshot.imdbId, "tt0903747");
  assert.equal(snapshot.payload.seasonCount, 5);
  assert.equal(snapshot.payload.isFavorite, true);

  assert.equal(buildLibrarySnapshot({ id: "not-valid", title: "Bad" }), null);

  let items = [];
  items = upsertLocalLibraryItem(items, { mediaType: "series", imdbId: "tt0903747", status: "watching", isFavorite: true, title: "Breaking Bad", updatedAt: "2026-11-25T10:00:00Z" });
  items = upsertLocalLibraryItem(items, { mediaType: "movie", imdbId: "tt0133093", status: "completed", isFavorite: false, title: "The Matrix", updatedAt: "2026-11-25T11:00:00Z" });
  items = upsertLocalLibraryItem(items, { mediaType: "series", imdbId: "tt0903747", status: "completed", isFavorite: true, title: "Breaking Bad", updatedAt: "2026-11-25T12:00:00Z" });
  assert.equal(items.length, 2);
  assert.equal(items[0].imdbId, "tt0903747");

  const counts = computeLibraryCounts(items);
  assert.equal(counts.total, 2);
  assert.equal(counts.movies, 1);
  assert.equal(counts.series, 1);
  assert.equal(counts.favorites, 1);
  assert.equal(counts.byStatus.completed, 2);

  assert.equal(filterLibraryItems(items, { statusFilter: "favorites", mediaFilter: "all" }).length, 1);
  assert.equal(filterLibraryItems(items, { statusFilter: "completed", mediaFilter: "movie" }).length, 1);

  items = removeLocalLibraryItem(items, "movie", "tt0133093");
  assert.equal(items.length, 1);

  assert.equal(parseSectionFromPath("/"), "discover");
  assert.equal(parseSectionFromPath("/library"), "library");
  assert.equal(parseSectionFromPath("/library/"), "library");
  assert.equal(pathForSection("library"), "/library");
  assert.equal(pathForSection("discover"), "/");
});
