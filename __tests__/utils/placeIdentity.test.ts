import {
  areSamePlace,
  buildPlaceId,
  normalizeOsmObjectType,
} from '../../src/utils/placeIdentity';

describe('place identity', () => {
  it('normalizes Photon and Overpass OSM object types', () => {
    expect(normalizeOsmObjectType('N')).toBe('node');
    expect(normalizeOsmObjectType('way')).toBe('way');
    expect(normalizeOsmObjectType('R')).toBe('relation');
    expect(normalizeOsmObjectType('area')).toBeUndefined();
  });

  it('builds provider, object-type, and object-id keys', () => {
    expect(buildPlaceId('photon', 'way', 123, 25.396, 68.3578)).toBe(
      'photon:way:123',
    );
  });

  it('does not merge different authoritative objects at nearby coordinates', () => {
    expect(
      areSamePlace(
        {
          source: 'photon',
          objectType: 'node',
          objectId: 42,
          latitude: 25.396,
          longitude: 68.3578,
        },
        {
          source: 'photon',
          objectType: 'way',
          objectId: 42,
          latitude: 25.396,
          longitude: 68.3578,
        },
      ),
    ).toBe(false);
  });

  it('uses a stable coordinate key only when provider identity is unavailable', () => {
    expect(
      areSamePlace(
        { latitude: 25.396001, longitude: 68.357801 },
        { latitude: 25.396002, longitude: 68.357802 },
      ),
    ).toBe(true);
    expect(buildPlaceId('offline', undefined, undefined, 25.396, 68.3578)).toBe(
      'offline:coordinate:25.39600:68.35780',
    );
  });
});
