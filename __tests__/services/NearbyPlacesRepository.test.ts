import { OverpassNearbyPlacesRepository } from '../../src/repositories/NearbyPlacesRepository';

describe('OverpassNearbyPlacesRepository', () => {
  it('keeps a real POI with no usable OSM name under an honest fallback label', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        elements: [
          {
            type: 'node',
            id: 55,
            lat: 25.3965,
            lon: 68.3579,
            tags: { amenity: 'atm' },
          },
        ],
      }),
    } as Response);

    try {
      const repository = new OverpassNearbyPlacesRepository();
      const results = await repository.searchNearby({
        latitude: 25.396,
        longitude: 68.3578,
        category: 'atm',
        radius: 2,
      });

      // A missing name tag must never drop a real, correctly-tagged POI, and
      // must never invent a specific business name that OSM never provided.
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Unnamed ATM');
      expect(results[0]).toMatchObject({
        id: 'overpass:node:55',
        source: 'overpass',
        objectType: 'node',
        objectId: 55,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('still discards a result whose tags do not match the requested category', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        elements: [
          {
            type: 'node',
            id: 56,
            lat: 25.3965,
            lon: 68.3579,
            tags: { amenity: 'bank' },
          },
        ],
      }),
    } as Response);

    try {
      const repository = new OverpassNearbyPlacesRepository();
      const results = await repository.searchNearby({
        latitude: 25.396,
        longitude: 68.3578,
        category: 'atm',
        radius: 2,
      });
      expect(results).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('expands 2km to 5km sequentially and stops after the first useful tier', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockImplementation((url: string) => {
      const decodedUrl = decodeURIComponent(url);
      const elements = decodedUrl.includes('around:5000')
        ? [
            {
              type: 'node',
              id: 57,
              lat: 25.423,
              lon: 68.3578,
              tags: { amenity: 'cafe', name: 'Expanded Cafe' },
            },
          ]
        : [];
      return Promise.resolve({
        ok: true,
        json: async () => ({ elements }),
      } as Response);
    });
    globalThis.fetch = fetchMock;

    try {
      const repository = new OverpassNearbyPlacesRepository();
      const results = await repository.searchNearby({
        latitude: 25.396,
        longitude: 68.3578,
        category: 'cafe',
      });

      expect(results.map(result => result.name)).toEqual(['Expanded Cafe']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain(
        'around:2000',
      );
      expect(decodeURIComponent(String(fetchMock.mock.calls[1][0]))).toContain(
        'around:5000',
      );
      expect(
        fetchMock.mock.calls.some(call =>
          decodeURIComponent(String(call[0])).includes('around:10000'),
        ),
      ).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
