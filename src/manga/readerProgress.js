export function restoreReadingPosition(savedProgress, pageCount) {
  const lastPageIndex = Math.max(0, pageCount - 1);
  const savedPageIndex = Number.isInteger(savedProgress?.pageIndex) ? savedProgress.pageIndex : 0;
  const pageIndex = Math.max(0, Math.min(savedPageIndex, lastPageIndex));

  return {
    pageIndex,
    completed: pageCount > 0 && savedProgress?.completed === true && pageIndex === lastPageIndex
  };
}

export function getReaderRetryTarget(pageCount) {
  return pageCount > 0 ? 'page' : 'chapter';
}
