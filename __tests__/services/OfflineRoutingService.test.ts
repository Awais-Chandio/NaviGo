import offlineRoutingService from '../../src/services/OfflineRoutingService';
import { offlineDatabaseService } from '../../src/services/OfflineDatabaseService';

describe('OfflineRoutingService', () => {
  beforeEach(async () => {
    await offlineDatabaseService.clearAllData();
  });

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

  it('follows installed real road edges instead of drawing a direct line', async () => {
    await offlineDatabaseService.insertRoutingGraph(
      'roads',
      [
        {
          id: 'a',
          regionId: 'roads',
          latitude: 25.396,
          longitude: 68.3578,
        },
        {
          id: 'b',
          regionId: 'roads',
          latitude: 25.397,
          longitude: 68.3578,
        },
        {
          id: 'c',
          regionId: 'roads',
          latitude: 25.397,
          longitude: 68.359,
        },
      ],
      [
        {
          id: 'ab',
          regionId: 'roads',
          startNodeId: 'a',
          endNodeId: 'b',
          startLat: 25.396,
          startLng: 68.3578,
          endLat: 25.397,
          endLng: 68.3578,
          distanceMeters: 111,
          weight: 111,
        },
        {
          id: 'bc',
          regionId: 'roads',
          startNodeId: 'b',
          endNodeId: 'c',
          startLat: 25.397,
          startLng: 68.3578,
          endLat: 25.397,
          endLng: 68.359,
          distanceMeters: 120,
          weight: 120,
        },
      ],
    );

    const route = await offlineRoutingService.calculateOfflineRoute(
      25.396,
      68.3578,
      25.397,
      68.359,
    );

    expect(route).not.toBeNull();
    expect(route?.coordinates).toContainEqual([68.3578, 25.397]);
    expect(route?.distanceMeters).toBeGreaterThan(200);
  });
});
