import { detectCategory, searchService } from '../../src/services/searchService';
import { PhotonSearchRepository, normalizeDetectedCity } from '../../src/repositories/SearchRepository';
import { connectivityService } from '../../src/services/connectivityService';
import { offlineDatabaseService } from '../../src/services/OfflineDatabaseService';

describe('SearchService', () => {
  it('uses provider types instead of guessing a category from the name', () => {
    expect(
      detectCategory('Hospital Road', 'residential', {
        highway: 'residential',
      }).name,
    ).toBe('Residential');
    expect(
      detectCategory('Any provider name', 'hospital', {
        amenity: 'hospital',
      }).name,
    ).toBe('Hospital');
  });

  it('does not reuse a wider radius cache or return distant-only matches', async () => {
    const repository = new PhotonSearchRepository();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [{
        geometry: { coordinates: [68.3578, 25.44] },
        properties: { osm_id: 9876, name: 'Radius Cafe', city: 'Hyderabad', osm_value: 'cafe' },
      }] }),
    } as Response);
    try {
      const options = { userLocation: { latitude: 25.396, longitude: 68.3578 } };
      expect(await repository.searchPlaces('Radius', { ...options, radiusMeters: 10000 })).toHaveLength(1);
      expect(await repository.searchPlaces('Radius', { ...options, radiusMeters: 2000 })).toEqual([]);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('labels a nameless provider feature honestly instead of dropping it, for category browsing', async () => {
    const repository = new PhotonSearchRepository();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [68.3578, 25.397] },
            properties: {
              osm_id: 4321,
              city: 'Hyderabad',
              osm_key: 'amenity',
              osm_value: 'cafe',
              // No name/title: a real cafe that OSM never tagged with a name.
            },
          },
        ],
      }),
    } as Response);
    try {
      // This mirrors how NearbyPlacesService falls back to Photon using a
      // category alias (e.g. "cafe") rather than a user-typed name.
      const results = await repository.searchPlaces('cafe', {
        userLocation: { latitude: 25.396, longitude: 68.3578 },
      });
      expect(results).toEqual([
        expect.objectContaining({ title: 'Unnamed Cafe' }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('normalizes a taluka result to its parent city district', () => {
    expect(normalizeDetectedCity('Latifabad Taluka', 'Hyderabad District')).toBe(
      'Hyderabad',
    );
    expect(normalizeDetectedCity('Hyderabad', 'Hyderabad District')).toBe(
      'Hyderabad',
    );
  });

  it('returns empty array for an empty or whitespace-only query', async () => {
    expect(await searchService.search('')).toEqual([]);
    expect(await searchService.search('   ')).toEqual([]);
  });

  it('is usable from the first typed character, bounded by the current GPS area', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [68.3578, 25.397] },
            properties: {
              osm_id: 111,
              name: 'Pizza Point',
              city: 'Hyderabad',
              osm_key: 'amenity',
              osm_value: 'restaurant',
            },
          },
        ],
      }),
    } as Response);
    globalThis.fetch = fetchMock;
    try {
      const results = await searchService.search('p', {
        latitude: 25.396,
        longitude: 68.3578,
      });
      // A single character still reaches the provider (no early "too short"
      // guard) with the query text and a location bias applied, and still
      // comes back through the same ranking/distance pipeline as any other
      // query length.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestedUrl = String(fetchMock.mock.calls[0][0]);
      expect(requestedUrl).toContain('q=p');
      expect(requestedUrl).toContain('lat=25.396');
      expect(results).toEqual([
        expect.objectContaining({ name: 'Pizza Point', category: 'Food' }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it('matches partial place-name characters and keeps current-city results', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          type: 'FeatureCollection',
          features: [
            {
              geometry: { coordinates: [68.359, 25.398] },
              properties: {
                osm_id: 2001,
                name: 'The Grill Town',
                district: 'Qasimabad',
                city: 'Hyderabad',
                country: 'Pakistan',
                countrycode: 'PK',
                osm_key: 'amenity',
                osm_value: 'restaurant',
              },
            },
            {
              geometry: { coordinates: [67.0011, 24.8607] },
              properties: {
                osm_id: 2002,
                name: 'Grill Town Karachi',
                city: 'Karachi',
                country: 'Pakistan',
                countrycode: 'PK',
              },
            },
            {
              geometry: { coordinates: [68.358, 25.397] },
              properties: {
                osm_id: 2003,
                name: 'Grocery Market',
                city: 'Hyderabad',
                country: 'Pakistan',
                countrycode: 'PK',
              },
            },
          ],
        }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    try {
      const results = await searchService.searchPlaces('Gri', {
        userLocation: { latitude: 25.396, longitude: 68.3578 },
        countryCode: 'PK',
      });

      expect(results.map(result => result.title)).toEqual(['The Grill Town']);
      const requestedUrl = String(fetchMock.mock.calls[0][0]);
      expect(requestedUrl).toContain('&lat=25.396&lon=68.3578');
      expect(requestedUrl).toContain('&bbox=');
      expect(requestedUrl).not.toContain('bbox=60.87,23.63,77.84,37.10');
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
        'dynamic country mall',
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

  it('removes repeated Photon features with the same OSM object identity', async () => {
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
                osm_type: 'N',
                name: 'City Cafe',
                city: 'Hyderabad',
                country: 'Pakistan',
                countrycode: 'PK',
              },
            },
            {
              geometry: { coordinates: [68.35781, 25.39601] },
              properties: {
                osm_id: 9001,
                osm_type: 'N',
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
      const results = await searchService.searchPlaces('city cafe', {
        userLocation: { latitude: 25.396, longitude: 68.3578 },
      });
      expect(results).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('searches downloaded POIs immediately while offline without calling Photon', async () => {
    await offlineDatabaseService.insertPOIs('offline_search', [
      {
        id: 'offline_hospital',
        name: 'Offline City Hospital',
        category: 'hospital',
        latitude: 25.396,
        longitude: 68.3578,
        address: 'Main Road, Hyderabad',
        regionId: 'offline_search',
        createdAt: new Date().toISOString(),
      },
    ]);
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    connectivityService.setMode('offline');

    try {
      const results = await searchService.searchPlaces('City Hospital', {
        userLocation: { latitude: 25.396, longitude: 68.3578 },
      });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Offline City Hospital');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      connectivityService.setMode('online');
      globalThis.fetch = originalFetch;
      await offlineDatabaseService.deletePOIsForRegion('offline_search');
    }
  });
});
