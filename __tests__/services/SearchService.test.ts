import { searchService } from '../../src/services/searchService';
import { normalizeDetectedCity } from '../../src/repositories/SearchRepository';

describe('SearchService', () => {
  it('normalizes a taluka result to its parent city district', () => {
    expect(normalizeDetectedCity('Latifabad Taluka', 'Hyderabad District')).toBe(
      'Hyderabad',
    );
    expect(normalizeDetectedCity('Hyderabad', 'Hyderabad District')).toBe(
      'Hyderabad',
    );
  });

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
        countryCode: 'PK',
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

  it('does not inject the fallback map center when GPS is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              geometry: { coordinates: [67.0011, 24.8607] },
              properties: {
                osm_id: 777,
                name: 'No GPS Place',
                city: 'Karachi',
                country: 'Pakistan',
                countrycode: 'PK',
              },
            },
          ],
        }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    try {
      const results = await searchService.searchPlaces('no gps place');
      const requestedUrl = String(fetchMock.mock.calls[0][0]);
      expect(requestedUrl).not.toContain('&lat=');
      expect(requestedUrl).not.toContain('&lon=');
      expect(results[0].distanceMeters).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not hard-code Pakistan when the detected country is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              geometry: { coordinates: [55.2708, 25.2048] },
              properties: {
                osm_id: 778,
                name: 'Dynamic Country Mall',
                city: 'Dubai',
                country: 'United Arab Emirates',
                countrycode: 'AE',
              },
            },
          ],
        }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    try {
      const results = await searchService.searchPlaces(
        'unique dynamic country mall',
        { userLocation: { latitude: 25.2048, longitude: 55.2708 } },
      );
      const requestedUrl = String(fetchMock.mock.calls[0][0]);
      expect(requestedUrl).not.toContain('countrycode=PK');
      expect(results.map(result => result.title)).toEqual([
        'Dynamic Country Mall',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('removes normalized duplicate provider features at the same place', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              geometry: { coordinates: [68.3578, 25.396] },
              properties: {
                osm_id: 9001,
                name: 'City Cafe',
                city: 'Hyderabad',
                country: 'Pakistan',
                countrycode: 'PK',
              },
            },
            {
              geometry: { coordinates: [68.35781, 25.39601] },
              properties: {
                osm_id: 9002,
                name: 'City-Cafe',
                city: 'Hyderabad',
                country: 'Pakistan',
                countrycode: 'PK',
              },
            },
          ],
        }),
    } as unknown as Response);

    try {
      const results = await searchService.searchPlaces('unique city cafe', {
        userLocation: { latitude: 25.396, longitude: 68.3578 },
      });
      expect(results).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
