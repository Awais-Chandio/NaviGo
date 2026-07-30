import { searchService } from '../../src/services/searchService';

describe('SearchService', () => {
  it('returns empty array when query length is less than 2 characters', async () => {
    const results = await searchService.search('a');
    expect(results).toEqual([]);
  });

  it('aggregates suggestions across recent, saved, nearby, and search results', async () => {
    const suggestions = await searchService.getSuggestions('Home');
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

  it('falls back to Nominatim repository if Photon API fails twice', async () => {
    const mockNominatimResponse = [
      {
        place_id: '2001',
        display_name: 'Hyderabad Civil Hospital, Saddar, Hyderabad, Sindh, Pakistan',
        lat: '25.3965',
        lon: '68.3580',
        importance: 0.8,
        address: { city: 'Hyderabad', country_code: 'pk' },
      },
    ];

    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      callCount++;
      if (url.includes('photon.komoot.io')) {
        return Promise.reject(new Error('Network failure'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockNominatimResponse),
      } as unknown as Response);
    });

    try {
      const results = await searchService.searchPlaces('hospital');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].title).toBe('Hyderabad Civil Hospital');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
