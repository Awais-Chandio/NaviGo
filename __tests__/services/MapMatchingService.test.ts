import { mapMatchingService, GeometricMapMatchingProvider } from '../../src/services/MapMatchingService';

describe('MapMatchingService', () => {
  const mockRouteCoordinates: [number, number][] = [
    [68.3578, 25.3960], // Start
    [68.3590, 25.3970], // Mid
    [68.3610, 25.3990], // End
  ];

  it('snaps close GPS coordinates to the nearest route line segment', async () => {
    // Coordinate slightly off the first segment
    const rawLat = 25.3965;
    const rawLng = 68.3582;

    const matched = await mapMatchingService.snapToRoute(
      rawLat,
      rawLng,
      mockRouteCoordinates,
    );

    expect(matched).toBeDefined();
    expect(matched.confidence).toBeGreaterThan(0.5);
    expect(typeof matched.latitude).toBe('number');
    expect(typeof matched.longitude).toBe('number');
    expect(matched.roadName).toBeDefined();
  });

  it('returns confidence 0.0 and Off Route when distance exceeds snap threshold', async () => {
    // Coordinate far away from route (>500m)
    const farLat = 25.5000;
    const farLng = 68.5000;

    const matched = await mapMatchingService.snapToRoute(
      farLat,
      farLng,
      mockRouteCoordinates,
    );

    expect(matched.confidence).toBe(0);
    expect(matched.roadName).toBe('Off Route');
  });

  it('allows setting custom map matching providers', async () => {
    const provider = new GeometricMapMatchingProvider();
    mapMatchingService.setProvider(provider);

    const result = await mapMatchingService.snapToRoute(
      25.3960,
      68.3578,
      mockRouteCoordinates,
    );

    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('does not jump backward to a different route segment', async () => {
    const provider = new GeometricMapMatchingProvider();
    const route: [number, number][] = [
      [68.0, 25.0],
      [68.001, 25.0],
      [68.002, 25.0],
      [68.003, 25.0],
    ];
    const forward = await provider.match(
      25.0,
      68.0025,
      route,
      [],
      2,
      1000,
    );
    const noisyBackwardFix = await provider.match(
      25.0,
      68.0002,
      route,
      [],
      forward.segmentIndex,
      2000,
    );

    expect(noisyBackwardFix.segmentIndex).toBeGreaterThanOrEqual(
      forward.segmentIndex || 0,
    );
    expect(noisyBackwardFix.distanceAlongRoute).toBeGreaterThanOrEqual(
      forward.distanceAlongRoute || 0,
    );
  });
});
