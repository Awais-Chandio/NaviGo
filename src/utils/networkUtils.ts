export class RequestTimeoutError extends Error {
  constructor(message = 'The request timed out.') {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

export type FetchWithTimeoutOptions = RequestInit & {
  timeoutMs?: number;
};

export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = 10000, signal, ...fetchOptions } = options;
  const controller = new AbortController();
  let didTimeout = false;

  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (error) {
    if (didTimeout && !signal?.aborted) {
      throw new RequestTimeoutError(
        `The request timed out after ${timeoutMs}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function isCallerAbort(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  return Boolean(
    signal?.aborted &&
      error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name: unknown }).name === 'AbortError',
  );
}

export async function waitForRetry(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abort);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function createAbortError(): Error {
  const error = new Error('The request was cancelled.');
  error.name = 'AbortError';
  return error;
}
