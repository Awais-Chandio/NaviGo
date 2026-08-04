import { NearbySearchParams, NearbyPlace } from '../types/places';
import {
  INearbyPlacesRepository,
  OverpassNearbyPlacesRepository,
  CATEGORY_MAP,
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

export { CATEGORY_MAP };

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
    }>
  >;
}

const CATEGORY_FALLBACK_QUERIES: Record<string, string[]> = {
  food: ['restaurant', 'fast food', 'cafe'],
  restaurant: ['restaurant', 'fast food', 'cafe'],
  cafe: ['cafe', 'coffee shop'],
  atm: ['atm', 'bank'],
  bank: ['bank', 'atm'],
  fuel: ['fuel', 'petrol station', 'gas station'],
  petrol: ['petrol station', 'fuel', 'gas station'],
  hospital: ['hospital', 'clinic'],
  pharmacy: ['pharmacy', 'chemist'],
  hotel: ['hotel', 'guest house'],
  parking: ['parking', 'car parking'],
  shopping: ['shopping mall', 'supermarket', 'grocery store'],
  grocery: ['grocery store', 'supermarket', 'market'],
  supermarket: ['supermarket', 'shopping mall', 'grocery store'],
  school: ['school', 'academy'],
  university: ['university', 'college'],
};

const CATEGORY_MATCH_TERMS: Record<string, string[]> = {
  food: ['restaurant', 'food', 'cafe', 'bakery'],
  restaurant: ['restaurant', 'food', 'cafe', 'bakery'],
  cafe: ['cafe', 'coffee', 'restaurant'],
  atm: ['atm', 'bank'],
  bank: ['bank', 'atm'],
  fuel: ['fuel', 'gas station', 'petrol', 'cng'],
  petrol: ['fuel', 'gas station', 'petrol', 'cng'],
  hospital: ['hospital', 'clinic', 'medical'],
  pharmacy: ['pharmacy', 'chemist', 'drugstore'],
  hotel: ['hotel', 'hostel', 'lodging', 'guest house'],
  parking: ['parking'],
  shopping: ['shopping', 'supermarket', 'mall', 'market', 'grocery', 'store'],
  grocery: ['shopping', 'supermarket', 'market', 'grocery', 'store'],
  supermarket: ['shopping', 'supermarket', 'mall', 'market', 'grocery', 'store'],
  school: ['school', 'academy', 'education'],
  university: ['university', 'college', 'campus'],
};
const PROVIDER_MERGE_GRACE_MS = 1500;

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
    if (this.fallbackSearchProvider && connectivityService.isOnlineMode()) {
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
      !connectivityService.isOnlineMode()
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
    const searchQuery = CATEGORY_MAP[categoryKey]?.osmQuery || categoryKey;
    const searchQueries = CATEGORY_FALLBACK_QUERIES[categoryKey] || [searchQuery];
    const maxDynamicRadiusMeters =
      LOCATION_CONFIG.NEARBY_RADIUS_STEPS_METERS[
        LOCATION_CONFIG.NEARBY_RADIUS_STEPS_METERS.length - 1
      ];
    const radiusMeters = Math.max(
      maxDynamicRadiusMeters,
      Math.round((params.radius ?? 10) * 1000),
    );
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
        const resultText = `${result.title} ${result.categoryName || ''}`.toLocaleLowerCase();
        if (
          !(CATEGORY_MATCH_TERMS[categoryKey] || [searchQuery]).some(term =>
            resultText.includes(term),
          )
        ) {
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
