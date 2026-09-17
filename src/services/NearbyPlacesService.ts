import { NearbySearchParams, NearbyPlace } from '../types/places';
import {
  INearbyPlacesRepository,
  OverpassNearbyPlacesRepository,
  CATEGORY_MAP,
  matchesNearbyCategory,
} from '../repositories/NearbyPlacesRepository';
import {
  roadDistanceService,
  type DrivingDistanceProvider,
} from './RoadDistanceService';
import { connectivityService } from './connectivityService';
import {
  formatDistance,
  getHaversineDistance,
  isValidCoordinate,
} from '../utils/locationUtils';
import { isCallerAbort } from '../utils/networkUtils';
import { logger } from '../utils/logger';
import { LOCATION_CONFIG } from '../config/locationConfig';
import { getPlaceCategory } from '../config/placeCategories';
import { calculateRankingScore } from '../utils/rankingUtils';
import {
  areSamePlace,
  type OsmObjectType,
  type PlaceProvider,
} from '../utils/placeIdentity';

export { CATEGORY_MAP };

/** Recalculate display distances from the latest accepted GPS fix. */
export function recalculateNearbyDistances(
  places: NearbyPlace[],
  latitude: number,
  longitude: number,
): NearbyPlace[] {
  if (!isValidCoordinate(latitude, longitude, true)) return places;
  return places
    .map(place => {
      const distance = Math.round(
        getHaversineDistance(
          latitude,
          longitude,
          place.latitude,
          place.longitude,
        ),
      );
      const rankingScore = calculateRankingScore({
        title: place.name,
        subtitle: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        userLocation: { latitude, longitude },
        maxRadiusMeters:
          LOCATION_CONFIG.NEARBY_RADIUS_STEPS_METERS[
            LOCATION_CONFIG.NEARBY_RADIUS_STEPS_METERS.length - 1
          ],
        importance: place.importance,
        tags: place.providerTags,
        categoryMatched: true,
      });
      return {
        ...place,
        distance,
        formattedDistance: formatDistance(distance),
        rankingScore,
      };
    })
    .sort(
      (first, second) =>
        (second.rankingScore || 0) - (first.rankingScore || 0) ||
        first.distance - second.distance,
    );
}

interface NearbyFallbackSearchProvider {
  searchPlaces(
    query: string,
    options: {
      userLocation: { latitude: number; longitude: number };
      limit: number;
      radiusMeters: number;
      countryCode?: string;
      signal?: AbortSignal;
    },
  ): Promise<
    Array<{
      id: string | number;
      title: string;
      subtitle: string;
      latitude: number;
      longitude: number;
      categoryName?: string;
      raw?: unknown;
      source?: PlaceProvider;
      objectType?: OsmObjectType;
      objectId?: string | number;
      importance?: number;
    }>
  >;
}

function nearbyRadiusMeters(radius?: number): number {
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0
    ? Math.min(10000, Math.max(100, Math.round(radius * 1000)))
    : LOCATION_CONFIG.NEARBY_RADIUS_STEPS_METERS[
        LOCATION_CONFIG.NEARBY_RADIUS_STEPS_METERS.length - 1
      ];
}

export class NearbyPlacesService {
  private repository: INearbyPlacesRepository;
  private drivingDistanceProvider: DrivingDistanceProvider;
  private fallbackSearchProvider?: NearbyFallbackSearchProvider;

  constructor(
    repository?: INearbyPlacesRepository,
    drivingDistanceProvider?: DrivingDistanceProvider,
    fallbackSearchProvider?: NearbyFallbackSearchProvider,
  ) {
    this.repository = repository || new OverpassNearbyPlacesRepository();
    this.drivingDistanceProvider =
      drivingDistanceProvider || roadDistanceService;
    this.fallbackSearchProvider = fallbackSearchProvider;
  }

  public setRepository(repository: INearbyPlacesRepository) {
    this.repository = repository;
  }

  public setFallbackSearchProvider(provider: NearbyFallbackSearchProvider) {
    this.fallbackSearchProvider = provider;
  }

  public async searchNearby(
    params: NearbySearchParams,
    signal?: AbortSignal,
    onPartialResults?: (places: NearbyPlace[]) => void,
  ): Promise<NearbyPlace[]> {
    if (!isValidCoordinate(params.latitude, params.longitude, true)) {
      return [];
    }
    let places: NearbyPlace[] = [];
    let primarySucceeded = false;
    let primaryError: unknown;
    try {
      places = await this.repository.searchNearby(params, signal);
      primarySucceeded = true;
      if (places.length > 0) {
        onPartialResults?.(this.normalizePlaces(places, params));
      }
    } catch (error) {
      if (isCallerAbort(error, signal)) throw error;
      primaryError = error;
      logger.info(
        'NearbyPlacesService',
        'Primary nearby provider unavailable; trying the search fallback.',
        error,
      );
    }

    if (
      places.length === 0 &&
      this.fallbackSearchProvider &&
      connectivityService.getMode() !== 'offline'
    ) {
      try {
        const fallbackPlaces = await this.searchWithFallback(params, signal);
        if (fallbackPlaces.length > 0) {
          places = fallbackPlaces;
          onPartialResults?.(this.normalizePlaces(places, params));
        }
      } catch (fallbackError) {
        if (isCallerAbort(fallbackError, signal)) throw fallbackError;
        if (!primarySucceeded) {
          throw fallbackError || primaryError;
        }
        logger.debug(
          'NearbyPlacesService',
          'Fallback provider unavailable after an authoritative empty result.',
          fallbackError,
        );
      }
    } else if (!primarySucceeded && primaryError) {
      throw primaryError;
    }

    places = this.normalizePlaces(places, params);

    if (places.length === 0) {
      return places;
    }
    if (
      params.includeRoadDistance === false ||
      connectivityService.getMode() === 'offline'
    ) {
      return places;
    }

    try {
      const roadDistances =
        await this.drivingDistanceProvider.getDrivingDistances(
          { latitude: params.latitude, longitude: params.longitude },
          places.map(place => ({
            latitude: place.latitude,
            longitude: place.longitude,
          })),
          signal,
        );

      return places.map((place, index) => {
        const roadDistance = roadDistances[index];
        return typeof roadDistance === 'number'
          ? {
              ...place,
              roadDistance,
              formattedRoadDistance: formatDistance(roadDistance),
            }
          : place;
      });
    } catch (error) {
      if (isCallerAbort(error, signal)) throw error;
      logger.info(
        'NearbyPlacesService',
        'Road-distance enrichment failed; using current-GPS geodesic distance.',
        error,
      );
      return places;
    }
  }

  private normalizePlaces(
    places: NearbyPlace[],
    params: NearbySearchParams,
  ): NearbyPlace[] {
    // Recalculate direct distance at the service boundary. Repository caches
    // may be shared by nearby GPS grid cells, so their stored distance must
    // never be trusted as the current fix's distance.
    const uniquePlaces: NearbyPlace[] = [];
    for (const place of places) {
      if (
        !isValidCoordinate(place.latitude, place.longitude, true) ||
        typeof place.name !== 'string' ||
        place.name.trim().length === 0
      ) {
        continue;
      }
      const directDistance = Math.round(
        getHaversineDistance(
          params.latitude,
          params.longitude,
          place.latitude,
          place.longitude,
        ),
      );
      if (directDistance > nearbyRadiusMeters(params.radius)) continue;
      const duplicate = uniquePlaces.some(existing =>
        areSamePlace(existing, place),
      );
      if (!duplicate) {
        const rankingScore = calculateRankingScore({
          title: place.name,
          subtitle: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          userLocation: {
            latitude: params.latitude,
            longitude: params.longitude,
          },
          maxRadiusMeters: nearbyRadiusMeters(params.radius),
          importance: place.importance,
          tags: place.providerTags,
          categoryMatched: true,
        });
        uniquePlaces.push({
          ...place,
          name: place.name.trim(),
          address: typeof place.address === 'string' ? place.address.trim() : '',
          distance: directDistance,
          formattedDistance: formatDistance(directDistance),
          rankingScore,
        });
      }
    }
    return uniquePlaces
      .sort(
        (first, second) =>
          (second.rankingScore || 0) - (first.rankingScore || 0) ||
          first.distance - second.distance,
      )
      .slice(0, LOCATION_CONFIG.MAX_NEARBY_RESULTS);
  }

  private async searchWithFallback(
    params: NearbySearchParams,
    signal?: AbortSignal,
  ): Promise<NearbyPlace[]> {
    const categoryKey = params.category.trim().toLowerCase();
    const categoryDefinition = getPlaceCategory(categoryKey);
    if (!categoryDefinition) return [];
    const searchQueries = categoryDefinition.searchQueries;
    const radiusMeters = nearbyRadiusMeters(params.radius);
    const results: Awaited<
      ReturnType<NearbyFallbackSearchProvider['searchPlaces']>
    > = [];
    let successfulRequestCount = 0;
    let lastError: unknown;

    for (const query of searchQueries) {
      try {
        const group = await this.fallbackSearchProvider!.searchPlaces(query, {
            userLocation: {
              latitude: params.latitude,
              longitude: params.longitude,
            },
            limit: 20,
            radiusMeters,
            countryCode: params.countryCode,
            signal,
          });
        successfulRequestCount += 1;
        results.push(...group);
      } catch (error) {
        if (isCallerAbort(error, signal)) throw error;
        lastError = error;
        logger.debug(
          'NearbyPlacesService',
          `Category alias search failed for "${query}".`,
          error,
        );
      }
    }
    if (successfulRequestCount === 0) {
      throw lastError instanceof Error
        ? lastError
        : new Error('Nearby fallback provider is unavailable.');
    }

    return results
      .reduce<NearbyPlace[]>((places, result) => {
        const raw = result.raw && typeof result.raw === 'object'
          ? result.raw as Record<string, unknown>
          : {};
        const key = String(raw.osm_key || raw.class || '');
        const value = raw.osm_value || raw.type;
        if (!matchesNearbyCategory(categoryKey, { [key]: value })) {
          return places;
        }
        const providerTags = key && value
          ? { [key]: String(value) }
          : undefined;
        const directDistance = Math.round(
          getHaversineDistance(
            params.latitude,
            params.longitude,
            result.latitude,
            result.longitude,
          ),
        );
        if (directDistance > radiusMeters) return places;
        places.push({
          id: String(result.id),
          name: result.title,
          latitude: result.latitude,
          longitude: result.longitude,
          address: result.subtitle,
          category: categoryKey,
          distance: directDistance,
          formattedDistance: formatDistance(directDistance),
          source: result.source || 'photon',
          objectType: result.objectType,
          objectId: result.objectId,
          importance: result.importance,
          providerTags,
        });
        return places;
      }, [])
      .sort((first, second) => first.distance - second.distance)
      .slice(0, LOCATION_CONFIG.MAX_NEARBY_RESULTS);
  }
}

export const nearbyPlacesService = new NearbyPlacesService();
