import { ConnectivityService } from '../../src/services/connectivityService';

describe('ConnectivityService', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('stays online when Google is unavailable but an app service responds', async () => {
    globalThis.fetch = jest.fn((url: string | URL | Request) => {
      if (String(url).includes('clients3.google.com')) {
        return Promise.reject(new TypeError('Network request failed'));
      }
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as typeof fetch;

    const service = new ConnectivityService();

    await expect(service.verifyConnection()).resolves.toBe(true);
    expect(service.getState()).toMatchObject({
      isOnline: true,
      mode: 'auto',
    });
  });

  it('reports offline only when every connectivity probe fails', async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.reject(new TypeError('Network request failed')),
    ) as typeof fetch;

    const service = new ConnectivityService();

    await expect(service.verifyConnection()).resolves.toBe(false);
    expect(service.getState()).toEqual({
      isOnline: false,
      mode: 'auto',
      networkType: 'none',
    });
  });

  it('deduplicates simultaneous automatic connectivity checks', async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 204 } as Response),
    ) as typeof fetch;

    const service = new ConnectivityService();
    const first = service.verifyConnection();
    const second = service.verifyConnection();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
