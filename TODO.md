# SeasonFetch delivery checklist

## Interactive SeasonFetch preview
- [x] Recreate the supplied reference direction with a near-black background, lavender accents, rounded bordered panels, restrained typography, and a compact editorial utility layout.
- [x] Include a compact top navigation bar with SeasonFetch branding and utility controls.
- [x] Include a hero section with concise headline, supporting copy, and a responsive TV-series search form.
- [x] Make search interactive using realistic local sample data, including loading, error, no-results, and initial empty states.
- [x] Make search result cards selectable and clearly indicate the active selection.
- [x] Include selected-series details with poster artwork, metadata, synopsis, status, genres, and season information.
- [x] Render real Cinemeta poster thumbnails and enriched ratings in search result cards, with visible fallbacks when optional metadata is missing.
- [x] Include a season selector that updates the displayed episode list and progress summary.
- [x] Include a responsive episode source table with source availability, status, and relevant actions.
- [x] Make episode rows expandable to reveal source information without leaving the page.
- [x] Make open-magnet, provider-link, and copy-magnet actions functional with clear success feedback.
- [x] Offer Stremio local download-link open/copy actions using the selected info hash and file index, while retaining magnet fallback actions.
- [x] Include a responsive mobile layouts for the compact viewport.

## Live Cinemeta metadata
- [x] Search arbitrary TV titles through the server-side Cinemeta proxy instead of limiting search to local demo titles.
- [x] Load selected-series metadata, real season counts, and normalized episode metadata from Cinemeta.
- [x] Preserve a clearly labeled local preview catalog fallback when Cinemeta is unavailable.

## Live Torrentio provider
- [x] Add a server-side Express proxy for Torrentio rather than calling the provider directly from the browser.
- [x] Use the `tt...:season:episode` Stremio series identifier format and validate IMDb IDs, seasons, and episode counts.
- [x] Limit season lookups to three concurrent provider requests.
- [x] Normalize Torrentio responses to valid 40-character info hashes, explicit 1080p sources, normalized file sizes, file indexes, and magnet links.
- [x] Select valid 1080p sources by preferring 1337x, then highest known seeder count, then smallest known file size, while retaining an unknown-size source only when no known size exists.
- [x] Preserve safe Torrentio source URLs, file indexes, tracker counts, and file-aware magnet links.
- [x] Query the actual Cinemeta episode numbers, including sparse or non-contiguous seasons, instead of assuming 1..N.
- [x] Surface partial and complete Torrentio provider failures distinctly from normal no-source results.
- [x] Show live Torrentio status in the UI and preserve clearly labeled preview fallback data when the provider is unavailable.

## Release comparison and manual override
- [ ] Clearly identify the automatic recommendation and, when an episode is expanded, show every available candidate with only the metadata actually supplied: resolution/quality, size, seeders, audio evidence/language, release group, provider, and source link.
- [ ] Distinguish the automatic recommendation from a manually selected release; provide “Use this release” and a way to restore the automatic recommendation.
- [ ] Immediately update only the chosen episode’s active release, magnet, and download actions after a manual selection; keep episode selections independent.
- [ ] Preserve candidate data and magnet/source mappings; do not fabricate missing metadata; safely handle empty candidates, invalid magnets, duplicates, and missing metadata; keep selections stable through rerenders; never imply that a manual selection verifies a release.
- [ ] Keep the default episode list compact, reveal detailed comparisons only on expansion, match the existing dark theme, and remain responsive on desktop and mobile without unrelated redesigns or animations.
- [ ] Keep automatic recommendations as the default; preserve English Dub Only, quality filters, season coverage, authentication, and existing downloads. Do not modify Rust/WASM, rewrite ranking, or add a provider/dependency unless necessary.

## FDM handoff tray
- [x] Add individual currently selected episode releases or all available season releases, including independent manual selections; reject previews and invalid or incomplete magnets.
- [x] Keep a downloader-independent, movie-compatible selection model; deduplicate by torrent hash and file index, retain all episode references, and order episodes numerically.
- [x] Show the unique download count, empty state, per-download removal and clear controls, handling missing properties safely and retaining selections across title and season changes during the session.
- [x] Copy validated magnets one per line in deterministic order, report clipboard failures, and explain that FDM import requires user action and that multi-magnet clipboard import on current FDM 6.x is unverified.
- [x] Preserve individual magnet open/copy, existing season TXT export, Stremio fallback, release comparison, manual overrides, and the existing layout; do not imply an FDM transfer has been queued.

## Production deployment
- [x] Export the Express app for a Vercel Node function while retaining the local server entrypoint.
- [x] Add Vercel build and API rewrite configuration for the Vite frontend and provider proxy.
- [x] Verify the production deployment serves `/`, `/api/health`, Cinemeta search, and Torrentio source scans.

## Delivery checks
- [x] Verify the Vite Preview forwards API requests to the provider proxy.
- [x] Verify the real Torrentio proxy returns a normalized Breaking Bad source.
- [x] Verify live Cinemeta search and metadata loading for The Office, including real season options.
- [x] Verify parser tests and the production frontend build complete successfully after the provider and deployment changes.
- [x] Smoke-test the production Express entrypoint, `/api/health`, live Cinemeta search, and a live Torrentio episode scan locally.
