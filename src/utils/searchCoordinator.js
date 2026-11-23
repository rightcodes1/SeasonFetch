export function createSearchCoordinator() {
  let requestId = 0;
  let timer = null;

  function invalidate() {
    requestId += 1;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    return requestId;
  }

  function schedule(callback, delayMs = 0) {
    invalidate();
    const id = requestId;
    timer = setTimeout(() => {
      timer = null;
      if (id === requestId) callback(id);
    }, Math.max(0, delayMs));
    return id;
  }

  return { invalidate, schedule, isCurrent: id => id === requestId };
}
