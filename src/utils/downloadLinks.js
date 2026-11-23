const STREMIO_DOWNLOAD_ORIGIN = 'http://127.0.0.1:11470';

export function buildStremioDownloadLink(item) {
  if (!item?.hash || !Number.isInteger(item.fileIdx) || item.fileIdx < 0) return '';
  return `${STREMIO_DOWNLOAD_ORIGIN}/${encodeURIComponent(item.hash)}/${item.fileIdx}?external=1&download=1`;
}

export { STREMIO_DOWNLOAD_ORIGIN };
