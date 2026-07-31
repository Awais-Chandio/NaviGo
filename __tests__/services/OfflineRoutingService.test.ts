import offlineRoutingService from '../../src/services/OfflineRoutingService';

describe('OfflineRoutingService', () => {
  it('reports unavailable instead of fabricating a straight-line driving route', async () => {
    const route = await offlineRoutingService.calculateOfflineRoute(
      25.396,
      68.3578,
      25.405,
      68.368,
    );

    expect(offlineRoutingService.isAvailable()).toBe(false);
    expect(route).toBeNull();
  });
});
