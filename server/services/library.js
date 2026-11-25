import { supabaseRequest } from "./supabaseAuth.js";
import {
  isValidImdbId,
  isValidLibraryStatus,
  isValidMediaType,
  LIBRARY_STATUSES
} from "../../shared/libraryConstants.js";

const LIBRARY_SELECT = [
  "id",
  "user_id",
  "media_type",
  "imdb_id",
  "status",
  "is_favorite",
  "title",
  "release_year",
  "poster_url",
  "rating",
  "genres",
  "synopsis",
  "season_count",
  "added_at",
  "updated_at"
].join(",");

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function validateLibraryKey({ mediaType, imdbId }) {
  if (!isValidMediaType(mediaType)) {
    throw httpError(400, "Media type must be movie or series.");
  }
  if (!isValidImdbId(imdbId)) {
    throw httpError(400, "Invalid IMDb ID.");
  }
  return { mediaType, imdbId };
}

function sanitizeOptionalString(value, maxLength) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function sanitizePosterUrl(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw httpError(400, "Poster URL must be a valid HTTP(S) URL.");
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw httpError(400, "Poster URL must be a valid HTTP(S) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw httpError(400, "Poster URL must use http or https.");
  }
  return parsed.toString().slice(0, 1000);
}

function sanitizeGenres(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw httpError(400, "Genres must be an array of strings.");
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = item.trim().slice(0, 40);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= 12) break;
  }
  return result;
}

function sanitizeSeasonCount(value, mediaType) {
  if (mediaType === "movie") return null;
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 200) {
    throw httpError(400, "Season count must be an integer between 0 and 200.");
  }
  return numeric;
}

export function sanitizeLibraryPayload(body, mediaType) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "A JSON library payload is required.");
  }

  const title = sanitizeOptionalString(body.title, 240);
  if (!title) {
    throw httpError(400, "Title is required.");
  }

  const status = body.status === undefined ? "want_to_watch" : body.status;
  if (!isValidLibraryStatus(status)) {
    throw httpError(400, "Status must be want_to_watch, watching, completed, or dropped.");
  }

  if (body.isFavorite !== undefined && typeof body.isFavorite !== "boolean") {
    throw httpError(400, "isFavorite must be a boolean.");
  }

  return {
    status,
    is_favorite: body.isFavorite === true,
    title,
    release_year: sanitizeOptionalString(body.releaseYear ?? body.year, 16),
    poster_url: sanitizePosterUrl(body.posterUrl ?? body.poster),
    rating: sanitizeOptionalString(body.rating, 16),
    genres: sanitizeGenres(body.genres),
    synopsis: sanitizeOptionalString(body.synopsis, 2000) || "",
    season_count: sanitizeSeasonCount(body.seasonCount ?? body.seasons, mediaType)
  };
}

export function sanitizeLibraryPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "A JSON update payload is required.");
  }

  const patch = {};
  if (body.status !== undefined) {
    if (!isValidLibraryStatus(body.status)) {
      throw httpError(400, "Status must be want_to_watch, watching, completed, or dropped.");
    }
    patch.status = body.status;
  }
  if (body.isFavorite !== undefined) {
    if (typeof body.isFavorite !== "boolean") {
      throw httpError(400, "isFavorite must be a boolean.");
    }
    patch.is_favorite = body.isFavorite;
  }
  if (!Object.keys(patch).length) {
    throw httpError(400, "At least one updatable field (status or isFavorite) is required.");
  }
  return patch;
}

export function normalizeLibraryItem(row) {
  if (!row) return null;
  const genres = Array.isArray(row.genres) ? row.genres : [];
  return {
    id: row.id,
    mediaType: row.media_type,
    imdbId: row.imdb_id,
    status: row.status,
    isFavorite: Boolean(row.is_favorite),
    title: row.title,
    year: row.release_year || null,
    releaseYear: row.release_year || null,
    poster: row.poster_url || null,
    posterUrl: row.poster_url || null,
    rating: row.rating || null,
    genres,
    type: genres.slice(0, 2).join(" · ") || (row.media_type === "movie" ? "Movie" : "Series"),
    synopsis: row.synopsis || "",
    seasons: row.season_count ?? null,
    seasonCount: row.season_count ?? null,
    addedAt: row.added_at,
    updatedAt: row.updated_at
  };
}

export function summarizeLibraryItems(items = []) {
  const byStatus = Object.fromEntries(LIBRARY_STATUSES.map(entry => [entry.value, 0]));
  let movies = 0;
  let series = 0;
  let favorites = 0;

  for (const item of items) {
    if (item.mediaType === "movie") movies += 1;
    else if (item.mediaType === "series") series += 1;
    if (item.isFavorite) favorites += 1;
    if (Object.hasOwn(byStatus, item.status)) byStatus[item.status] += 1;
  }

  return {
    total: items.length,
    movies,
    series,
    favorites,
    byStatus
  };
}

function utcDateString(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function createLibraryService({ request = supabaseRequest, now = () => new Date() } = {}) {
  async function recordProductEvent(userId, token, { eventName, mediaType = null, imdbId = null, metadata = {} }) {
    try {
      await request("product_events", token, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          user_id: userId,
          event_name: eventName,
          media_type: mediaType,
          imdb_id: imdbId,
          metadata
        })
      });
    } catch (error) {
      // First-party telemetry must never break user library mutations.
      console.warn(`Product event (${eventName}) could not be recorded:`, error.message);
    }
  }

  async function listLibraryItems(userId, token, filters = {}) {
    const params = new URLSearchParams({
      select: LIBRARY_SELECT,
      user_id: `eq.${userId}`,
      order: "updated_at.desc"
    });

    if (filters.status) {
      if (!isValidLibraryStatus(filters.status)) {
        throw httpError(400, "Invalid library status filter.");
      }
      params.set("status", `eq.${filters.status}`);
    }
    if (filters.mediaType) {
      if (!isValidMediaType(filters.mediaType)) {
        throw httpError(400, "Invalid mediaType filter.");
      }
      params.set("media_type", `eq.${filters.mediaType}`);
    }
    if (filters.favorite === true || filters.favorite === "true") {
      params.set("is_favorite", "eq.true");
    }

    const rows = await request(`user_library_items?${params.toString()}`, token);
    const items = (Array.isArray(rows) ? rows : []).map(normalizeLibraryItem);
    return { items, counts: summarizeLibraryItems(items) };
  }

  async function upsertLibraryItem(userId, token, { mediaType, imdbId, payload }) {
    validateLibraryKey({ mediaType, imdbId });
    const sanitized = sanitizeLibraryPayload(payload, mediaType);

    const existingRows = await request(
      `user_library_items?select=id,status,is_favorite&user_id=eq.${encodeURIComponent(userId)}&media_type=eq.${encodeURIComponent(mediaType)}&imdb_id=eq.${encodeURIComponent(imdbId)}&limit=1`,
      token
    );
    const existing = Array.isArray(existingRows) ? existingRows[0] || null : null;

    let isFirstSave = false;
    if (!existing) {
      const anyExisting = await request(
        `user_library_items?select=id&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
        token
      );
      isFirstSave = !Array.isArray(anyExisting) || anyExisting.length === 0;
    }

    const upsertRow = {
      user_id: userId,
      media_type: mediaType,
      imdb_id: imdbId,
      ...sanitized,
      // Preserve existing favorite flag when caller did not explicitly pass isFavorite on re-save
      is_favorite: payload.isFavorite === undefined && existing ? Boolean(existing.is_favorite) : sanitized.is_favorite
    };

    const savedRows = await request(
      "user_library_items?on_conflict=user_id,media_type,imdb_id",
      token,
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(upsertRow)
      }
    );

    const item = normalizeLibraryItem(Array.isArray(savedRows) ? savedRows[0] : savedRows);
    if (!item) throw httpError(502, "Unable to persist library item.");

    if (!existing) {
      if (isFirstSave) {
        await recordProductEvent(userId, token, {
          eventName: "first_library_save",
          mediaType,
          imdbId,
          metadata: { status: item.status }
        });
      }
      await recordProductEvent(userId, token, {
        eventName: "library_item_saved",
        mediaType,
        imdbId,
        metadata: { status: item.status, isFavorite: item.isFavorite }
      });
    } else {
      if (existing.status !== item.status) {
        await recordProductEvent(userId, token, {
          eventName: "library_status_changed",
          mediaType,
          imdbId,
          metadata: { from: existing.status, to: item.status }
        });
      }
      if (Boolean(existing.is_favorite) !== item.isFavorite) {
        await recordProductEvent(userId, token, {
          eventName: "library_favorite_toggled",
          mediaType,
          imdbId,
          metadata: { isFavorite: item.isFavorite }
        });
      }
    }

    return { item, created: !existing, isFirstSave };
  }

  async function updateLibraryItem(userId, token, { mediaType, imdbId, patch }) {
    validateLibraryKey({ mediaType, imdbId });
    const sanitizedPatch = sanitizeLibraryPatch(patch);

    const existingRows = await request(
      `user_library_items?select=id,status,is_favorite&user_id=eq.${encodeURIComponent(userId)}&media_type=eq.${encodeURIComponent(mediaType)}&imdb_id=eq.${encodeURIComponent(imdbId)}&limit=1`,
      token
    );
    const existing = Array.isArray(existingRows) ? existingRows[0] || null : null;
    if (!existing) {
      throw httpError(404, "Library item not found.");
    }

    const updatedRows = await request(
      `user_library_items?user_id=eq.${encodeURIComponent(userId)}&media_type=eq.${encodeURIComponent(mediaType)}&imdb_id=eq.${encodeURIComponent(imdbId)}&select=${LIBRARY_SELECT}`,
      token,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(sanitizedPatch)
      }
    );

    const item = normalizeLibraryItem(Array.isArray(updatedRows) ? updatedRows[0] : updatedRows);
    if (!item) throw httpError(404, "Library item not found.");

    if (sanitizedPatch.status !== undefined && existing.status !== item.status) {
      await recordProductEvent(userId, token, {
        eventName: "library_status_changed",
        mediaType,
        imdbId,
        metadata: { from: existing.status, to: item.status }
      });
    }
    if (sanitizedPatch.is_favorite !== undefined && Boolean(existing.is_favorite) !== item.isFavorite) {
      await recordProductEvent(userId, token, {
        eventName: "library_favorite_toggled",
        mediaType,
        imdbId,
        metadata: { isFavorite: item.isFavorite }
      });
    }

    return { item };
  }

  async function removeLibraryItem(userId, token, { mediaType, imdbId }) {
    validateLibraryKey({ mediaType, imdbId });
    const deletedRows = await request(
      `user_library_items?user_id=eq.${encodeURIComponent(userId)}&media_type=eq.${encodeURIComponent(mediaType)}&imdb_id=eq.${encodeURIComponent(imdbId)}`,
      token,
      {
        method: "DELETE",
        headers: { Prefer: "return=representation" }
      }
    );

    const removed = Array.isArray(deletedRows) && deletedRows.length > 0;
    if (removed) {
      await recordProductEvent(userId, token, {
        eventName: "library_item_removed",
        mediaType,
        imdbId
      });
    }
    return { removed, mediaType, imdbId };
  }

  async function recordActiveDay(userId, token) {
    const activeDate = utcDateString(now());
    await request(
      "user_active_days?on_conflict=user_id,active_date",
      token,
      {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          user_id: userId,
          active_date: activeDate
        })
      }
    );
    return { recorded: true, activeDate };
  }

  return {
    listLibraryItems,
    upsertLibraryItem,
    updateLibraryItem,
    removeLibraryItem,
    recordActiveDay
  };
}

const defaultService = createLibraryService();

export const {
  listLibraryItems,
  upsertLibraryItem,
  updateLibraryItem,
  removeLibraryItem,
  recordActiveDay
} = defaultService;
