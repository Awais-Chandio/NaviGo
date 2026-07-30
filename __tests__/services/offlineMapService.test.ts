import { offlineMapService } from '../../src/services/offlineMapService';

describe('OfflineMapService', () => {
  it('creates an offline region pack with proper bounding box and estimated size', async () => {
    const bounds = {
      minLat: 25.31,
      maxLat: 25.47,
      minLng: 68.27,
      maxLng: 68.43,
    };

    const region = await offlineMapService.createRegion('Test Region', bounds, 10, 16);

    expect(region.id).toBeDefined();
    expect(region.name).toBe('Test Region');
    expect(region.bounds).toEqual(bounds);
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
    }
  });

  it('deletes an offline region gracefully without throwing errors even if missing natively', async () => {
    const bounds = {
      minLat: 25.35,
      maxLat: 25.40,
      minLng: 68.30,
      maxLng: 68.35,
    };

    const region = await offlineMapService.createRegion('Region To Delete', bounds, 10, 16);
    expect(offlineMapService.getRegions().some(r => r.id === region.id)).toBe(true);

    await expect(offlineMapService.deleteRegion(region.id)).resolves.not.toThrow();
    expect(offlineMapService.getRegions().some(r => r.id === region.id)).toBe(false);
  });
});
