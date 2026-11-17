const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const API_ORIGIN = "https://generativelanguage.googleapis.com/v1beta";

function getApiKey() {
  return String(process.env.GEMINI_API_KEY || "").trim();
}

function extractText(payload) {
  return payload?.candidates?.[0]?.content?.parts
    ?.map(part => part?.text || "")
    .join("")
    .trim() || "";
}

function parseJson(text) {
  const cleaned = String(text).trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

function sanitizeCandidates(candidates) {
  return candidates.slice(0, 20).map((candidate, index) => ({
    index,
    title: String(candidate?.title || "").slice(0, 240),
    provider: String(candidate?.provider || "").slice(0, 80),
    resolution: String(candidate?.resolution || "").slice(0, 40),
    sizeBytes: Number.isFinite(candidate?.sizeBytes) ? candidate.sizeBytes : null,
    seeders: Number.isFinite(candidate?.seeders) ? candidate.seeders : null,
    trackerCount: Number.isFinite(candidate?.trackerCount) ? candidate.trackerCount : 0,
    fileIdx: Number.isInteger(candidate?.fileIdx) ? candidate.fileIdx : null,
    preferredProvider: Boolean(candidate?.preferredProvider)
  }));
}

export function geminiStatus() {
  return {
    configured: Boolean(getApiKey()),
    model: DEFAULT_MODEL,
    purpose: "optional source explanation; deterministic ranking remains authoritative"
  };
}

export async function suggestSearchQueries(query = "") {
  const apiKey = getApiKey();
  const cleanQuery = String(query).trim().slice(0, 160);
  if (!apiKey || cleanQuery.length < 2) return [];

  const prompt = [
    "You help correct misspelled TV-show search queries.",
    "Return JSON only with this schema: {\"queries\": string[]}.",
    "Return up to three concise likely title spellings. Do not invent explanations, metadata, IDs, episodes, or search results.",
    `User query: ${cleanQuery}`
  ].join("\n");

  const response = await fetch(`${API_ORIGIN}/models/${encodeURIComponent(DEFAULT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 120 }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Gemini search assist failed (${response.status}): ${payload?.error?.message || "unknown error"}`);

  const result = parseJson(extractText(payload));
  return Array.isArray(result.queries)
    ? [...new Set(result.queries.map(item => String(item).trim()).filter(item => item.length >= 2).slice(0, 3))]
    : [];
}

export async function explainSourceCandidates({ seriesTitle = "", season, episode, candidates = [] } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { configured: false, recommendation: null, reason: "GEMINI_API_KEY is not configured locally." };

  const safeCandidates = sanitizeCandidates(Array.isArray(candidates) ? candidates : []);
  if (!safeCandidates.length) return { configured: true, recommendation: null, reason: "No candidates were supplied." };

  const prompt = [
    "You are a torrent-source metadata assistant.",
    "Choose only among the supplied candidate indexes. Never invent a candidate, hash, tracker, URL, seeder count, size, or file index.",
    "The application currently ranks sources deterministically; use the model to explain the same policy and flag ambiguity. Do not treat this as permission to invent or replace source metadata.",
    "Core rule: always prioritize the smallest known download size. Then prefer the most known seeders among equal or comparably sized choices. If size and seeders conflict, make a practical tradeoff: do not choose a much larger file merely because it has more seeders. Use 1337x only as a tie-breaker or quality signal after size and seeder considerations, never as an automatic override.",
    "Return JSON only with this schema:",
    '{"recommendedIndex": number|null, "confidence": "high"|"medium"|"low", "reason": string, "warnings": string[]}',
    `Series: ${String(seriesTitle).slice(0, 160)}`,
    `Season: ${season ?? "unknown"}; episode: ${episode ?? "unknown"}`,
    `Candidates: ${JSON.stringify(safeCandidates)}`
  ].join("\n");

  const response = await fetch(`${API_ORIGIN}/models/${encodeURIComponent(DEFAULT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        maxOutputTokens: 300
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Gemini request failed (${response.status}): ${payload?.error?.message || "unknown error"}`);

  const result = parseJson(extractText(payload));
  const recommendedIndex = Number.isInteger(result.recommendedIndex) && result.recommendedIndex >= 0 && result.recommendedIndex < safeCandidates.length
    ? result.recommendedIndex
    : null;

  return {
    configured: true,
    model: DEFAULT_MODEL,
    recommendation: {
      recommendedIndex,
      confidence: ["high", "medium", "low"].includes(result.confidence) ? result.confidence : "low",
      reason: String(result.reason || "").slice(0, 600),
      warnings: Array.isArray(result.warnings) ? result.warnings.map(item => String(item).slice(0, 240)).slice(0, 5) : []
    },
    candidates: safeCandidates
  };
}
