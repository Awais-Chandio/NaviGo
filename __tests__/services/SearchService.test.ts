import { searchService } from '../../src/services/searchService';

describe('SearchService', () => {
  it('returns empty array when query length is less than 2 characters', async () => {
    const results = await searchService.search('a');
    expect(results).toEqual([]);
  });

  it('aggregates suggestions across recent, saved, nearby, and search results', async () => {
    const suggestions = await searchService.getSuggestions('');
    expect(suggestions).toHaveProperty('recent');
    expect(suggestions).toHaveProperty('saved');
    expect(suggestions).toHaveProperty('nearby');
    expect(suggestions).toHaveProperty('searchResults');
    expect(Array.isArray(suggestions.saved)).toBe(true);
  });

  it('uses Photon API for autocomplete and restricts results to Pakistan', async () => {
    const mockPhotonResponse = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            coordinates: [68.3578, 25.396],
            type: 'Point',
          },
          properties: {
            osm_id: 1001,
            name: 'St Elizabeth Hospital',
            street: 'Autobahn Road',
            district: 'Latifabad',
            city: 'Hyderabad',
            state: 'Sindh',
            country: 'Pakistan',
            countrycode: 'PK',
          },
        },
        {
          type: 'Feature',
          geometry: {
            coordinates: [77.209, 28.6139],
            type: 'Point',
          },
          properties: {
            osm_id: 1002,
            name: 'Foreign Hospital',
            city: 'Delhi',
            country: 'India',
            countrycode: 'IN',
          },
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPhotonResponse),
    } as unknown as Response);

    try {
      const results = await searchService.searchPlaces('hospital', {
        userLocation: { latitude: 25.396, longitude: 68.3578 },
      });

      expect(results.length).toBe(1);
      expect(results[0].title).toBe('St Elizabeth Hospital');
      expect(results[0].subtitle).toContain('Hyderabad');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces Photon failure instead of using forbidden Nominatim autocomplete', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('Network failure'));

    try {
      await expect(
        searchService.searchPlaces('unique unavailable query'),
      ).rejects.toThrow('Photon autocomplete is currently unavailable');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
