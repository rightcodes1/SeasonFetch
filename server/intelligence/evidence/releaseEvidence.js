export function extractReleaseEvidence(release) {
  return {
    sizeBytes: release?.sizeBytes ?? null,
    seeders: release?.seeders ?? null,
    releaseType: release?.releaseType ?? null,
    releaseGroup: release?.releaseGroup ?? null,
    metadataCompleteness: release?.source?.metadataCompleteness ?? 0
  };
}
