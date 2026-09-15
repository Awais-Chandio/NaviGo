import { NearbySearchParams, NearbyPlace } from '../types/places';
import {
  getHaversineDistance,
  formatDistance,
  isValidCoordinate,
} from '../utils/locationUtils';
import { connectivityService } from '../services/connectivityService';
import { LOCATION_CONFIG } from '../config/locationConfig';
import { logger } from '../utils/logger';
import { fetchWithTimeout, isCallerAbort } from '../utils/networkUtils';
import { offlineDatabaseService } from '../services/OfflineDatabaseService';
import {
  getPlaceCategory,
  matchesPlaceCategory,
  PLACE_CATEGORIES,
} from '../config/placeCategories';

const TAG = 'NearbyPlacesService';
const MAX_NEARBY_CACHE_ENTRIES = 50;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export interface CategoryQueryConfig {
  osmQuery: string;
  overpassFilters: string[];
}

export const CATEGORY_MAP: Record<string, CategoryQueryConfig> =
  PLACE_CATEGORIES.reduce<Record<string, CategoryQueryConfig>>(
    (categoryMap, definition) => {
      const config = {
        osmQuery: definition.searchQueries[0],
        overpassFilters: Object.entries(definition.osmTags).map(
          ([key, values]) =>
            `nwr["${key}"~"^(${values.join('|')})$"]`,
        ),
      };
      for (const key of [definition.id, ...(definition.aliases || [])]) {
        categoryMap[key] = config;
      }
      return categoryMap;
    },
    {},
  );

/** Match provider tags against the same category rules used for nearby queries. */
export function matchesNearbyCategory(
  category: string,
  tags: Record<string, unknown>,
): boolean {
  return matchesPlaceCategory(category, tags);
}

export interface INearbyPlacesRepository {
  searchNearby(
    params: NearbySearchParams,
    signal?: AbortSignal,
  ): Promise<NearbyPlace[]>;
}

interface CacheEntry {
  timestamp: number;
  results: NearbyPlace[];
}

function removeProximityDuplicates(places: NearbyPlace[]): NearbyPlace[] {
  const unique: NearbyPlace[] = [];

  for (const place of places) {
    const isDuplicate = unique.some(existing => {
      if (existing.id === place.id) return true;

      const dist = getHaversineDistance(
        existing.latitude,
        existing.longitude,
        place.latitude,
        place.longitude,
      );

      const normalizeName = (value: string) =>
        value
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim();
      const nameMatch =
        normalizeName(existing.name) === normalizeName(place.name);
      return nameMatch && dist < 100;
    });

    if (!isDuplicate) {
      unique.push(place);
    }
  }

  return unique;
}

export class OverpassNearbyPlacesRepository implements INearbyPlacesRepository {
  private cache: Map<string, CacheEntry> = new Map();
  private pendingRequests: Map<string, Promise<NearbyPlace[]>> = new Map();
  private CACHE_TTL_MS = 60 * 1000; // 60 seconds cache TTL requirement

  private getCacheKey(
    category: string,
    lat: number,
    lon: number,
    radiusMeters: number,
  ): string {
    // Keep cache keys stable across normal GPS jitter. Display distances are
    // recalculated from the latest fix by NearbyPlacesService.
    const latGrid = lat.toFixed(3);
    const lonGrid = lon.toFixed(3);
    return `${category.toLowerCase()}_${latGrid}_${lonGrid}_${radiusMeters}`;
  }

  public async searchNearby(
    params: NearbySearchParams,
    signal?: AbortSignal,
  ): Promise<NearbyPlace[]> {
    const { latitude, longitude } = params;
    const category = params.category.trim().toLowerCase();

    // 1. Verify GPS coordinates
    if (!isValidCoordinate(latitude, longitude, true)) {
      logger.info(TAG, 'Search skipped: Invalid or missing GPS coordinates.');
      return [];
    }
    if (!getPlaceCategory(category)) {
      logger.warn(TAG, `Unsupported nearby category: ${category}`);
      return [];
    }

    const requestedRadiusMeters =
      typeof params.radius === 'number' &&
      Number.isFinite(params.radius) &&
      params.radius > 0
        ? Math.min(10000, Math.max(100, Math.round(params.radius * 1000)))
        : null;
    const widestNearbyRadius =
      LOCATION_CONFIG.NEARBY_RADIUS_STEPS_METERS[
        LOCATION_CONFIG.NEARBY_RADIUS_STEPS_METERS.length - 1
      ];
    const radiusStepsMeters = [requestedRadiusMeters || widestNearbyRadius];
    const cacheKey = this.getCacheKey(
      category,
      latitude,
      longitude,
      radiusStepsMeters[radiusStepsMeters.length - 1],
    );

    // 2. Check 60s Memory Cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.results.map(place => {
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
      });
    }
    if (cached) {
      this.cache.delete(cacheKey);
    }

    // 3. In-flight request deduplication
    if (!signal && this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    const fetchPromise = (async () => {
      const startedAt = Date.now();
      try {
        if (connectivityService.getMode() === 'offline') {
          logger.info(TAG, `Offline mode detected: querying local SQLite POI database for category "${category}".`);
          const offlinePois = await offlineDatabaseService.getPOIsByCategory(
            category,
            latitude,
            longitude,
            radiusStepsMeters[radiusStepsMeters.length - 1] / 1000,
          );
          const results: NearbyPlace[] = offlinePois.map(poi => {
            const distance = Math.round(
              getHaversineDistance(
                latitude,
                longitude,
                poi.latitude,
                poi.longitude,
              ),
            );
            return {
              id: poi.id,
              name: poi.name,
              latitude: poi.latitude,
              longitude: poi.longitude,
              address: poi.address,
              category: poi.category,
              distance,
              formattedDistance: formatDistance(distance),
            };
          });
          results.sort((a, b) => a.distance - b.distance);
          return results;
        }

        for (const currentRadiusMeters of radiusStepsMeters) {
          logger.info(
            TAG,
            `[GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(
              5,
            )}] Radius: ${currentRadiusMeters}m | API used: Overpass API | Searching nearby "${category}"...`,
          );

          // Try Overpass primary search
          const results = await this.searchOverpass(
            latitude,
            longitude,
            category,
            currentRadiusMeters,
            signal,
          );

          if (results.length > 0) {
            // Strictly sort by actual distance from current GPS using Haversine (nearest first)
            results.sort((a, b) => a.distance - b.distance);

            // Cap at top 20 high-quality results
            const top20Results = results.slice(
              0,
              LOCATION_CONFIG.MAX_NEARBY_RESULTS || 20,
            );

            // Log returned results details
            logger.info(
              TAG,
              `Radius: ${currentRadiusMeters}m | API: Overpass | Returned ${top20Results.length} results`,
            );
            top20Results.forEach((r, idx) => {
              logger.debug(TAG, `${idx + 1}. ${r.name} - ${r.distance}m`);
            });

            if (
              !this.cache.has(cacheKey) &&
              this.cache.size >= MAX_NEARBY_CACHE_ENTRIES
            ) {
              const oldestKey = this.cache.keys().next().value;
              if (typeof oldestKey === 'string') {
                this.cache.delete(oldestKey);
              }
            }
            this.cache.set(cacheKey, {
              timestamp: Date.now(),
              results: top20Results,
            });
            return top20Results;
          }
        }

        logger.info(
          TAG,
          `No ${category} places found within ${
            radiusStepsMeters[radiusStepsMeters.length - 1]
          }m`,
        );
        if (!this.cache.has(cacheKey) && this.cache.size >= MAX_NEARBY_CACHE_ENTRIES) {
          const oldestKey = this.cache.keys().next().value;
          if (typeof oldestKey === 'string') this.cache.delete(oldestKey);
        }
        this.cache.set(cacheKey, { timestamp: Date.now(), results: [] });
        return [];
      } finally {
        this.pendingRequests.delete(cacheKey);
        logger.performance(TAG, 'overpass.nearby', startedAt, {
          category,
        });
      }
    })();

    if (!signal) {
      this.pendingRequests.set(cacheKey, fetchPromise);
    }
    return fetchPromise;
  }

  private async searchOverpass(
    latitude: number,
    longitude: number,
    category: string,
    radiusMeters: number,
    signal?: AbortSignal,
  ): Promise<NearbyPlace[]> {
    const categoryKey = category.toLowerCase();
    const config = CATEGORY_MAP[categoryKey];
    const filters = config?.overpassFilters || [];

    // Overpass QL query with strict around(radius,lat,lon) filtering
    const queryStatements = filters
      .map(f => `${f}(around:${radiusMeters},${latitude},${longitude});`)
      .join(' ');

    const query = `[out:json][timeout:8]; (${queryStatements}); out center qt 200;`;
    const requestEndpoint = async (baseUrl: string): Promise<NearbyPlace[]> => {
      try {
        const url = `${baseUrl}?data=${encodeURIComponent(query)}`;
        const response = await fetchWithTimeout(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
          },
          signal,
          timeoutMs: 5000,
        });

        if (!response.ok) {
          throw new Error(
            `Overpass server unavailable (HTTP ${response.status}).`,
          );
        }

        const data = (await response.json()) as {
          elements?: Record<string, unknown>[];
        };
        const elements = Array.isArray(data?.elements) ? data.elements : [];

        const places: NearbyPlace[] = [];

        for (let index = 0; index < elements.length; index++) {
          const element = elements[index];
          const centerObj = element.center as
            | { lat?: number; lon?: number }
            | undefined;
          const lat = parseFloat(String(element.lat ?? centerObj?.lat ?? 0));
          const lon = parseFloat(String(element.lon ?? centerObj?.lon ?? 0));

          // Ignore invalid coordinates
          if (!isValidCoordinate(lat, lon, true)) continue;

          // Calculate distance using Haversine formula
          const distMeters = Math.round(
            getHaversineDistance(latitude, longitude, lat, lon),
          );

          // Strict radius check: Ignore places outside requested radius
          if (distMeters > radiusMeters) {
            continue;
          }

          const tags = (element.tags as Record<string, string>) || {};
          if (!matchesNearbyCategory(category, tags)) continue;
          const rawName =
            tags['name:en'] || tags.name || tags.brand || tags.operator;

          // A place with no usable name is still a real, useful result (an
          // unmarked ATM or parking entrance, for example). Give it an honest
          // category-based label instead of inventing a name or dropping a
          // valid POI outright; only literal provider junk text is replaced.
          const isUsableName =
            !!rawName &&
            rawName.trim().length > 0 &&
            !rawName.toLowerCase().includes('spot') &&
            !rawName.toLowerCase().includes('unknown place') &&
            rawName.toLowerCase() !== 'unnamed';
          const name = isUsableName
            ? rawName
            : `Unnamed ${getPlaceCategory(category)?.title || category}`;

          const streetAddress = [
            tags['addr:housenumber'],
            tags['addr:street'],
          ]
            .filter(Boolean)
            .join(' ');
          const addressParts = [
            streetAddress,
            tags['addr:neighbourhood'],
            tags['addr:suburb'],
            tags['addr:district'],
            tags['addr:city'],
          ].filter((part, partIndex, allParts) =>
            Boolean(part) && allParts.indexOf(part) === partIndex,
          );

          const address = tags['addr:full'] || addressParts.join(', ');

          places.push({
            id: `overpass_${String(element.type || 'element')}_${
              element.id || index
            }`,
            name,
            latitude: lat,
            longitude: lon,
            address,
            category,
            distance: distMeters,
            formattedDistance: formatDistance(distMeters),
          });
        }

        const cleanPlaces = removeProximityDuplicates(places);
        cleanPlaces.sort((a, b) => a.distance - b.distance);
        return cleanPlaces.slice(0, LOCATION_CONFIG.MAX_NEARBY_RESULTS || 20);
      } catch (err) {
        if (isCallerAbort(err, signal)) {
          throw err;
        }
        throw err instanceof Error
          ? err
          : new Error('Overpass request failed.');
      }
    };

    return new Promise<NearbyPlace[]>((resolve, reject) => {
      let remaining = OVERPASS_ENDPOINTS.length;
      let lastError: Error | null = null;
      let receivedEmptyResponse = false;
      let settled = false;

      const finishEmptyOrError = () => {
        if (settled || remaining > 0) return;
        settled = true;
        if (receivedEmptyResponse) {
          resolve([]);
        } else {
          reject(
            lastError || new Error('All Overpass endpoints are unavailable.'),
          );
        }
      };

      OVERPASS_ENDPOINTS.forEach(baseUrl => {
        requestEndpoint(baseUrl)
          .then(results => {
            if (settled) return;
            remaining -= 1;
            if (results.length > 0) {
              settled = true;
              resolve(results);
              return;
            }
            receivedEmptyResponse = true;
            finishEmptyOrError();
          })
          .catch(error => {
            if (settled) return;
            if (isCallerAbort(error, signal)) {
              settled = true;
              reject(error);
              return;
            }
            remaining -= 1;
            lastError =
              error instanceof Error
                ? error
                : new Error('Overpass request failed.');
            finishEmptyOrError();
          });
      });
    });
  }
}
