import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchSeries, getSeries } from "./services/cinemeta.js";
import { getSeasonSources } from "./services/torrentio.js";
import { explainSourceCandidates, geminiStatus } from "./services/gemini.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const app = express();
const port = Number(process.env.PORT) || 3000;
const allowedOrigins = new Set(
  String(process.env.CLIENT_ORIGIN || "http://localhost:3000")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)
);

app.use(helmet({ frameguard: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by SeasonFetch."));
  }
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", application: "SeasonFetch", metadata: "Cinemeta", provider: "Torrentio", gemini: geminiStatus().configured ? "configured" : "optional-not-configured" });
});

app.get("/api/gemini/status", (_req, res) => {
  res.json(geminiStatus());
});

app.post("/api/gemini/explain-source", async (req, res) => {
  try {
    const result = await explainSourceCandidates(req.body || {});
    return res.json(result);
  } catch (error) {
    console.error("Gemini source explanation failed:", error.message);
    return res.status(502).json({ error: "Gemini is unavailable or returned an invalid response." });
  }
});

app.get("/api/cinemeta/search", async (req, res) => {
  try {
    return res.json({ results: await searchSeries(req.query.q) });
  } catch (error) {
    console.error("Cinemeta search failed:", error.message);
    return res.status(502).json({ error: "Cinemeta search is unavailable right now." });
  }
});

app.get("/api/cinemeta/series/:id", async (req, res) => {
  try {
    return res.json(await getSeries(req.params.id));
  } catch (error) {
    console.error("Cinemeta metadata failed:", error.message);
    return res.status(404).json({ error: "Unable to retrieve that series." });
  }
});

function parseEpisodeNumbers(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const count = Number(raw);
    return Number.isInteger(count) && count >= 1 && count <= 30
      ? Array.from({ length: count }, (_, index) => index + 1)
      : null;
  }

  const numbers = raw.split(",").map(item => Number(item.trim()));
  if (!numbers.length || numbers.some(number => !Number.isInteger(number) || number < 1 || number > 200)) return null;
  return [...new Set(numbers)].slice(0, 30);
}

app.get("/api/torrentio/season/:seriesId/:season", async (req, res) => {
  const { seriesId } = req.params;
  const season = Number(req.params.season);
  const episodeNumbers = parseEpisodeNumbers(req.query.episodes);

  if (!/^tt\d+$/.test(seriesId)) {
    return res.status(400).json({ error: "Invalid series IMDb ID." });
  }

  if (!Number.isInteger(season) || season < 0) {
    return res.status(400).json({ error: "Invalid season number." });
  }

  if (!episodeNumbers) {
    return res.status(400).json({ error: "Episodes must be a count from 1 to 30 or a comma-separated list of episode numbers." });
  }

  try {
    const scan = await getSeasonSources(seriesId, season, episodeNumbers);
    return res.json({ provider: "torrentio", seriesId, season, totalEpisodes: scan.results.length, ...scan });
  } catch (error) {
    console.error("Torrentio season lookup failed:", error.message);
    return res.status(502).json({ error: "Torrentio is unavailable right now." });
  }
});

app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    return res.sendFile(path.join(distDir, "index.html"), error => {
      if (error) next(error);
    });
  }
  return next();
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled server error:", error);
  res.status(500).json({ error: "Internal server error." });
});

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`SeasonFetch API running on port ${port}`);
  });
}

export default app;
