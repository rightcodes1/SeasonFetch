import { processReleases } from "../pipeline.js";

export function processTorrentioResults(streams, context = {}) {
  return processReleases(streams, context);
}
