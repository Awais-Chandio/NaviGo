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
});
