import { storageService } from '../../src/services/storageService';

describe('StorageService recent searches', () => {
  beforeEach(async () => {
    await storageService.initialize();
    storageService.clearRecentSearches();
  });

  it('strips stale distances and deduplicates provider IDs by place identity', () => {
    storageService.addRecentSearch({
      id: 'provider-a',
      title: 'City Cafe',
      subtitle: 'Main Road',
      latitude: 25.396,
      longitude: 68.3578,
      displayName: 'City Cafe, Main Road',
      distanceMeters: 9000,
      formattedDistance: '9.0 km',
    });
    const recents = storageService.addRecentSearch({
      id: 'provider-b',
      title: 'City-Cafe',
      subtitle: 'Main Road',
      latitude: 25.39601,
      longitude: 68.35781,
      displayName: 'City-Cafe, Main Road',
    });

    expect(recents).toHaveLength(1);
    expect(recents[0].id).toBe('provider-b');
    expect(recents[0].distanceMeters).toBeUndefined();
    expect(recents[0].formattedDistance).toBeUndefined();
  });

  it('rejects invalid recent-search coordinates', () => {
    const recents = storageService.addRecentSearch({
      id: 'invalid',
      title: 'Invalid Place',
      subtitle: 'Missing location',
      latitude: 0,
      longitude: 0,
      displayName: 'Invalid Place',
    });

    expect(recents).toEqual([]);
  });
});
