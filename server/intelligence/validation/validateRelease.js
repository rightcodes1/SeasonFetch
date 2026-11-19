export function validateRelease(release) {
  const warnings = [];
  if (!release?.infoHash) warnings.push("missing-info-hash");
  if (!release?.resolution) warnings.push("unknown-resolution");
  if (release?.sizeBytes === null) warnings.push("unknown-size");
  if (release?.seeders === null) warnings.push("unknown-seeders");
  if (release?.audio?.classification === "unverified") warnings.push("unverified-audio");
  if (release?.sizeBytes !== null && release.sizeBytes < 0) warnings.push("invalid-size");
  const status = warnings.some(warning => warning === "missing-info-hash" || warning === "invalid-size") ? "invalid" : warnings.length ? "partial" : "validated";
  return { ...release, validation: { status, warnings } };
}
