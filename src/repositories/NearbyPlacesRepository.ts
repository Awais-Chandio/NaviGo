import { NearbySearchParams, NearbyPlace } from '../types/places';
import { getHaversineDistance, formatDistance } from '../utils/locationUtils';
import { connectivityService } from '../services/connectivityService';
import { LOCATION_CONFIG } from '../config/locationConfig';
import { logger } from '../utils/logger';
import {
  fetchWithTimeout,
  isCallerAbort,
  waitForRetry,
} from '../utils/networkUtils';

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

export const CATEGORY_MAP: Record<string, CategoryQueryConfig> = {
  food: {
    osmQuery: 'restaurant',
    overpassFilters: ['nwr["amenity"~"restaurant|fast_food|food_court"]'],
  },
  restaurant: {
    osmQuery: 'restaurant',
    overpassFilters: ['nwr["amenity"~"restaurant|fast_food|food_court"]'],
  },
  cafe: {
    osmQuery: 'cafe',
    overpassFilters: ['nwr["amenity"="cafe"]'],
  },
  atm: {
    osmQuery: 'atm',
    overpassFilters: ['nwr["amenity"="atm"]'],
  },
  bank: {
    osmQuery: 'bank',
    overpassFilters: ['nwr["amenity"~"atm|bank"]'],
  },
  fuel: {
    osmQuery: 'fuel',
    overpassFilters: ['nwr["amenity"="fuel"]'],
  },
  petrol: {
    osmQuery: 'fuel',
    overpassFilters: ['nwr["amenity"="fuel"]'],
  },
  hospital: {
    osmQuery: 'hospital',
    overpassFilters: [
      'nwr["amenity"~"hospital|clinic"]',
      'nwr["healthcare"~"hospital|clinic|centre"]',
    ],
  },
  pharmacy: {
    osmQuery: 'pharmacy',
    overpassFilters: ['nwr["amenity"="pharmacy"]', 'nwr["shop"="chemist"]'],
  },
  hotel: {
    osmQuery: 'hotel',
    overpassFilters: ['nwr["tourism"~"hotel|motel|guest_house|hostel"]'],
  },
  parking: {
    osmQuery: 'parking',
    overpassFilters: ['nwr["amenity"~"parking|parking_space|parking_entrance"]'],
  },
  shopping: {
    osmQuery: 'supermarket',
    overpassFilters: ['nwr["shop"~"supermarket|mall|department_store|convenience|grocery|clothes"]'],
  },
  grocery: {
    osmQuery: 'supermarket',
    overpassFilters: ['nwr["shop"~"supermarket|mall|department_store|convenience|grocery|clothes"]'],
  },
  supermarket: {
    osmQuery: 'supermarket',
    overpassFilters: ['nwr["shop"~"supermarket|mall|department_store|convenience|grocery|clothes"]'],
  },
  school: {
    osmQuery: 'school',
    overpassFilters: ['nwr["amenity"="school"]'],
  },
  university: {
    osmQuery: 'university',
    overpassFilters: ['nwr["amenity"~"university|college"]'],
  },
};

export interface INearbyPlacesRepository {
  searchNearby(params: NearbySearchParams, signal?: AbortSignal): Promise<NearbyPlace[]>;
}

interface CacheEntry {
  timestamp: number;
  results: NearbyPlace[];
}

function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    (lat !== 0 || lon !== 0)
  );
}

function removeProximityDuplicates(
  places: NearbyPlace[],
): NearbyPlace[] {
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
        value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
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
    if (!isValidCoordinate(latitude, longitude)) {
      logger.info(TAG, 'Search skipped: Invalid or missing GPS coordinates.');
      return [];
    }
    if (!CATEGORY_MAP[category]) {
      logger.warn(TAG, `Unsupported nearby category: ${category}`);
      return [];
    }

    const requestedRadiusMeters =
      typeof params.radius === 'number' &&
      Number.isFinite(params.radius) &&
      params.radius > 0
        ? Math.min(10000, Math.max(100, Math.round(params.radius * 1000)))
        : null;
    const radiusStepsMeters = requestedRadiusMeters
      ? [requestedRadiusMeters]
      : LOCATION_CONFIG.NEARBY_RADIUS_STEPS_METERS;
    const cacheKey = this.getCacheKey(
      category,
      latitude,
      longitude,
      radiusStepsMeters[radiusStepsMeters.length - 1],
    );

    // 2. Check 60s Memory Cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.results;
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
        const isOnline = connectivityService.isOnlineMode();
        if (!isOnline) {
          throw new Error('Nearby search is unavailable while offline.');
        }

        for (const currentRadiusMeters of radiusStepsMeters) {
          logger.info(
            TAG,
            `[GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}] Radius: ${currentRadiusMeters}m | API used: Overpass API | Searching nearby "${category}"...`,
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
            const top20Results = results.slice(0, LOCATION_CONFIG.MAX_NEARBY_RESULTS || 20);

            // Log returned results details
            logger.info(
              TAG,
              `Radius: ${currentRadiusMeters}m | API: Overpass | Returned ${top20Results.length} results`,
            );
            top20Results.forEach((r, idx) => {
              logger.debug(TAG, `${idx + 1}. ${r.name} - ${r.distance}m`);
            });

            if (!this.cache.has(cacheKey) && this.cache.size >= MAX_NEARBY_CACHE_ENTRIES) {
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
          `No ${category} places found within ${radiusStepsMeters[radiusStepsMeters.length - 1]}m`,
        );
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

    const query = `[out:json][timeout:10]; (${queryStatements}); out center qt 200;`;
    let lastError: Error | null = null;

    for (const baseUrl of OVERPASS_ENDPOINTS) {
      // Retry once on failure
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const url = `${baseUrl}?data=${encodeURIComponent(query)}`;
          const response = await fetchWithTimeout(url, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
            },
            signal,
            timeoutMs: 10000,
          });

          if (!response.ok) {
            lastError = new Error(
              `Overpass server unavailable (HTTP ${response.status}).`,
            );
            continue;
          }

          const data = (await response.json()) as { elements?: Record<string, unknown>[] };
          const elements = Array.isArray(data?.elements) ? data.elements : [];

          const places: NearbyPlace[] = [];

          for (let index = 0; index < elements.length; index++) {
            const element = elements[index];
            const centerObj = element.center as { lat?: number; lon?: number } | undefined;
            const lat = parseFloat(String(element.lat ?? centerObj?.lat ?? 0));
            const lon = parseFloat(String(element.lon ?? centerObj?.lon ?? 0));

            // Ignore invalid coordinates
            if (!isValidCoordinate(lat, lon)) continue;

            // Calculate distance using Haversine formula
            const distMeters = Math.round(getHaversineDistance(latitude, longitude, lat, lon));

            // Strict radius check: Ignore places outside requested radius
            if (distMeters > radiusMeters) {
              continue;
            }

            const tags = (element.tags as Record<string, string>) || {};
            const name =
              tags.name ||
              tags['name:en'] ||
              tags.brand ||
              tags.operator;

            // QUALITY FILTER: Ignore unnamed places or generic spot fallbacks
            if (
              !name ||
              name.trim().length === 0 ||
              name.toLowerCase().includes('spot') ||
              name.toLowerCase().includes('unknown place') ||
              name.toLowerCase() === 'unnamed'
            ) {
              continue;
            }

            const addressParts = [
              tags['addr:street'],
              tags['addr:suburb'],
              tags['addr:city'],
            ].filter(Boolean);

            const address =
              addressParts.join(', ') ||
              tags['addr:full'] ||
              `${this.getFormattedCategoryTitle(category)} near location`;

            places.push({
              id: `overpass_${String(element.type || 'element')}_${element.id || index}`,
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
          return cleanPlaces.slice(
            0,
            LOCATION_CONFIG.MAX_NEARBY_RESULTS || 20,
          );
        } catch (err) {
          if (isCallerAbort(err, signal)) {
            throw err;
          }
          lastError =
            err instanceof Error
              ? err
              : new Error('Overpass request failed.');
          if (attempt === 1) {
            logger.info(TAG, `Overpass ${baseUrl} attempt 1 failed, retrying once...`);
            await waitForRetry(300, signal);
          }
        }
      }
    }

    throw lastError || new Error('All Overpass endpoints are unavailable.');
  }
  private getFormattedCategoryTitle(category: string): string {
    if (!category) return 'Nearby';
    return category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
  }
}
