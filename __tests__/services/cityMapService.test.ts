import { LOCATION_CONFIG } from '../../src/config/locationConfig';
import { cityMapService } from '../../src/services/cityMapService';
import { getHaversineDistance } from '../../src/utils/locationUtils';

describe('CityMapService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates guaranteed circular coverage around the complete city bounds', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        {
          osm_type: 'relation',
          category: 'place',
          type: 'city',
          addresstype: 'city',
          display_name: 'Hyderabad, Sindh, Pakistan',
          boundingbox: ['25.25', '25.55', '68.18', '68.55'],
          address: { city: 'حیدرآباد', country_code: 'pk' },
        },
        {
          osm_type: 'relation',
          category: 'boundary',
          type: 'administrative',
          addresstype: 'city',
          display_name: 'Hyderabad City Taluka, Sindh, Pakistan',
          boundingbox: ['25.34', '25.46', '68.3', '68.45'],
          address: { city: 'Hyderabad City Taluka', country_code: 'pk' },
        },
      ],
    } as Response);

    const plan = await cityMapService.resolveDownloadPlan({
      cityName: 'Hyderabad',
      countryCode: 'PK',
      userLocation: { latitude: 25.38, longitude: 68.34 },
    });

    expect(plan.name).toBe('Hyderabad City');
    expect(plan.usedFallback).toBe(false);
    expect(plan.center.latitude).toBeCloseTo(25.4, 8);
    expect(plan.center.longitude).toBeCloseTo(68.365, 8);
    const cornerDistanceKm =
      getHaversineDistance(25.4, 68.365, 25.55, 68.55) / 1000;
    expect(plan.radiusKm).toBeGreaterThan(cornerDistanceKm);
  });

  it('uses the safe Hyderabad fallback when boundary lookup is unavailable', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network down'));

    const plan = await cityMapService.resolveDownloadPlan({
      cityName: 'Hyderabad',
      countryCode: 'PK',
      userLocation: {
        latitude: LOCATION_CONFIG.DEFAULT_REGION.latitude,
        longitude: LOCATION_CONFIG.DEFAULT_REGION.longitude,
      },
    });

    expect(plan.usedFallback).toBe(true);
    expect(plan.name).toBe('Hyderabad City');
    expect(plan.radiusKm).toBe(LOCATION_CONFIG.DEFAULT_CITY_OFFLINE_RADIUS_KM);
  });

  it('does not silently download the default city for a distant unknown city', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    await expect(
      cityMapService.resolveDownloadPlan({
        cityName: 'Unknown City',
        userLocation: { latitude: 31.52, longitude: 74.35 },
      }),
    ).rejects.toThrow('No downloadable boundary');
  });
});
