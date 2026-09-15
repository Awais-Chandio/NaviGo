import {
  NearbyPlacesService,
  nearbyPlacesService,
  recalculateNearbyDistances,
} from '../../src/services/NearbyPlacesService';
import type { INearbyPlacesRepository } from '../../src/repositories/NearbyPlacesRepository';
import type { DrivingDistanceProvider } from '../../src/services/RoadDistanceService';

describe('NearbyPlacesService', () => {
  it('recalculates current-GPS distances and switches units at one kilometre', () => {
    const places = [
      {
        id: 'under-one-km',
        name: 'Close Place',
        latitude: 25.4005,
        longitude: 68.3578,
        address: 'Close Road',
        category: 'food',
        distance: 9999,
        formattedDistance: '9999 m',
      },
      {
        id: 'over-one-km',
        name: 'Farther Place',
        latitude: 25.4095,
        longitude: 68.3578,
        address: 'Far Road',
        category: 'food',
        distance: 1,
        formattedDistance: '1 m',
      },
    ];

    const results = recalculateNearbyDistances(
      places,
      25.396,
      68.3578,
    );

    expect(results[0].id).toBe('under-one-km');
    expect(results[0].distance).toBeGreaterThan(400);
    expect(results[0].distance).toBeLessThan(600);
    expect(results[0].formattedDistance).toMatch(/^\d+ m$/);
    expect(results[1].distance).toBeGreaterThan(1000);
    expect(results[1].formattedDistance).toMatch(/^\d+\.\d km$/);
  });

  it('keeps Haversine distance for every result and enriches only the top result with road distance', async () => {
    const repository: INearbyPlacesRepository = {
      searchNearby: jest.fn().mockResolvedValue([
        {
          id: 'direct-nearest',
          name: 'Direct Nearest',
          latitude: 25.4,
          longitude: 68.36,
          address: 'First',
          category: 'food',
          distance: 400,
          formattedDistance: '400 m',
        },
        {
          id: 'road-nearest',
          name: 'Road Nearest',
          latitude: 25.41,
          longitude: 68.37,
          address: 'Second',
          category: 'food',
          distance: 700,
          formattedDistance: '700 m',
        },
      ]),
    };
    const roadProvider: DrivingDistanceProvider = {
      getDrivingDistances: jest.fn().mockResolvedValue([2200, 900]),
    };
    const service = new NearbyPlacesService(repository, roadProvider);

    const results = await service.searchNearby({
      latitude: 25.396,
      longitude: 68.3578,
      category: 'food',
    });

    expect(results.map(place => place.id)).toEqual([
      'direct-nearest',
      'road-nearest',
    ]);
    expect(roadProvider.getDrivingDistances).toHaveBeenCalledWith(
      { latitude: 25.396, longitude: 68.3578 },
      [{ latitude: 25.4, longitude: 68.36 }],
      undefined,
    );
    expect(results[0].roadDistance).toBe(2200);
    expect(results[0].formattedRoadDistance).toBe('2.2 km');
    expect(results[0].distance).toBeLessThan(results[1].distance);
    expect(results[1].roadDistance).toBeUndefined();
  });

  it('uses the shared ranking model to prefer complete nearby POIs when distance is similar', async () => {
    const repository: INearbyPlacesRepository = {
      searchNearby: jest.fn().mockResolvedValue([
        {
          id: 'bare-place',
          name: 'Unnamed Cafe',
          latitude: 25.397,
          longitude: 68.3578,
          address: '',
          category: 'cafe',
          distance: 0,
        },
        {
          id: 'complete-place',
          name: 'Local Cafe',
          latitude: 25.39701,
          longitude: 68.3578,
          address: 'Main Road, Saddar, Hyderabad',
          category: 'cafe',
          distance: 0,
          providerTags: { opening_hours: '08:00-22:00' },
        },
      ]),
    };
    const service = new NearbyPlacesService(repository, {
      getDrivingDistances: jest.fn(),
    });

    const results = await service.searchNearby({
      latitude: 25.396,
      longitude: 68.3578,
      category: 'cafe',
      includeRoadDistance: false,
    });

    expect(results.map(place => place.id)).toEqual([
      'complete-place',
      'bare-place',
    ]);
  });

  it('returns nearby places without waiting for optional road-distance enrichment', async () => {
    const repository: INearbyPlacesRepository = {
      searchNearby: jest.fn().mockResolvedValue([
        {
          id: 'fast-result',
          name: 'Fast Result',
          latitude: 25.397,
          longitude: 68.358,
          address: 'Nearby Road',
          category: 'food',
          distance: 0,
        },
      ]),
    };
    const roadProvider: DrivingDistanceProvider = {
      getDrivingDistances: jest.fn(),
    };
    const service = new NearbyPlacesService(repository, roadProvider);

    const results = await service.searchNearby({
      latitude: 25.396,
      longitude: 68.3578,
      category: 'food',
      includeRoadDistance: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].distance).toBeGreaterThan(0);
    expect(roadProvider.getDrivingDistances).not.toHaveBeenCalled();
  });

  it.each([
    ['hospital', 'Hospital Road', 'highway', 'residential', 'amenity', 'hospital'],
    ['hotel', 'Hotel Restaurant', 'amenity', 'restaurant', 'tourism', 'hotel'],
    ['restaurant', 'Restaurant Supplies', 'shop', 'houseware', 'amenity', 'restaurant'],
    ['atm', 'Bank Office', 'amenity', 'bank', 'amenity', 'atm'],
  ])('validates actual provider types for %s instead of names', async (
    category, misleadingTitle, wrongKey, wrongValue, validKey, validValue,
  ) => {
    const place = { latitude: 25.397, longitude: 68.358, subtitle: 'Nearby Road' };
    const service = new NearbyPlacesService(
      { searchNearby: jest.fn().mockResolvedValue([]) },
      { getDrivingDistances: jest.fn() },
      { searchPlaces: jest.fn().mockResolvedValue([
        { ...place, id: 'wrong', title: misleadingTitle, raw: { osm_key: wrongKey, osm_value: wrongValue } },
        { ...place, id: 'unverified', title: category },
        { ...place, id: 'valid', title: 'Actual Business', raw: { osm_key: validKey, osm_value: validValue } },
      ]) },
    );
    const result = await service.searchNearby({ latitude: 25.396, longitude: 68.3578, category, radius: 2, includeRoadDistance: false });
    expect(result.map(item => item.name)).toEqual(['Actual Business']);
  });

  it('uses authoritative Overpass results without duplicating the request through Photon', async () => {
    const repository: INearbyPlacesRepository = {
      searchNearby: jest.fn(() =>
        new Promise(resolve => {
          setTimeout(
            () =>
              resolve([
                {
                  id: 'overpass-result',
                  name: 'Detailed Restaurant',
                  latitude: 25.398,
                  longitude: 68.359,
                  address: 'Detailed address',
                  category: 'restaurant',
                  distance: 0,
                },
              ]),
            5,
          );
        }),
      ),
    };
    const fallbackProvider = {
      searchPlaces: jest.fn().mockResolvedValue([
        {
          id: 'fast-photon-result',
          title: 'Fast Restaurant',
          raw: { osm_key: 'amenity', osm_value: 'restaurant' },
          subtitle: 'Saddar',
          latitude: 25.397,
          longitude: 68.358,
          categoryName: 'Restaurant',
        },
      ]),
    };
    const roadProvider: DrivingDistanceProvider = {
      getDrivingDistances: jest.fn(),
    };
    const service = new NearbyPlacesService(
      repository,
      roadProvider,
      fallbackProvider,
    );
    const partialResults = jest.fn();

    const results = await service.searchNearby(
      {
        latitude: 25.396,
        longitude: 68.3578,
        category: 'restaurant',
        radius: 2,
        includeRoadDistance: false,
      },
      undefined,
      partialResults,
    );

    expect(partialResults).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Detailed Restaurant' }),
    ]);
    expect(results.map(place => place.name)).toEqual([
      'Detailed Restaurant',
    ]);
    expect(fallbackProvider.searchPlaces).not.toHaveBeenCalled();
  });

  it.each([
    ['supermarket', 'City Shopping Mall', 'Shopping'],
    ['school', 'City Public School', 'School'],
    ['university', 'City University', 'University'],
  ])(
    'rejects distant %s fallback results and keeps the detected country',
    async (category, title, categoryName) => {
      const repository: INearbyPlacesRepository = {
        searchNearby: jest.fn().mockResolvedValue([]),
      };
      const fallbackProvider = {
        searchPlaces: jest.fn().mockResolvedValue([
          {
            id: `${category}-result`,
            title,
            subtitle: 'Wider city area',
            latitude: 25.44,
            longitude: 68.3578,
            categoryName,
            raw: { osm_key: category === 'supermarket' ? 'shop' : 'amenity', osm_value: category },
          },
        ]),
      };
      const service = new NearbyPlacesService(
        repository,
        { getDrivingDistances: jest.fn() },
        fallbackProvider,
      );

      const results = await service.searchNearby({
        latitude: 25.396,
        longitude: 68.3578,
        category,
        countryCode: 'AE',
        radius: 2,
        includeRoadDistance: false,
      });

      expect(results).toEqual([]);
      expect(fallbackProvider.searchPlaces).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          countryCode: 'AE',
          radiusMeters: 2000,
        }),
      );
    },
  );

  it('uses the place-search fallback when Overpass times out', async () => {
    const repository: INearbyPlacesRepository = {
      searchNearby: jest.fn().mockRejectedValue(new Error('Overpass timeout')),
    };
    const roadProvider: DrivingDistanceProvider = {
      getDrivingDistances: jest.fn(),
    };
    const fallbackProvider = {
      searchPlaces: jest.fn().mockResolvedValue([
        {
          id: 'fallback-restaurant',
          title: 'Fallback Restaurant',
          raw: { osm_key: 'amenity', osm_value: 'restaurant' },
          subtitle: 'Nearby Road',
          latitude: 25.397,
          longitude: 68.358,
          displayName: 'Fallback Restaurant, Nearby Road',
          distanceMeters: 650,
          formattedDistance: '650 m',
        },
      ]),
    };
    const service = new NearbyPlacesService(
      repository,
      roadProvider,
      fallbackProvider,
    );

    const results = await service.searchNearby({
      latitude: 25.396,
      longitude: 68.3578,
      category: 'restaurant',
      radius: 2,
    });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Fallback Restaurant');
    // Provider distances can be stale or based on another origin. The nearby
    // service must derive fallback distance from the requested GPS fix.
    expect(results[0].distance).toBeGreaterThan(100);
    expect(results[0].distance).toBeLessThan(130);
    expect(results[0].formattedDistance).toBe(`${results[0].distance} m`);
    expect(roadProvider.getDrivingDistances).not.toHaveBeenCalled();
  });

  it('returns empty array when GPS coordinates are missing or invalid', async () => {
    const resultsNull = await nearbyPlacesService.searchNearby({
      latitude: 0,
      longitude: 0,
      category: 'restaurant',
    });
    expect(resultsNull).toEqual([]);

    const resultsNaN = await nearbyPlacesService.searchNearby({
      latitude: NaN,
      longitude: NaN,
      category: 'atm',
    });
    expect(resultsNaN).toEqual([]);
  });

  it('correctly parses Overpass way/relation center elements for Hospital and Parking', async () => {
    const mockUserLat = 25.396;
    const mockUserLon = 68.3578;

    const hospitalCenter = { lat: 25.399, lon: 68.361 };
    const parkingCenter = { lat: 25.397, lon: 68.359 };

    const mockOverpassHospital = {
      elements: [
        {
          type: 'way',
          id: 101,
          center: hospitalCenter,
          tags: {
            name: 'City Hospital & Medical Center',
            amenity: 'hospital',
            'addr:street': 'Main Rd',
          },
        },
      ],
    };

    const mockOverpassParking = {
      elements: [
        {
          type: 'relation',
          id: 102,
          center: parkingCenter,
          tags: {
            name: 'Central Car Parking',
            amenity: 'parking',
            'addr:street': 'Plaza St',
          },
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('hospital')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOverpassHospital),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockOverpassParking),
      } as unknown as Response);
    });

    try {
      const hospitalResults = await nearbyPlacesService.searchNearby({
        latitude: mockUserLat,
        longitude: mockUserLon,
        category: 'hospital',
        radius: 5,
      });

      expect(hospitalResults.length).toBe(1);
      expect(hospitalResults[0].name).toBe('City Hospital & Medical Center');
      expect(hospitalResults[0].distance).toBeGreaterThan(0);

      const parkingResults = await nearbyPlacesService.searchNearby({
        latitude: mockUserLat,
        longitude: mockUserLon,
        category: 'parking',
        radius: 5,
      });

      expect(parkingResults.length).toBe(1);
      expect(parkingResults[0].name).toBe('Central Car Parking');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('filters out results that are outside the requested search radius', async () => {
    const mockUserLat = 25.396;
    const mockUserLon = 68.3578;

    const farLat = 26.5;
    const farLon = 69.5;

    const closeLat = 25.398;
    const closeLon = 68.360;

    const mockData = {
      elements: [
        {
          type: 'node',
          id: 1,
          lat: closeLat,
          lon: closeLon,
          tags: { name: 'Close Restaurant', amenity: 'restaurant' },
        },
        {
          type: 'node',
          id: 2,
          lat: farLat,
          lon: farLon,
          tags: { name: 'Far Away Restaurant', amenity: 'restaurant' },
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockData),
    } as unknown as Response);

    try {
      const results = await nearbyPlacesService.searchNearby({
        latitude: mockUserLat,
        longitude: mockUserLon,
        category: 'food',
        radius: 5,
      });

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Close Restaurant');
      expect(results[0].distance).toBeLessThanOrEqual(5000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
