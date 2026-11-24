export function compareChapters(left, right) {
  const leftNumber = Number.isFinite(left?.number) ? left.number : Number.POSITIVE_INFINITY;
  const rightNumber = Number.isFinite(right?.number) ? right.number : Number.POSITIVE_INFINITY;
  if (leftNumber !== rightNumber) return leftNumber - rightNumber;

  const leftVolume = Number.isFinite(left?.volumeNumber) ? left.volumeNumber : Number.POSITIVE_INFINITY;
  const rightVolume = Number.isFinite(right?.volumeNumber) ? right.volumeNumber : Number.POSITIVE_INFINITY;
  if (leftVolume !== rightVolume) return leftVolume - rightVolume;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

export function sortChapters(chapters = []) {
  return [...chapters].sort(compareChapters);
}

export function sortPages(pages = []) {
  return [...pages].sort((left, right) => left.index - right.index);
}
