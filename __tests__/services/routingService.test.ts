import {
  normalizeAndSortRoutes,
  parseOSRMSteps,
} from '../../src/services/routingService';
import {
  InvalidRoutingResponseError,
  OSRMPlanRoutingRepository,
} from '../../src/repositories/RoutingRepository';

describe('routingService', () => {
  test('parseOSRMSteps converts raw OSRM steps into user instructions', () => {
    const rawSteps: any[] = [
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
});
