import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, resolveApiRequest, SEASONFETCH_API_BASE_URL } from '../../src/services/api.js';

test('website API requests retain their relative path', () => {
  assert.equal(
    resolveApiRequest('/api/cinemeta/search?q=Breaking%20Bad', false),
    '/api/cinemeta/search?q=Breaking%20Bad'
  );
});

test('desktop API requests use the explicit SeasonFetch backend origin', () => {
  assert.equal(
    resolveApiRequest('/api/cinemeta/search?q=Breaking%20Bad', true),
    `${SEASONFETCH_API_BASE_URL}/api/cinemeta/search?q=Breaking%20Bad`
  );
});

test('website apiFetch delegates to browser fetch with its relative URL and options', async () => {
  const originalFetch = globalThis.fetch;
  const expectedOptions = { method: 'POST', body: '{"query":"Example"}' };
  let actualCall;
  globalThis.fetch = async (...args) => {
    actualCall = args;
    return { status: 200 };
  };

  try {
    const response = await apiFetch('/api/gemini/search-assist', expectedOptions);
    assert.equal(response.status, 200);
    assert.deepEqual(actualCall, ['/api/gemini/search-assist', expectedOptions]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API transport rejects non-API and origin-escaping request paths', () => {
  for (const path of ['https://example.com/api/health', '//example.com/api/health', '/api/../health', '/health']) {
    assert.throws(() => resolveApiRequest(path, true), TypeError, path);
  }
});
