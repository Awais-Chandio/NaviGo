import {
  fetchWithTimeout,
  isCallerAbort,
  RequestTimeoutError,
} from '../../src/utils/networkUtils';

function abortablePendingFetch(
  _url: string,
  options?: RequestInit,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    options?.signal?.addEventListener(
      'abort',
      () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      },
      { once: true },
    );
  });
}

describe('networkUtils', () => {
  it('distinguishes an internal timeout from caller cancellation', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(abortablePendingFetch) as typeof fetch;

    try {
      await expect(
        fetchWithTimeout('https://example.test', { timeoutMs: 5 }),
      ).rejects.toBeInstanceOf(RequestTimeoutError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves caller abort semantics', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(abortablePendingFetch) as typeof fetch;
    const controller = new AbortController();

    try {
      const request = fetchWithTimeout('https://example.test', {
        signal: controller.signal,
        timeoutMs: 1000,
      });
      controller.abort();
      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
      await request.catch(error => {
        expect(isCallerAbort(error, controller.signal)).toBe(true);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
