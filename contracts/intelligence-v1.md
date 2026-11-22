# SeasonFetch Intelligence Contract v1

## Boundary

The Rust/WASM engine receives provider-neutral, already parsed candidates. It never receives or returns provider URLs, magnets, tracker URLs, arbitrary provider payloads, or authentication data. Node remains responsible for provider transport, source parsing/materialization, and mapping returned candidate IDs back to original provider objects.

## Input

```json
{
  "contractVersion": "seasonfetch.intelligence.v1",
  "request": {
    "season": 1,
    "episode": 1,
    "profile": "best-overall",
    "audioMode": "any",
    "filters": {
      "resolution": "1080p",
      "maxSizeBytes": null,
      "minSeeders": null,
      "codec": null,
      "hdr": null
    }
  },
  "candidates": [
    {
      "id": "opaque-node-stable-candidate-id",
      "title": "...",
      "infoHash": "40 lowercase hex characters",
      "fileIdx": 0,
      "resolution": "1080p",
      "codec": "HEVC",
      "hdr": null,
      "container": "mkv",
      "sizeBytes": 734003200,
      "seeders": 100,
      "provider": "Torrentio",
      "releaseType": "WEB-DL",
      "releaseGroup": "GroupA",
      "metadataCompleteness": 7,
      "audio": {
        "classification": "explicit-english-dub | possible-english-audio | unverified",
        "languages": [],
        "confidence": 0,
        "evidence": []
      }
    }
  ]
}
```

Missing facts are `null`, empty arrays, or explicit `unverified`; they are never inferred by the engine.

## Output

```json
{
  "contractVersion": "seasonfetch.intelligence.v1",
  "status": "ok",
  "eligibleIds": ["..."],
  "eligibleRepresentativeIds": ["..."],
  "rejectedIds": ["..."],
  "duplicateGroups": [
    { "id": "infohash:0", "candidateIds": ["..."], "representativeId": "..." }
  ],
  "rankedIds": ["..."],
  "recommendations": {
    "bestOverall": "candidate-id or null",
    "smallestAcceptable": "candidate-id or null",
    "highestQuality": "candidate-id or null",
    "mostReliable": "candidate-id or null"
  },
  "episode": {
    "status": "available | missing",
    "releaseCount": 0,
    "warnings": []
  }
}
```

## Determinism rules

1. Hard filters run before deduplication and ranking.
2. Candidate `id` is a unique, opaque, Node-owned stable identity for one source record. Deduplication keys are separate: `infoHash:fileIdx` when an info hash exists, otherwise `title:<lowercase alphanumeric normalized title>`.
3. A group representative is selected by descending `metadataCompleteness`, descending count of known metadata fields, descending audio evidence strength (`explicit-english-dub` > `possible-english-audio` > `unverified`), then ascending candidate ID.
4. `rankedIds`, all recommendation profiles, and episode availability operate on deduplicated eligible representatives.
5. Ranking uses the existing profile weights and stable score ordering. Ties use descending known seeder count, then ascending candidate ID.
6. Strict `english-dubbed-only` accepts only `explicit-english-dub`. `english-dubbed-or-dual` accepts explicit or possible English audio.
7. Episode `available` means at least one deduplicated eligible representative; rejected or duplicate-only records do not increase `releaseCount`.
8. JavaScript remains authoritative during shadow mode. A Rust mismatch is observable but cannot change delivery.
