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
      return {
        ...place,
        distance,
        formattedDistance: formatDistance(distance),
      };
    })
    .sort((first, second) => first.distance - second.distance);
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
    }>
  >;
}

// Overpass is the more complete category source but is usually slower than
// Photon. Keep the fast partial list visible while allowing the full tagged
// result set enough time to arrive.
const PROVIDER_MERGE_GRACE_MS = 6500;

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
    let places: NearbyPlace[];
    let usedSearchFallback = false;
    if (
      this.fallbackSearchProvider &&
      connectivityService.getMode() !== 'offline'
    ) {
      const fastest = await this.searchFromFastestProvider(
        params,
        signal,
        partialPlaces => {
          onPartialResults?.(this.normalizePlaces(partialPlaces, params));
        },
      );
      places = fastest.places;
      usedSearchFallback = fastest.usedSearchFallback;
    } else {
      places = await this.repository.searchNearby(params, signal);
    }

    places = this.normalizePlaces(places, params);

    if (places.length === 0) {
      return places;
    }
    if (usedSearchFallback) {
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

      return places
        .map((place, index) => {
          const roadDistance = roadDistances[index];
          if (typeof roadDistance !== 'number') {
            return place;
          }
          return {
            ...place,
            distance: roadDistance,
            formattedDistance: formatDistance(roadDistance),
          };
        })
        .sort((first, second) => first.distance - second.distance);
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
      const normalizedName = place.name
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
      const duplicate = uniquePlaces.some(existing => {
        if (existing.id === place.id) return true;
        const existingName = existing.name
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim();
        return (
          existingName === normalizedName &&
          getHaversineDistance(
            existing.latitude,
            existing.longitude,
            place.latitude,
            place.longitude,
          ) < 100
        );
      });
      if (!duplicate) {
        uniquePlaces.push({
          ...place,
          name: place.name.trim(),
          address: typeof place.address === 'string' ? place.address.trim() : '',
          distance: directDistance,
          formattedDistance: formatDistance(directDistance),
        });
      }
    }
    return uniquePlaces
      .sort((first, second) => first.distance - second.distance)
      .slice(0, LOCATION_CONFIG.MAX_NEARBY_RESULTS);
  }

  private async searchFromFastestProvider(
    params: NearbySearchParams,
    signal?: AbortSignal,
    onPartialResults?: (places: NearbyPlace[]) => void,
  ): Promise<{ places: NearbyPlace[]; usedSearchFallback: boolean }> {
    type ProviderOutcome = {
      places?: NearbyPlace[];
      error?: unknown;
      usedSearchFallback: boolean;
    };

    const overpassController = new AbortController();
    const fallbackController = new AbortController();
    const abortChildren = () => {
      overpassController.abort();
      fallbackController.abort();
    };
    if (signal?.aborted) {
      abortChildren();
    } else {
      signal?.addEventListener('abort', abortChildren, { once: true });
    }

    const overpassTask: Promise<ProviderOutcome> = this.repository
      .searchNearby(params, overpassController.signal)
      .then(providerPlaces => ({
        places: providerPlaces,
        usedSearchFallback: false,
      }))
      .catch(error => ({ error, usedSearchFallback: false }));
    const fallbackTask: Promise<ProviderOutcome> = this.searchWithFallback(
      params,
      fallbackController.signal,
    )
      .then(providerPlaces => ({
        places: providerPlaces,
        usedSearchFallback: true,
      }))
      .catch(error => ({ error, usedSearchFallback: true }));

    try {
      const first = await Promise.race([overpassTask, fallbackTask]);
      if (signal?.aborted) {
        throw first.error || new Error('Nearby search was cancelled.');
      }
      if (first.places && first.places.length > 0) {
        onPartialResults?.(first.places);
      }

      const secondTask = first.usedSearchFallback
        ? overpassTask
        : fallbackTask;
      let mergeTimeout: ReturnType<typeof setTimeout> | undefined;
      const second = first.places?.length
        ? await Promise.race([
            secondTask,
            new Promise<ProviderOutcome>(resolve => {
              mergeTimeout = setTimeout(
                () =>
                  resolve({
                    error: new Error('Provider merge grace period elapsed.'),
                    usedSearchFallback: !first.usedSearchFallback,
                  }),
                PROVIDER_MERGE_GRACE_MS,
              );
            }),
          ])
        : await secondTask;
      if (mergeTimeout) clearTimeout(mergeTimeout);
      if (
        second.error instanceof Error &&
        second.error.message === 'Provider merge grace period elapsed.'
      ) {
        if (first.usedSearchFallback) {
          overpassController.abort();
        } else {
          fallbackController.abort();
        }
      }
      if (signal?.aborted) {
        throw second.error || first.error || new Error('Nearby search was cancelled.');
      }
      const mergedPlaces = [
        ...(first.places || []),
        ...(second.places || []),
      ];
      if (mergedPlaces.length > 0) {
        return {
          places: mergedPlaces,
          usedSearchFallback:
            (first.usedSearchFallback && Boolean(first.places?.length)) ||
            (second.usedSearchFallback && Boolean(second.places?.length)),
        };
      }
      if (first.places || second.places) {
        return {
          places: [],
          usedSearchFallback: second.usedSearchFallback,
        };
      }
      throw second.error || first.error || new Error('Nearby providers unavailable.');
    } finally {
      signal?.removeEventListener('abort', abortChildren);
    }
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
    const resultGroups = await Promise.all(
      searchQueries.map(async query => {
        try {
          return await this.fallbackSearchProvider!.searchPlaces(query, {
            userLocation: {
              latitude: params.latitude,
              longitude: params.longitude,
            },
            limit: 20,
            radiusMeters,
            countryCode: params.countryCode,
            signal,
          });
        } catch (error) {
          if (isCallerAbort(error, signal)) throw error;
          logger.debug(
            'NearbyPlacesService',
            `Category alias search failed for "${query}".`,
            error,
          );
          return [];
        }
      }),
    );
    const results = resultGroups.reduce<
      Awaited<ReturnType<NearbyFallbackSearchProvider['searchPlaces']>>
    >((allResults, group) => allResults.concat(group), []);

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
          id: `search_${String(result.id)}`,
          name: result.title,
          latitude: result.latitude,
          longitude: result.longitude,
          address: result.subtitle,
          category: categoryKey,
          distance: directDistance,
          formattedDistance: formatDistance(directDistance),
        });
        return places;
      }, [])
      .sort((first, second) => first.distance - second.distance)
      .slice(0, LOCATION_CONFIG.MAX_NEARBY_RESULTS);
  }
}

export const nearbyPlacesService = new NearbyPlacesService();
