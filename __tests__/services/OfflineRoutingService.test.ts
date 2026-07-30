import offlineRoutingService from '../../src/services/OfflineRoutingService';

describe('OfflineRoutingService', () => {
  it('calculates offline route with distance, duration, polyline coordinates, and steps', async () => {
    const route = await offlineRoutingService.calculateOfflineRoute(
      25.396,
      68.3578,
      25.405,
      68.368,
    );

    expect(route).toBeDefined();
    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(route.durationSeconds).toBeGreaterThan(0);
    expect(route.coordinates.length).toBeGreaterThan(2);
    expect(route.steps.length).toBeGreaterThan(0);
  });
});
