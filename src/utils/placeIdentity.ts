export type PlaceProvider =
  | 'photon'
  | 'overpass'
  | 'nominatim'
  | 'offline';

export type OsmObjectType = 'node' | 'way' | 'relation';

export interface PlaceIdentityLike {
  id?: string | number;
  source?: PlaceProvider;
  objectType?: OsmObjectType;
  objectId?: string | number;
  latitude: number;
  longitude: number;
}

export function normalizeOsmObjectType(
  value: unknown,
): OsmObjectType | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'n' || normalized === 'node') return 'node';
  if (normalized === 'w' || normalized === 'way') return 'way';
  if (normalized === 'r' || normalized === 'relation') return 'relation';
  return undefined;
}

export function coordinatePlaceKey(
  latitude: number,
  longitude: number,
): string {
  return `${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
}

export function buildPlaceId(
  source: PlaceProvider,
  objectType: OsmObjectType | undefined,
  objectId: unknown,
  latitude: number,
  longitude: number,
): string {
  if (
    objectType &&
    (typeof objectId === 'string' || typeof objectId === 'number') &&
    String(objectId).trim()
  ) {
    return `${source}:${objectType}:${String(objectId).trim()}`;
  }
  return `${source}:coordinate:${coordinatePlaceKey(latitude, longitude)}`;
}

function providerObjectKey(place: PlaceIdentityLike): string | null {
  if (
    !place.source ||
    !place.objectType ||
    (typeof place.objectId !== 'string' && typeof place.objectId !== 'number')
  ) {
    return null;
  }
  const objectId = String(place.objectId).trim();
  return objectId
    ? `${place.source}:${place.objectType}:${objectId}`
    : null;
}

/**
 * Provider identity is authoritative. Coordinates are only a fallback when
 * one or both records do not expose a provider object identity.
 */
export function areSamePlace(
  first: PlaceIdentityLike,
  second: PlaceIdentityLike,
): boolean {
  const firstProviderKey = providerObjectKey(first);
  const secondProviderKey = providerObjectKey(second);
  if (firstProviderKey && secondProviderKey) {
    return firstProviderKey === secondProviderKey;
  }
  return (
    coordinatePlaceKey(first.latitude, first.longitude) ===
    coordinatePlaceKey(second.latitude, second.longitude)
  );
}
