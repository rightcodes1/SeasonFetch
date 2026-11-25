async function getAccessToken(supabase) {
  if (!supabase) return "";
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

async function authenticatedRequest(supabase, path, options = {}) {
  const token = await getAccessToken(supabase);
  if (!token) {
    const error = new Error("Sign in to manage your personal library.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const libraryApi = {
  list(supabase, filters = {}) {
    const params = new URLSearchParams();
    if (filters.status && filters.status !== "all") params.set("status", filters.status);
    if (filters.mediaType && filters.mediaType !== "all") params.set("mediaType", filters.mediaType);
    if (filters.favorite) params.set("favorite", "true");
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return authenticatedRequest(supabase, `/api/library${suffix}`);
  },
  save(supabase, mediaType, imdbId, payload) {
    return authenticatedRequest(
      supabase,
      `/api/library/${encodeURIComponent(mediaType)}/${encodeURIComponent(imdbId)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload)
      }
    );
  },
  update(supabase, mediaType, imdbId, patch) {
    return authenticatedRequest(
      supabase,
      `/api/library/${encodeURIComponent(mediaType)}/${encodeURIComponent(imdbId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch)
      }
    );
  },
  remove(supabase, mediaType, imdbId) {
    return authenticatedRequest(
      supabase,
      `/api/library/${encodeURIComponent(mediaType)}/${encodeURIComponent(imdbId)}`,
      {
        method: "DELETE"
      }
    );
  },
  pingActiveDay(supabase) {
    return authenticatedRequest(supabase, "/api/activity/active-day", { method: "POST" });
  }
};
