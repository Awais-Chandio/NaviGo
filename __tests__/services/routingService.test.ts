import {
  applyTravelModeToRoutes,
  estimateTravelModeDuration,
  normalizeAndSortRoutes,
  OfflineRoutingUnavailableError,
  parseOSRMSteps,
  routingService,
  type OSRMStep,
} from '../../src/services/routingService';
import {
  InvalidRoutingResponseError,
  OSRMPlanRoutingRepository,
} from '../../src/repositories/RoutingRepository';
import { connectivityService } from '../../src/services/connectivityService';
import {
  OfflineCoverageError,
  offlineMapManager,
} from '../../src/services/offlineMapService';

describe('routingService', () => {
  test('parseOSRMSteps converts raw OSRM steps into user instructions', () => {
    const rawSteps: OSRMStep[] = [
      {
        distance: 120,
        duration: 15,
        name: 'Shahrah-e-Faisal',
        maneuver: { type: 'depart', modifier: 'right' },
      },
      {
        distance: 450,
        duration: 40,
        name: 'Main Boulevard',
        maneuver: { type: 'turn', modifier: 'right' },
      },
      {
        distance: 0,
        duration: 0,
        maneuver: { type: 'arrive' },
      },
    ];

    const parsed = parseOSRMSteps(rawSteps);
    expect(parsed.length).toBe(3);
    expect(parsed[0].instruction).toContain('Start navigation');
    expect(parsed[1].instruction).toBe('Turn right onto Main Boulevard');
    expect(parsed[2].instruction).toBe('You have arrived at your destination');
  });

  test('OSRM routes use GeoJSON longitude/latitude geometry and select the fastest route', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        code: 'Ok',
        routes: [
          {
            geometry: {
              coordinates: [
                [68.0, 25.0],
                [68.02, 25.02],
              ],
            },
            distance: 2500,
            duration: 400,
            legs: [{ steps: [] }],
          },
          {
            geometry: {
              coordinates: [
                [68.0, 25.0],
                [68.01, 25.01],
              ],
            },
            distance: 2000,
            duration: 300,
            legs: [{ steps: [] }],
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const repository = new OSRMPlanRoutingRepository();
      const routes = await repository.getRouteAlternatives(
        25,
        68,
        25.01,
        68.01,
      );

      expect(fetchMock.mock.calls[0][0]).toContain('/route/v1/driving/');
      expect(fetchMock.mock.calls[0][0]).toContain('geometries=geojson');
      expect(routes[0].durationSeconds).toBe(300);
      expect(routes[0].distanceMeters).toBe(2000);
      expect(routes[0].coordinates[0]).toEqual([68.0, 25.0]);
      expect(routes[0].tag).toBe('Fastest');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('uses the alternate OSRM endpoint without waiting for a slow primary', async () => {
    const originalFetch = globalThis.fetch;
    const routePayload = {
      code: 'Ok',
      routes: [
        {
          geometry: {
            coordinates: [
              [68, 25],
              [68.01, 25.01],
            ],
          },
          distance: 2000,
          duration: 300,
          legs: [{ steps: [] }],
        },
      ],
    };
    const fetchMock = jest.fn().mockImplementation(
      (url: string, options?: RequestInit) => {
        if (url.includes('router.project-osrm.org')) {
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              const error = new Error('cancelled');
              error.name = 'AbortError';
              reject(error);
            });
          });
        }
        return Promise.resolve({
          ok: true,
          json: jest.fn().mockResolvedValue(routePayload),
        } as unknown as Response);
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const repository = new OSRMPlanRoutingRepository();
      const routes = await repository.getRouteAlternatives(
        25,
        68,
        25.01,
        68.01,
      );

      expect(routes).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1][0])).toContain(
        'routing.openstreetmap.de/routed-car',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('OSRM rejects an invalid or empty route payload', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        code: 'Ok',
        routes: [
          {
            geometry: { coordinates: [] },
            distance: 0,
            duration: 0,
          },
        ],
      }),
    }) as typeof fetch;

    try {
      const repository = new OSRMPlanRoutingRepository();
      await expect(
        repository.getRouteAlternatives(25, 68, 25.01, 68.01),
      ).rejects.toBeInstanceOf(InvalidRoutingResponseError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('normalization keeps route metrics paired while sorting alternatives', () => {
    const routes = normalizeAndSortRoutes([
      {
        coordinates: [
          [68, 25],
          [68.02, 25.02],
        ],
        distanceMeters: 2500,
        durationSeconds: 450,
        formattedDistance: '',
        formattedDuration: '',
        steps: [],
      },
      {
        coordinates: [
          [68, 25],
          [68.01, 25.01],
        ],
        distanceMeters: 1900,
        durationSeconds: 300,
        formattedDistance: '',
        formattedDuration: '',
        steps: [],
      },
    ]);

    expect(routes[0].coordinates[1]).toEqual([68.01, 25.01]);
    expect(routes[0].distanceMeters).toBe(1900);
    expect(routes[0].durationSeconds).toBe(300);
  });

  test('travel modes calculate separate duration estimates and preserve driving time', () => {
    const baseRoutes = normalizeAndSortRoutes([
      {
        coordinates: [
          [68, 25],
          [68.04, 25.04],
        ],
        distanceMeters: 5000,
        durationSeconds: 600,
        formattedDistance: '',
        formattedDuration: '',
        steps: [],
      },
    ]);

    const walking = applyTravelModeToRoutes(baseRoutes, 'walking');
    const motorbike = applyTravelModeToRoutes(walking, 'motorbike');
    const driving = applyTravelModeToRoutes(motorbike, 'driving');

    expect(walking[0].durationSeconds).toBe(3600);
    expect(motorbike[0].durationSeconds).toBeGreaterThan(600);
    expect(driving[0].durationSeconds).toBeGreaterThan(
      motorbike[0].durationSeconds,
    );
    expect(driving[0].drivingDurationSeconds).toBe(600);
  });

  test('car and bike ETAs correct optimistic free-flow time without changing walking', () => {
    const distanceMeters = 5000;
    const freeFlowSeconds = 600;

    expect(
      estimateTravelModeDuration(distanceMeters, freeFlowSeconds, 'walking'),
    ).toBe(3600);
    expect(
      estimateTravelModeDuration(distanceMeters, freeFlowSeconds, 'motorbike'),
    ).toBeGreaterThan(freeFlowSeconds);
    expect(
      estimateTravelModeDuration(distanceMeters, freeFlowSeconds, 'driving'),
    ).toBeGreaterThan(
      estimateTravelModeDuration(
        distanceMeters,
        freeFlowSeconds,
        'motorbike',
      ),
    );
  });

  test('offline routing explains when endpoints lack downloaded coverage', async () => {
    connectivityService.setMode('offline');
    try {
      await expect(
        routingService.getRouteAlternatives(24, 67, 24.1, 67.1),
      ).rejects.toBeInstanceOf(OfflineCoverageError);
    } finally {
      connectivityService.setMode('online');
    }
  });

  test('offline routing distinguishes map coverage from a missing routing graph', async () => {
    await offlineMapManager.initialize();
    const region = await offlineMapManager.createRegionAroundPoint({
      name: 'Offline Routing Test',
      center: { latitude: 25.2, longitude: 68.2 },
      radiusKm: 10,
    });
    await offlineMapManager.downloadRegion(region.id);
    connectivityService.setMode('offline');

    try {
      await expect(
        routingService.getRouteAlternatives(25.2, 68.2, 25.21, 68.21),
      ).rejects.toBeInstanceOf(OfflineRoutingUnavailableError);
    } finally {
      connectivityService.setMode('online');
      await offlineMapManager.deleteRegion(region.id);
    }
  });
});
