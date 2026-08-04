import { geocodingService } from '../../src/services/geocodingService';
import type { SearchProvider } from '../../src/services/geocodingService';

describe('geocodingService location-aware distances', () => {
  const provider: SearchProvider = {
    name: 'Test provider',
    search: jest.fn().mockResolvedValue([
      {
        id: 'place-1',
        title: 'Test Place',
        subtitle: 'Test Road',
        latitude: 25.41,
        longitude: 68.37,
        displayName: 'Test Place, Test Road',
        distanceMeters: 500,
        formattedDistance: '500 m',
      },
    ]),
    reverseGeocode: jest.fn().mockResolvedValue('Test Road'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    geocodingService.setProvider(provider);
  });

  it('recalculates provider distance from the current GPS fix', async () => {
    const results = await geocodingService.searchPlaces('test', {
      userLocation: { latitude: 25.396, longitude: 68.3578 },
    });

    expect(results[0].distanceMeters).toBeGreaterThan(0);
    expect(results[0].distanceMeters).not.toBe(500);
    expect(results[0].formattedDistance).toBeDefined();
  });

  it('hides fabricated distance when there is no real GPS fix', async () => {
    const results = await geocodingService.searchPlaces('test');

    expect(results[0].distanceMeters).toBeUndefined();
    expect(results[0].formattedDistance).toBeUndefined();
  });

  it('uses bounded Nominatim search for an explicit nearby category', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([
        {
          place_id: 501,
          display_name: 'Local Cafe, Saddar, Hyderabad, Pakistan',
          lat: '25.397',
          lon: '68.358',
          type: 'cafe',
          category: 'amenity',
          address: {
            amenity: 'Local Cafe',
            suburb: 'Saddar',
            city: 'Hyderabad',
          },
          importance: 0.5,
        },
      ]),
    } as unknown as Response);

    try {
      const results = await geocodingService.searchCategoryPlaces(
        'unique nearby cafe',
        {
          userLocation: { latitude: 25.396, longitude: 68.3578 },
          radiusMeters: 2000,
          limit: 20,
        },
      );

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Local Cafe');
      expect(results[0].distanceMeters).toBeLessThan(2000);
      expect(provider.search).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('propagates an aborted category request without starting Photon fallback', async () => {
    const originalFetch = globalThis.fetch;
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    globalThis.fetch = jest.fn().mockRejectedValue(abortError);
    const controller = new AbortController();
    controller.abort();

    try {
      await expect(
        geocodingService.searchCategoryPlaces('cancelled cafe query', {
          userLocation: { latitude: 25.396, longitude: 68.3578 },
          radiusMeters: 2000,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(provider.search).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

});
