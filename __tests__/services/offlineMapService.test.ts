import {
  DuplicateOfflineRegionError,
  OFFLINE_REGION_METADATA_VERSION,
  OfflineMapManager,
  offlineMapService,
  isTransientOfflineDownloadError,
} from '../../src/services/offlineMapService';
import { getHaversineDistance } from '../../src/utils/locationUtils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineManager } from '@maplibre/maplibre-react-native';

describe('OfflineMapService', () => {
  it('only retries transient native download failures', () => {
    expect(isTransientOfflineDownloadError({ message: 'timeout' })).toBe(true);
    expect(
      isTransientOfflineDownloadError({ message: 'Network connection lost' }),
    ).toBe(true);
    expect(
      isTransientOfflineDownloadError({ message: 'Invalid style definition' }),
    ).toBe(false);
  });

  it('creates an offline region pack with proper bounding box and estimated size', async () => {
    const bounds = {
      minLat: 25.31,
      maxLat: 25.47,
      minLng: 68.27,
      maxLng: 68.43,
    };

    const region = await offlineMapService.createRegion(
      'Test Region',
      bounds,
      10,
      16,
    );

    expect(region.id).toBeDefined();
    expect(region.name).toBe('Test Region');
    expect(region.bounds).toEqual(bounds);
    expect(region.center).toEqual({
      latitude: (bounds.minLat + bounds.maxLat) / 2,
      longitude: (bounds.minLng + bounds.maxLng) / 2,
    });
    expect(region.radiusKm).toBeGreaterThan(0);
    expect(region.coverageAreaKm2).toBeCloseTo(
      Math.PI * region.radiusKm ** 2,
      6,
    );
    expect(region.version).toBe(OFFLINE_REGION_METADATA_VERSION);
    expect(region.isDownloaded).toBe(false);
    expect(region.sizeBytes).toBeGreaterThan(0);
  });

  it('downloads region pack and tracks storage usage', async () => {
    const regions = offlineMapService.getRegions();
    expect(Array.isArray(regions)).toBe(true);

    if (regions.length > 0) {
      const regionId = regions[0].id;
      let progressReported = false;

      await offlineMapService.startDownload(regionId, progress => {
        progressReported = true;
        expect(progress.percentage).toBeGreaterThanOrEqual(0);
      });

      expect(progressReported).toBe(true);

      const usage = offlineMapService.getStorageUsage();
      expect(usage.regionCount).toBeGreaterThanOrEqual(1);
      const downloadedRegion = offlineMapService.getRegion(regionId);
      expect(downloadedRegion?.status).toBe('completed');
      expect(downloadedRegion?.downloadedAt).toBeDefined();
    }
  });

  it('deletes an offline region gracefully without throwing errors even if missing natively', async () => {
    const bounds = {
      minLat: 25.35,
      maxLat: 25.4,
      minLng: 68.3,
      maxLng: 68.35,
    };

    const region = await offlineMapService.createRegion(
      'Region To Delete',
      bounds,
      10,
      16,
    );
    expect(offlineMapService.getRegions().some(r => r.id === region.id)).toBe(
      true,
    );

    await expect(
      offlineMapService.deleteRegion(region.id),
    ).resolves.not.toThrow();
    expect(offlineMapService.getRegions().some(r => r.id === region.id)).toBe(
      false,
    );
  });
});

describe('OfflineMapManager coverage contract', () => {
  afterEach(() => {
    jest
      .mocked(AsyncStorage.setItem)
      .mockImplementation(() => Promise.resolve());
    jest
      .mocked(AsyncStorage.getItem)
      .mockImplementation(() => Promise.resolve(null));
    jest
      .mocked(OfflineManager.getPacks)
      .mockImplementation(() => Promise.resolve([]));
  });

  it('keeps completed downloads valid when native pack restore temporarily fails', async () => {
    const center = { latitude: 25.396, longitude: 68.3578 };
    const seedManager = new OfflineMapManager();
    const bounds = seedManager.getBoundsForCoverage(center, 10);
    jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(
      JSON.stringify([
        {
          id: 'persisted-region',
          nativePackId: 'native-pack',
          name: 'Persisted Hyderabad',
          center,
          radiusKm: 10,
          bounds,
          minZoom: 10,
          maxZoom: 16,
          version: OFFLINE_REGION_METADATA_VERSION,
          status: 'completed',
          isDownloaded: true,
          sizeBytes: 1024,
          estimatedTileCount: 10,
          downloadedTileCount: 10,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ]),
    );
    jest
      .mocked(OfflineManager.getPacks)
      .mockRejectedValueOnce(new Error('native database still opening'));

    const manager = new OfflineMapManager();
    await manager.initialize();

    expect(manager.getRegion('persisted-region')).toMatchObject({
      status: 'completed',
      isDownloaded: true,
      nativePackId: 'native-pack',
    });
  });

  it('recovers a completed download from native metadata after an app restart', async () => {
    const center = { latitude: 25.396, longitude: 68.3578 };
    const seedManager = new OfflineMapManager();
    const bounds = seedManager.getBoundsForCoverage(center, 10);
    jest.mocked(OfflineManager.getPacks).mockResolvedValueOnce([
      {
        id: 'recovered-native-pack',
        bounds: [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat],
        metadata: {
          id: 'recovered-region',
          name: 'Recovered Hyderabad',
          version: OFFLINE_REGION_METADATA_VERSION,
          center,
          radiusKm: 10,
          minZoom: 10,
          maxZoom: 16,
        },
        status: jest.fn().mockResolvedValue({
          state: 'complete',
          completedTileCount: 50,
          completedResourceSize: 2048,
        }),
      } as never,
    ]);

    const manager = new OfflineMapManager();
    await manager.initialize();

    expect(manager.getRegion('recovered-region')).toMatchObject({
      nativePackId: 'recovered-native-pack',
      status: 'completed',
      isDownloaded: true,
      bounds,
      downloadedTileCount: 50,
      sizeBytes: 2048,
    });
  });

  it('uses one exact radius for metadata, native bounds, area, and map geometry', async () => {
    const manager = new OfflineMapManager();
    const center = { latitude: 25.396, longitude: 68.3578 };
    const region = await manager.createRegionAroundPoint({
      name: 'Hyderabad - Qasimabad',
      center,
      radiusKm: 10,
    });

    expect(region.radiusKm).toBe(10);
    expect(region.coverageAreaKm2).toBeCloseTo(Math.PI * 100, 8);
    expect(region.bounds).toEqual(
      manager.getBoundsForCoverage(center, region.radiusKm),
    );
    const packDefinition = manager.getPackDefinition(region);
    expect(packDefinition.bounds).toEqual([
      region.bounds.minLng,
      region.bounds.minLat,
      region.bounds.maxLng,
      region.bounds.maxLat,
    ]);
    expect(packDefinition.metadata).toMatchObject({
      id: region.id,
      center,
      radiusKm: 10,
      coverageAreaKm2: region.coverageAreaKm2,
    });

    const feature = manager.getCoverageFeature(region);
    const ring = feature.geometry.coordinates[0];
    const latitudes = ring.map(coordinate => coordinate[1]);
    const longitudes = ring.map(coordinate => coordinate[0]);
    expect(Math.max(...latitudes)).toBeLessThanOrEqual(region.bounds.maxLat);
    expect(Math.min(...latitudes)).toBeGreaterThanOrEqual(region.bounds.minLat);
    expect(Math.max(...longitudes)).toBeLessThanOrEqual(region.bounds.maxLng);
    expect(Math.min(...longitudes)).toBeGreaterThanOrEqual(
      region.bounds.minLng,
    );
    expect(
      getHaversineDistance(
        center.latitude,
        center.longitude,
        ring[0][1],
        ring[0][0],
      ),
    ).toBeCloseTo(10000, 3);
  });

  it('estimates a city download from the same bounds used by its pack', () => {
    const manager = new OfflineMapManager();
    const center = { latitude: 25.396, longitude: 68.3578 };
    const estimate = manager.estimateRegionDownload(center, 25, 9, 16);

    expect(estimate.bounds).toEqual(manager.getBoundsForCoverage(center, 25));
    expect(estimate.estimatedTileCount).toBeGreaterThan(0);
    expect(estimate.estimatedSizeBytes).toBeGreaterThan(5 * 1024 * 1024);
  });

  it('prevents duplicate regions with the same radius and nearby center', async () => {
    const manager = new OfflineMapManager();
    await manager.createRegionAroundPoint({
      name: 'Original Area',
      center: { latitude: 25.5, longitude: 68.5 },
      radiusKm: 10,
    });

    await expect(
      manager.createRegionAroundPoint({
        name: 'Duplicate Area',
        center: { latitude: 25.501, longitude: 68.5 },
        radiusKm: 10,
      }),
    ).rejects.toBeInstanceOf(DuplicateOfflineRegionError);
    expect(manager.getRegions()).toHaveLength(1);
  });

  it('detects current-location coverage only after download completes', async () => {
    const manager = new OfflineMapManager();
    const center = { latitude: 25.65, longitude: 68.65 };
    const region = await manager.createRegionAroundPoint({
      name: 'Coverage Area',
      center,
      radiusKm: 10,
    });

    expect(manager.isLocationAvailableOffline(center)).toBe(false);
    await manager.downloadRegion(region.id);
    expect(manager.isLocationAvailableOffline(center)).toBe(true);
    expect(
      manager.isLocationAvailableOffline({
        latitude: 25.8,
        longitude: 68.65,
      }),
    ).toBe(false);
  });

  it('recognizes the complete rectangular area downloaded by MapLibre', async () => {
    const manager = new OfflineMapManager();
    const center = { latitude: 25.65, longitude: 68.65 };
    const region = await manager.createRegionAroundPoint({
      name: 'Downloaded Bounds',
      center,
      radiusKm: 10,
    });
    const downloadedCorner = {
      latitude: region.bounds.maxLat - 0.000001,
      longitude: region.bounds.maxLng - 0.000001,
    };

    expect(manager.isPointInsideRegion(downloadedCorner, region)).toBe(false);
    expect(
      manager.isPointInsideDownloadedBounds(downloadedCorner, region),
    ).toBe(true);
  });

  it('validates origin, destination, and every sampled route section', async () => {
    const manager = new OfflineMapManager();
    const center = { latitude: 25.8, longitude: 68.8 };
    const region = await manager.createRegionAroundPoint({
      name: 'Navigation Coverage',
      center,
      radiusKm: 10,
    });
    await manager.downloadRegion(region.id);

    const destination = { latitude: 25.82, longitude: 68.82 };
    const valid = manager.validateNavigationCoverage(center, destination, [
      [center.longitude, center.latitude],
      [destination.longitude, destination.latitude],
    ]);
    expect(valid).toMatchObject({
      isValid: true,
      originCovered: true,
      destinationCovered: true,
      routeCovered: true,
    });

    const uncoveredDestination = manager.validateNavigationCoverage(center, {
      latitude: 26.1,
      longitude: 68.8,
    });
    expect(uncoveredDestination.destinationCovered).toBe(false);
    expect(uncoveredDestination.message).toContain('destination is outside');

    const routeLeavesCoverage = manager.validateNavigationCoverage(
      center,
      destination,
      [
        [center.longitude, center.latitude],
        [69.1, 26.1],
        [destination.longitude, destination.latitude],
      ],
    );
    expect(routeLeavesCoverage.originCovered).toBe(true);
    expect(routeLeavesCoverage.destinationCovered).toBe(true);
    expect(routeLeavesCoverage.routeCovered).toBe(false);
    expect(routeLeavesCoverage.message).toContain('part of the planned route');
  });

  it('serializes overlapping metadata writes so a stale snapshot cannot win', async () => {
    const manager = new OfflineMapManager();
    await manager.initialize();
    const writes: string[] = [];
    let activeWrites = 0;
    let maximumConcurrentWrites = 0;

    jest
      .mocked(AsyncStorage.setItem)
      .mockImplementation(async (_key, value) => {
        activeWrites += 1;
        maximumConcurrentWrites = Math.max(
          maximumConcurrentWrites,
          activeWrites,
        );
        await Promise.resolve();
        writes.push(value);
        activeWrites -= 1;
      });

    await Promise.all([
      manager.createRegionAroundPoint({
        name: 'Concurrent A',
        center: { latitude: 26.0, longitude: 69.0 },
        radiusKm: 5,
      }),
      manager.createRegionAroundPoint({
        name: 'Concurrent B',
        center: { latitude: 26.2, longitude: 69.2 },
        radiusKm: 5,
      }),
    ]);

    expect(maximumConcurrentWrites).toBe(1);
    expect(JSON.parse(writes[writes.length - 1] ?? '[]')).toHaveLength(2);
  });

  it('rolls back a new region when its metadata cannot be saved', async () => {
    const manager = new OfflineMapManager();
    await manager.initialize();
    jest
      .mocked(AsyncStorage.setItem)
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      manager.createRegionAroundPoint({
        name: 'Cannot Persist',
        center: { latitude: 26.4, longitude: 69.4 },
        radiusKm: 5,
      }),
    ).rejects.toThrow('Unable to save the offline region');
    expect(manager.getRegions()).toHaveLength(0);
  });
});
