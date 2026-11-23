export function createScanCoordinator({ onCheckingChange = () => {} } = {}) {
  let requestId = 0;
  let timer = null;
  let controller = null;
  let active = false;

  function invalidate() {
    requestId += 1;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (controller) {
      controller.abort();
      controller = null;
    }
    if (active) {
      active = false;
      onCheckingChange(false);
    }
    return requestId;
  }

  function start({ delayMs = 0, request, onSuccess, onError }) {
    if (typeof request !== 'function') throw new TypeError('A scan request function is required.');
    invalidate();
    const id = requestId;
    const activeController = new AbortController();
    controller = activeController;
    active = true;
    onCheckingChange(true);

    timer = setTimeout(async () => {
      timer = null;
      if (id !== requestId) return;
      let result;
      let requestError;
      try {
        result = await request(activeController.signal);
      } catch (error) {
        requestError = error;
      }

      if (id !== requestId) return;
      try {
        if (requestError) onError?.(requestError);
        else onSuccess?.(result);
      } finally {
        if (id === requestId) {
          controller = null;
          active = false;
          onCheckingChange(false);
        }
      }
    }, Math.max(0, delayMs));

    return id;
  }

  return { invalidate, start, isCurrent: id => id === requestId };
}
