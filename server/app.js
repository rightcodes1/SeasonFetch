import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSeasonSources } from "./services/torrentio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", application: "SeasonFetch", provider: "Torrentio" });
});

app.get("/api/torrentio/season/:seriesId/:season", async (req, res) => {
  const { seriesId } = req.params;
  const season = Number(req.params.season);
  const episodeCount = Number(req.query.episodes);

  if (!/^tt\d+$/.test(seriesId)) {
    return res.status(400).json({ error: "Invalid series IMDb ID." });
  }

  if (!Number.isInteger(season) || season < 0) {
    return res.status(400).json({ error: "Invalid season number." });
  }

  if (!Number.isInteger(episodeCount) || episodeCount < 1 || episodeCount > 30) {
    return res.status(400).json({ error: "Episode count must be between 1 and 30." });
  }

  try {
    const results = await getSeasonSources(seriesId, season, episodeCount);
    return res.json({ provider: "torrentio", seriesId, season, totalEpisodes: results.length, results });
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

app.listen(port, "0.0.0.0", () => {
  console.log(`SeasonFetch API running on port ${port}`);
});
