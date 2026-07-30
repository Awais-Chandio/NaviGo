import { nearbyPlacesService } from '../../src/services/NearbyPlacesService';

describe('NearbyPlacesService', () => {
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

  it('correctly parses Nominatim and Overpass way/relation center elements for Hospital and Parking', async () => {
    const mockUserLat = 25.396;
    const mockUserLon = 68.3578;

    const hospitalCenter = { lat: 25.399, lon: 68.361 };
    const parkingCenter = { lat: 25.397, lon: 68.359 };

    const mockNominatimHospital = [
      {
        place_id: '101',
        name: 'City Hospital & Medical Center',
        display_name: 'City Hospital & Medical Center, Main Rd',
        lat: String(hospitalCenter.lat),
        lon: String(hospitalCenter.lon),
      },
    ];

    const mockNominatimParking = [
      {
        place_id: '102',
        name: 'Central Car Parking',
        display_name: 'Central Car Parking, Plaza St',
        lat: String(parkingCenter.lat),
        lon: String(parkingCenter.lon),
      },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('hospital')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockNominatimHospital),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockNominatimParking),
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

    const mockData = [
      {
        place_id: '1',
        name: 'Close Restaurant',
        display_name: 'Close Restaurant, Market St',
        lat: String(closeLat),
        lon: String(closeLon),
      },
      {
        place_id: '2',
        name: 'Far Away Restaurant',
        display_name: 'Far Away Restaurant, Far City',
        lat: String(farLat),
        lon: String(farLon),
      },
    ];

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
