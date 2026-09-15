import {
  ReverseGeocodeDetails,
  SearchPlaceItem,
  SearchOptions,
  UnifiedSearchSuggestions,
  SearchResult,
} from '../services/searchService';
import {
  getHaversineDistance,
  formatDistance,
  isValidCoordinate,
} from '../utils/locationUtils';
import {
  calculateRankingScore,
  calculateTextMatchScore,
} from '../utils/rankingUtils';
import { storageService } from '../services/storageService';
import { savedPlacesService } from '../services/SavedPlacesService';
import { nearbyPlacesService } from '../services/NearbyPlacesService';
import { NEARBY_CATEGORIES } from '../config/nearbyCategories';
import { logger } from '../utils/logger';
import {
  fetchWithTimeout,
  isCallerAbort,
  RequestTimeoutError,
  waitForRetry,
} from '../utils/networkUtils';
import { offlineDatabaseService } from '../services/OfflineDatabaseService';
import { connectivityService } from '../services/connectivityService';
import {
  classifyPlaceTags,
  PLACE_CATEGORIES,
} from '../config/placeCategories';

const TAG = 'SearchRepository';
const MAX_SEARCH_CACHE_ENTRIES = 100;
const AUTOCOMPLETE_TIMEOUT_MS = 5000;
const DEFAULT_LOCAL_AUTOCOMPLETE_RADIUS_METERS = 50000;
/**
 * Autocomplete must be usable from the very first typed character (p, pi,
 * piz, pizza…). A single character still fires a location-biased, bounded
 * query, so noise is contained by the GPS bounding box and the shared
 * ranking model rather than by refusing to search at all.
 */
export const MIN_SEARCH_QUERY_LENGTH = 1;

export interface ISearchRepository {
  searchPlaces(query: string, options?: SearchOptions): Promise<SearchPlaceItem[]>;
  reverseGeocode(latitude: number, longitude: number, signal?: AbortSignal): Promise<string>;
  reverseGeocodeDetails(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<ReverseGeocodeDetails>;
  getSuggestions(
    query: string,
    userLocation?: { latitude: number; longitude: number },
    signal?: AbortSignal,
  ): Promise<UnifiedSearchSuggestions>;
}

interface CacheEntry<T> {
  timestamp: number;
  data: T;
}

function containsUrduScript(str: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(str);
}

function normalizePlaceName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isDuplicateSearchPlace(
  existing: Pick<SearchPlaceItem, 'id' | 'title' | 'latitude' | 'longitude'>,
  candidate: Pick<SearchPlaceItem, 'id' | 'title' | 'latitude' | 'longitude'>,
): boolean {
  if (String(existing.id) === String(candidate.id)) return true;
  return (
    normalizePlaceName(existing.title) === normalizePlaceName(candidate.title) &&
    getHaversineDistance(
      existing.latitude,
      existing.longitude,
      candidate.latitude,
      candidate.longitude,
    ) < 100
  );
}

export function normalizeDetectedCity(city: string, county: string): string {
  const normalizedCity = city.trim();
  const normalizedCounty = county
    .trim()
    .replace(/\s+(district|division|county)$/i, '')
    .trim();
  if (
    normalizedCounty &&
    /\s+(taluka|tehsil|district)$/i.test(normalizedCity)
  ) {
    return normalizedCounty;
  }
  return normalizedCity || normalizedCounty;
}

export function detectCategory(
  _displayName: string,
  categoryType?: string,
  providerTags: Record<string, unknown> = {},
): { icon: string; name: string } {
  const normalizedType = String(categoryType || '').toLowerCase();
  const definition =
    classifyPlaceTags(providerTags) ||
    PLACE_CATEGORIES.find(candidate =>
      Object.values(candidate.osmTags).some(values =>
        values.includes(normalizedType),
      ),
    );
  if (definition) {
    return { icon: definition.icon, name: definition.title };
  }
  const dynamicName = normalizedType
    ? normalizedType.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
    : 'Location';
  return { icon: '📍', name: dynamicName };
}

export function parseNominatimTitleAndSubtitle(
  displayName: string,
  namedetails?: Record<string, string>,
  address?: Record<string, string>,
): { title: string; subtitle: string } {
  if (!displayName) return { title: '', subtitle: '' };

  const parts = displayName.split(',').map(p => p.trim());
  let title = parts[0] || displayName;
  let subtitleParts = parts.slice(1);

  if (containsUrduScript(title)) {
    const englishName =
      namedetails?.['name:en'] ||
      namedetails?.name ||
      address?.amenity ||
      address?.shop ||
      address?.building ||
      address?.office ||
      address?.road ||
      address?.suburb ||
      address?.city;

    if (englishName && !containsUrduScript(englishName)) {
      title = englishName;
    } else {
      const englishPart = parts.find(p => !containsUrduScript(p));
      if (englishPart) {
        title = englishPart;
        subtitleParts = parts.filter(p => p !== englishPart);
      }
    }
  }

  const englishSubtitles = subtitleParts.filter(p => !containsUrduScript(p));
  const subtitle = (englishSubtitles.length > 0 ? englishSubtitles : subtitleParts).join(', ');

  return { title, subtitle };
}

function setBoundedCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  entry: CacheEntry<T>,
): void {
  if (!cache.has(key) && cache.size >= MAX_SEARCH_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === 'string') {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, entry);
}

async function searchStoredOfflinePOIs(
  query: string,
  options?: SearchOptions,
): Promise<SearchPlaceItem[]> {
  const hasUserLocation = isValidCoordinate(
    options?.userLocation?.latitude,
    options?.userLocation?.longitude,
    true,
  );
  const userLatitude = hasUserLocation
    ? options!.userLocation!.latitude
    : 0;
  const userLongitude = hasUserLocation
    ? options!.userLocation!.longitude
    : 0;
  const pois = await offlineDatabaseService.searchPOIs(
    query,
    userLatitude,
    userLongitude,
    options?.limit ?? 15,
  );

  return pois.map(poi => {
    const distanceMeters = hasUserLocation
      ? Math.round(
          getHaversineDistance(
            userLatitude,
            userLongitude,
            poi.latitude,
            poi.longitude,
          ),
        )
      : undefined;
    const category = detectCategory('', poi.category);
    return {
      id: poi.id,
      title: poi.name,
      subtitle: poi.address,
      latitude: poi.latitude,
      longitude: poi.longitude,
      displayName: `${poi.name}, ${poi.address}`,
      distanceMeters,
      formattedDistance:
        typeof distanceMeters === 'number'
          ? formatDistance(distanceMeters)
          : undefined,
      categoryIcon: category.icon,
      categoryName: poi.category,
    };
  }).filter(place =>
    calculateTextMatchScore(place.title, place.subtitle, query, place.categoryName) > 0 &&
    (!hasUserLocation ||
      (typeof place.distanceMeters === 'number' &&
        place.distanceMeters <= (options?.radiusMeters ?? DEFAULT_LOCAL_AUTOCOMPLETE_RADIUS_METERS))),
  );
}

async function getStoredOfflineLocationDetails(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeDetails> {
  const offlinePois = await offlineDatabaseService.getPOIsByCategory(
    'all',
    latitude,
    longitude,
    10,
  );
  if (offlinePois.length > 0) {
    const nearest = offlinePois[0];
    return {
      displayName: `${nearest.name}, ${nearest.address}`,
      detectedArea: nearest.name,
    };
  }
  return {
    displayName: `Offline Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
    detectedArea: 'Offline Region',
  };
}

export class NominatimSearchRepository implements ISearchRepository {
  private cache: Map<string, CacheEntry<SearchPlaceItem[]>> = new Map();
  private pendingRequests: Map<string, Promise<SearchPlaceItem[]>> = new Map();
  private CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

  private getCacheKey(query: string, options?: SearchOptions): string {
    const qNorm = query.trim().toLowerCase();
    // Avoid missing the cache because of a few metres of normal GPS drift.
    // GeocodingService recalculates displayed distances from the latest fix.
    const latGrid = options?.userLocation?.latitude.toFixed(3) || 'none';
    const lonGrid = options?.userLocation?.longitude.toFixed(3) || 'none';
    const country = options?.countryCode || 'all';
    const radius = options?.radiusMeters || 'default';
    return `${qNorm}_${latGrid}_${lonGrid}_${country}_${radius}_${options?.limit || 15}`;
  }

  public async searchPlaces(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchPlaceItem[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
      return [];
    }
    if (connectivityService.getMode() === 'offline') {
      return searchStoredOfflinePOIs(trimmedQuery, options);
    }

    const cacheKey = this.getCacheKey(trimmedQuery, options);

    // 1. Check Memory Cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }
    if (cached) {
      this.cache.delete(cacheKey);
    }

    // 2. Check duplicate in-flight requests
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    const fetchPromise = (async () => {
      const startedAt = Date.now();
      try {
        const limit = options?.limit ?? 15;
        const userLoc = options?.userLocation;
        const countryCodeParam = options?.countryCode
          ? `&countrycodes=${options.countryCode.toLowerCase()}`
          : '';

        let viewboxBoundedParam = '';
        let viewboxUnboundedParam = '';

        if (
          isValidCoordinate(
            userLoc?.latitude,
            userLoc?.longitude,
            true,
          )
        ) {
          // Construct viewbox around user GPS (delta = 0.25 deg ~25km)
          const delta = 0.25;
          const left = userLoc.longitude - delta;
          const top = userLoc.latitude + delta;
          const right = userLoc.longitude + delta;
          const bottom = userLoc.latitude - delta;
          const viewboxStr = `${left.toFixed(4)},${top.toFixed(4)},${right.toFixed(4)},${bottom.toFixed(4)}`;
          viewboxBoundedParam = `&viewbox=${viewboxStr}&bounded=1`;
          viewboxUnboundedParam = `&viewbox=${viewboxStr}&bounded=0`;
        }

        let data: unknown = [];

        // Query the current GPS area first so category fallback stays local.
        if (viewboxBoundedParam) {
          const boundedUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
            trimmedQuery,
          )}&accept-language=en,en-US&addressdetails=1&namedetails=1&extratags=1${countryCodeParam}&limit=${limit}${viewboxBoundedParam}`;

          try {
            const response = await fetchWithTimeout(boundedUrl, {
              headers: {
                Accept: 'application/json',
                'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
              },
              signal: options?.signal,
              timeoutMs: AUTOCOMPLETE_TIMEOUT_MS,
            });

            if (response.ok) {
              const resData = await response.json();
              if (Array.isArray(resData) && resData.length > 0) {
                data = resData;
              }
            }
          } catch (error) {
            // A category switch aborts the old request intentionally. Do not
            // turn that cancellation into another network request.
            if (isCallerAbort(error, options?.signal)) {
              throw error;
            }
            // Ignore provider failure and continue to the unbounded fallback.
          }
        }

        // Secondary fallback query: Unbounded search with viewbox bias if bounded returned 0 results
        if (!Array.isArray(data) || data.length === 0) {
          const primaryUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
            trimmedQuery,
          )}&accept-language=en,en-US&addressdetails=1&namedetails=1&extratags=1${countryCodeParam}&limit=${limit}${viewboxUnboundedParam}`;

          let response = await fetchWithTimeout(primaryUrl, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
            },
            signal: options?.signal,
            timeoutMs: AUTOCOMPLETE_TIMEOUT_MS,
          });

          if (response.ok) {
            data = await response.json();
          }

        }

        if (!Array.isArray(data)) {
          return [];
        }

        const rawList = data as Record<string, unknown>[];
        const results: (SearchPlaceItem & { rankingScore: number; distanceMeters?: number })[] = [];

        for (let index = 0; index < rawList.length; index++) {
          const item = rawList[index];
          const displayName = typeof item.display_name === 'string' ? item.display_name : '';
          const namedetails = item.namedetails as Record<string, string> | undefined;
          const addressObj = item.address as Record<string, string> | undefined;
          const extratagsObj = item.extratags as Record<string, string> | undefined;

          const { title, subtitle } = parseNominatimTitleAndSubtitle(displayName, namedetails, addressObj);
          const lat = parseFloat(String(item.lat ?? 0));
          const lon = parseFloat(String(item.lon ?? 0));
          if (!isValidCoordinate(lat, lon, true)) {
            continue;
          }
          const itemType = typeof item.type === 'string' ? item.type : undefined;
          const itemCat = typeof item.category === 'string' ? item.category : undefined;
          const category = detectCategory(
            displayName,
            itemType,
            itemCat && itemType ? { [itemCat]: itemType } : {},
          );

          let distanceMeters: number | undefined;
          let formattedDist: string | undefined;

          if (
            isValidCoordinate(
              userLoc?.latitude,
              userLoc?.longitude,
              true,
            )
          ) {
            distanceMeters = Math.round(
              getHaversineDistance(userLoc.latitude, userLoc.longitude, lat, lon),
            );
            formattedDist = formatDistance(distanceMeters);
          }

          const importance = typeof item.importance === 'number' ? item.importance : parseFloat(String(item.importance ?? 0.5));

          let rankingScore = calculateRankingScore({
            title,
            subtitle,
            latitude: lat,
            longitude: lon,
            userLocation: userLoc,
            importance,
            address: addressObj,
            namedetails,
            extratags: extratagsObj,
            query: trimmedQuery,
          });

          // Distance Proximity Score Boost: Prioritize local city results (<25km) over distant cities/countries (>100km)
          if (distanceMeters !== undefined) {
            if (distanceMeters < 10000) {
              rankingScore += 400; // Strong local boost
            } else if (distanceMeters < 25000) {
              rankingScore += 250; // City level boost
            } else if (distanceMeters < 50000) {
              rankingScore += 100;
            } else if (distanceMeters > 500000) {
              rankingScore -= 300; // Demote results > 500km away
            }
          }

          results.push({
            id: (item.place_id as string | number) || `place_${lat}_${lon}`,
            title,
            subtitle,
            latitude: lat,
            longitude: lon,
            displayName,
            distanceMeters,
            formattedDistance: formattedDist,
            categoryIcon: category.icon,
            categoryName: category.name,
            raw: item,
            rankingScore,
          });
        }

        // If local matches (<50km) exist, filter out results > 500km away to avoid global contamination
        const hasLocalMatches = results.some(r => r.distanceMeters !== undefined && r.distanceMeters < 50000);
        let filteredResults = results;
        if (hasLocalMatches) {
          filteredResults = results.filter(r => r.distanceMeters === undefined || r.distanceMeters < 500000);
        }

        // Sort by composite ranking score descending
        filteredResults.sort((a, b) => b.rankingScore - a.rankingScore);

        const cleanResults: SearchPlaceItem[] = filteredResults.map(result => {
          const item: SearchPlaceItem & { rankingScore?: number } = {
            ...result,
          };
          delete item.rankingScore;
          return item;
        });

        // Logging search execution details
        if (
          isValidCoordinate(
            userLoc?.latitude,
            userLoc?.longitude,
            true,
          )
        ) {
          logger.info(
            TAG,
            `[GPS: ${userLoc.latitude.toFixed(5)}, ${userLoc.longitude.toFixed(5)}] API used: Nominatim API | Search: "${trimmedQuery}" | Results Count: ${cleanResults.length}`,
          );
        } else {
          logger.info(TAG, `API used: Nominatim API | Search: "${trimmedQuery}" | Results Count: ${cleanResults.length}`);
        }

        cleanResults.forEach((r, idx) => {
          logger.info(
            TAG,
            `  ${idx + 1}. "${r.title}" (${r.subtitle}) - ${r.formattedDistance || 'Distance N/A'} (${typeof r.distanceMeters === 'number' ? `${r.distanceMeters}m away` : 'distance unavailable'})`,
          );
        });

        if (cleanResults.length === 0) {
          const offlinePois = await offlineDatabaseService.searchPOIs(
            trimmedQuery,
            userLoc?.latitude || 0,
            userLoc?.longitude || 0,
            limit,
          );
          if (offlinePois.length > 0) {
            return offlinePois.map(poi => {
              const distanceMeters = Math.round(
                getHaversineDistance(
                  userLoc?.latitude || 0,
                  userLoc?.longitude || 0,
                  poi.latitude,
                  poi.longitude,
                ),
              );
              return {
                id: poi.id,
                title: poi.name,
                subtitle: poi.address,
                latitude: poi.latitude,
                longitude: poi.longitude,
                displayName: `${poi.name}, ${poi.address}`,
                distanceMeters,
                formattedDistance: formatDistance(distanceMeters),
                categoryIcon: '📍',
                categoryName: poi.category,
              };
            });
          }
        }

        setBoundedCache(this.cache, cacheKey, {
          timestamp: Date.now(),
          data: cleanResults,
        });
        return cleanResults;
      } catch (err) {
        const userLoc = options?.userLocation;
        const offlinePois = await offlineDatabaseService.searchPOIs(
          trimmedQuery,
          userLoc?.latitude || 0,
          userLoc?.longitude || 0,
          options?.limit || 15,
        );
        if (offlinePois.length > 0) {
          return offlinePois.map(poi => {
            const distanceMeters = Math.round(
              getHaversineDistance(
                userLoc?.latitude || 0,
                userLoc?.longitude || 0,
                poi.latitude,
                poi.longitude,
              ),
            );
            return {
              id: poi.id,
              title: poi.name,
              subtitle: poi.address,
              latitude: poi.latitude,
              longitude: poi.longitude,
              displayName: `${poi.name}, ${poi.address}`,
              distanceMeters,
              formattedDistance: formatDistance(distanceMeters),
              categoryIcon: '📍',
              categoryName: poi.category,
            };
          });
        }
        throw err;
      } finally {
        this.pendingRequests.delete(cacheKey);
        logger.performance(TAG, 'nominatim.search', startedAt, {
          queryLength: trimmedQuery.length,
        });
      }
    })();

    this.pendingRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  public async reverseGeocode(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.reverseGeocodeDetails(latitude, longitude, signal);
    return result.displayName;
  }

  public async reverseGeocodeDetails(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<ReverseGeocodeDetails> {
    if (!isValidCoordinate(latitude, longitude, true)) {
      return {
        displayName: 'Address unavailable',
        detectedArea: 'Current Location',
      };
    }
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=en&addressdetails=1`;
      const response = await fetchWithTimeout(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
        },
        signal,
        timeoutMs: 10000,
      });

      if (!response.ok) {
        return { displayName: 'Address not found', detectedArea: 'Current Area' };
      }

      const data = await response.json();
      const displayName = data.display_name || 'Address not found';

      let detectedArea = 'Current Location';
      if (data.address) {
        detectedArea =
          data.address.neighbourhood ||
          data.address.suburb ||
          data.address.quarter ||
          data.address.road ||
          data.address.city_district ||
          data.address.town ||
          data.address.city ||
          data.address.municipality ||
          data.address.county ||
          'Current Location';
      } else if (data.display_name) {
        const parts = data.display_name.split(',').map((p: string) => p.trim());
        detectedArea = parts.length > 0 ? parts[0] : 'Current Location';
      }

      return {
        displayName,
        detectedArea,
        city:
          normalizeDetectedCity(
            String(
              data.address?.city ||
                data.address?.town ||
                data.address?.municipality ||
                '',
            ),
            String(data.address?.county || ''),
          ) || undefined,
        countryCode:
          String(data.address?.country_code || '').trim().toUpperCase() ||
          undefined,
      };
    } catch (error: unknown) {
      if (isCallerAbort(error, signal)) {
        throw error;
      }
      try {
        const offlinePois = await offlineDatabaseService.getPOIsByCategory(
          'all',
          latitude,
          longitude,
          10,
        );
        if (offlinePois.length > 0) {
          const nearest = offlinePois[0];
          return {
            displayName: `${nearest.name}, ${nearest.address}`,
            detectedArea: nearest.name,
          };
        }
      } catch {
        // ignore offline DB error
      }
      return {
        displayName: `Offline Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
        detectedArea: 'Offline Region',
      };
    }
  }

  public async getSuggestions(
    query: string,
    userLocation?: { latitude: number; longitude: number },
    signal?: AbortSignal,
  ): Promise<UnifiedSearchSuggestions> {
    const trimmed = query.trim();

    const recents = (await storageService.getRecentSearchesAsync()).map(item => ({
      id: `recent_${item.id}`,
      name: item.title,
      address: item.subtitle,
      latitude: item.latitude,
      longitude: item.longitude,
      category: item.categoryName || 'Recent',
      source: 'recent' as const,
    }));

    const savedList = await savedPlacesService.getSavedPlaces();
    const saved = savedList.map(p => ({
      id: `saved_${p.id}`,
      name: p.name,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      category: p.type ? p.type.toUpperCase() : 'Saved',
      source: 'saved' as const,
    }));

    if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
      return {
        recent: recents,
        saved,
        nearby: [],
        searchResults: [],
      };
    }

    const items = await this.searchPlaces(trimmed, { userLocation, signal });
    const searchResults: SearchResult[] = items.map(item => ({
      id: String(item.id),
      name: item.title,
      address: item.subtitle,
      latitude: item.latitude,
      longitude: item.longitude,
      category: item.categoryName || 'Location',
      distanceMeters: item.distanceMeters,
      formattedDistance: item.formattedDistance,
      source: 'search',
    }));

    let nearby: SearchResult[] = [];
    if (
      isValidCoordinate(
        userLocation?.latitude,
        userLocation?.longitude,
        true,
      )
    ) {
      const categoryMatch = NEARBY_CATEGORIES.find(c =>
        !c.isSavedPlace &&
        c.title.toLowerCase().includes(trimmed.toLowerCase()),
      );
      if (categoryMatch) {
        const nearbyPlaces = await nearbyPlacesService.searchNearby(
          {
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
            category: categoryMatch.category,
            radius: 2, // 2km default
            includeRoadDistance: false,
          },
          signal,
        );
        nearby = nearbyPlaces.map(p => ({
          id: `nearby_${p.id}`,
          name: p.name,
          address: p.address,
          latitude: p.latitude,
          longitude: p.longitude,
          category: p.category,
          distanceMeters: p.distance,
          formattedDistance: p.formattedDistance,
          source: 'nearby' as const,
        }));
      }
    }

    return {
      recent: recents.filter(r => r.name.toLowerCase().includes(trimmed.toLowerCase())),
      saved: saved.filter(s => s.name.toLowerCase().includes(trimmed.toLowerCase())),
      nearby,
      searchResults,
    };
  }
}

export class PhotonSearchRepository implements ISearchRepository {
  private cache: Map<string, CacheEntry<SearchPlaceItem[]>> = new Map();
  private reverseCache: Map<string, CacheEntry<ReverseGeocodeDetails>> =
    new Map();
  private pendingRequests: Map<string, Promise<SearchPlaceItem[]>> = new Map();
  private CACHE_TTL_MS = 5 * 60 * 1000;

  private getCacheKey(query: string, options?: SearchOptions): string {
    const qNorm = query.trim().toLowerCase();
    const validLocation = isValidCoordinate(
      options?.userLocation?.latitude,
      options?.userLocation?.longitude,
      true,
    );
    const latGrid = validLocation
      ? options!.userLocation!.latitude.toFixed(3)
      : 'none';
    const lonGrid = validLocation
      ? options!.userLocation!.longitude.toFixed(3)
      : 'none';
    const country = options?.countryCode?.toUpperCase() || 'ALL';
    return `${qNorm}_${latGrid}_${lonGrid}_${country}_${options?.limit || 15}_${options?.radiusMeters ?? DEFAULT_LOCAL_AUTOCOMPLETE_RADIUS_METERS}`;
  }

  public async searchPlaces(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchPlaceItem[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
      return [];
    }
    if (connectivityService.getMode() === 'offline') {
      logger.info(TAG, 'Offline mode: searching downloaded place data.');
      return searchStoredOfflinePOIs(trimmedQuery, options);
    }

    const cacheKey = this.getCacheKey(trimmedQuery, options);

    // 1. Check Memory Cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }
    if (cached) {
      this.cache.delete(cacheKey);
    }

    // 2. Check duplicate in-flight requests
    if (!options?.signal && this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    const fetchPromise = (async () => {
      const startedAt = Date.now();
      try {
        const userLoc = isValidCoordinate(
          options?.userLocation?.latitude,
          options?.userLocation?.longitude,
          true,
        )
          ? options!.userLocation
          : undefined;
        const limit = Math.max(1, Math.min(30, options?.limit ?? 15));

        const requestedCountryCode = options?.countryCode
          ?.trim()
          .toUpperCase();
        const locationBias = userLoc
          ? `&lat=${userLoc.latitude}&lon=${userLoc.longitude}`
          : '';
        const localRadiusMeters = Math.max(
          1000,
          Math.min(
            DEFAULT_LOCAL_AUTOCOMPLETE_RADIUS_METERS,
            options?.radiusMeters ?? DEFAULT_LOCAL_AUTOCOMPLETE_RADIUS_METERS,
          ),
        );
        const localBoundingBox = userLoc
          ? (() => {
              const radiusKm = localRadiusMeters / 1000;
              const latitudeDelta = radiusKm / 111.32;
              const longitudeDelta =
                radiusKm /
                (111.32 *
                  Math.max(
                    0.1,
                    Math.cos((userLoc.latitude * Math.PI) / 180),
                  ));
              return `&bbox=${(
                userLoc.longitude - longitudeDelta
              ).toFixed(5)},${(userLoc.latitude - latitudeDelta).toFixed(
                5,
              )},${(userLoc.longitude + longitudeDelta).toFixed(5)},${(
                userLoc.latitude + latitudeDelta
              ).toFixed(5)}`;
            })()
          : '';
        const countryBoundingBox =
          requestedCountryCode === 'PK'
            ? '&bbox=60.87,23.63,77.84,37.10'
            : '';
        const countryCodeParam = requestedCountryCode
          ? `&countrycode=${requestedCountryCode}`
          : '';

        // Only include a location bias when a real GPS fix is available. The
        // map's fallback camera center must not masquerade as user location.
        const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
          trimmedQuery,
        )}&lang=en&limit=${limit * 3}${locationBias}${
          localBoundingBox || countryBoundingBox
        }${countryCodeParam}`;

        let data: unknown = null;
        let lastPhotonError: Error | null = null;

        // Retry once if API fails
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const response = await fetchWithTimeout(photonUrl, {
              headers: {
                Accept: 'application/json',
                'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
              },
              signal: options?.signal,
              timeoutMs: AUTOCOMPLETE_TIMEOUT_MS,
            });

            if (response.ok) {
              data = await response.json();
              break;
            }
            lastPhotonError = new Error(
              `Photon autocomplete failed (HTTP ${response.status}).`,
            );
            if (response.status < 500 && response.status !== 429) {
              break;
            }
          } catch (err) {
            if (isCallerAbort(err, options?.signal)) {
              throw err;
            }
            lastPhotonError =
              err instanceof Error
                ? err
                : new Error('Photon autocomplete request failed.');
            // Do not turn one slow autocomplete call into two consecutive
            // full waits. Quick failures still get the retry below.
            if (err instanceof RequestTimeoutError) {
              break;
            }
          }
          if (attempt === 1) {
            logger.info(TAG, 'Photon API attempt 1 failed, retrying once...');
            await waitForRetry(300, options?.signal);
          }
        }

        // Public Nominatim explicitly forbids client-side autocomplete, so a
        // Photon outage must surface as an empty/error result rather than using
        // that endpoint as a hidden typeahead fallback.
        if (!data || typeof data !== 'object' || !('features' in data)) {
          // Provider outages are recoverable and expected in the nearby
          // fallback chain; keep them out of React Native's warning LogBox.
          logger.info(TAG, 'Photon autocomplete unavailable after retry.');
          logger.debug(TAG, 'Last Photon failure.', lastPhotonError);
          throw new Error('Photon autocomplete is currently unavailable.');
        }

        const featureCollection = data as { features?: Record<string, unknown>[] };
        const features = Array.isArray(featureCollection.features) ? featureCollection.features : [];

        const results: (SearchPlaceItem & { rankingScore: number })[] = [];

        for (let idx = 0; idx < features.length; idx++) {
          const feat = features[idx];
          const geometry = feat.geometry as { coordinates?: [number, number] } | undefined;
          const props = (feat.properties as Record<string, unknown>) || {};

          if (!geometry?.coordinates || geometry.coordinates.length < 2) continue;

          const lon = geometry.coordinates[0];
          const lat = geometry.coordinates[1];

          if (!isValidCoordinate(lat, lon, true)) {
            continue;
          }

          // Keep provider metadata consistent with the requested country.
          const countryCode = String(props.countrycode || props.country_code || '').toLowerCase();
          const requestedCountryLower = requestedCountryCode?.toLowerCase();
          const matchesRequestedCountry =
            !requestedCountryLower || countryCode === requestedCountryLower;
          if (!matchesRequestedCountry) continue;

          const rawName = String(props.name || props.title || '').trim();
          const category = detectCategory('', String(props.osm_value || ''), {
            [String(props.osm_key || '')]: props.osm_value,
          });

          // A missing or generic placeholder title (e.g. Photon's own
          // "Unknown place") does not make this an invalid result. Typed
          // text search still filters it out below via the text-match score,
          // since a made-up label cannot genuinely match a real query; this
          // only keeps the place alive for location-based category browsing
          // (nearby-category taps that fall back to this provider), where an
          // honest "Unnamed <Category>" label beats silently dropping a real
          // POI or inventing a specific business name.
          const isUsableName =
            !!rawName &&
            !rawName.toLowerCase().includes('unknown place') &&
            rawName.toLowerCase() !== 'unnamed';
          const name = isUsableName ? rawName : `Unnamed ${category.name}`;

          const street = String(props.street || props.road || '').trim();
          const district = String(props.district || props.suburb || props.neighbourhood || '').trim();
          const city = String(props.city || props.town || '').trim();
          const county = String(props.county || '').trim();
          const state = String(props.state || '').trim();
          const resultCountry = String(props.country || '').trim();

          const subtitleParts = [
            street,
            district,
            city,
            county,
            state,
            resultCountry,
          ].filter(Boolean);
          const subtitle = Array.from(new Set(subtitleParts)).join(', ');
          if (!subtitle) continue;

          const searchMetadata = `${String(props.osm_key || '')} ${String(
            props.osm_value || '',
          )}`;
          const textMatchScore = calculateTextMatchScore(
            name,
            subtitle,
            trimmedQuery,
            searchMetadata,
          );
          if (textMatchScore <= 0) continue;

          const distanceMeters = userLoc
            ? Math.round(
                getHaversineDistance(
                  userLoc.latitude,
                  userLoc.longitude,
                  lat,
                  lon,
                ),
              )
            : undefined;
          const formattedDistance =
            typeof distanceMeters === 'number'
              ? formatDistance(distanceMeters)
              : undefined;

          const rankingScore = calculateRankingScore({
            title: name,
            subtitle,
            latitude: lat,
            longitude: lon,
            userLocation: userLoc,
            address: {
              street,
              city,
              suburb: district,
            },
            query: trimmedQuery,
            searchMetadata,
          });

          results.push({
            id: (props.osm_id as string | number) || `photon_${lat}_${lon}_${idx}`,
            title: name,
            subtitle,
            latitude: lat,
            longitude: lon,
            displayName: `${name}, ${subtitle}`,
            distanceMeters,
            formattedDistance,
            categoryIcon: category.icon,
            categoryName: category.name,
            raw: props,
            rankingScore,
          });
        }

        // Remove proximity duplicates
        const uniqueResults: (SearchPlaceItem & { rankingScore: number })[] = [];
        for (const res of results) {
          const isDup = uniqueResults.some(existing =>
            isDuplicateSearchPlace(existing, res),
          );
          if (!isDup) {
            uniqueResults.push(res);
          }
        }

        // Enforce circular local coverage even when the provider only returns
        // distant matches or places in the corners of the bounding box.
        const localResults = userLoc
          ? uniqueResults.filter(
              result =>
                typeof result.distanceMeters === 'number' &&
                result.distanceMeters <= localRadiusMeters,
            )
          : [];
        const rankedResults =
          userLoc ? localResults : uniqueResults;

        rankedResults.sort((a, b) => b.rankingScore - a.rankingScore);

        const cleanResults: SearchPlaceItem[] = rankedResults
          .slice(0, limit)
          .map(result => {
            const item: SearchPlaceItem & { rankingScore?: number } = {
              ...result,
            };
            delete item.rankingScore;
            return item;
          });

        // Logging search execution details
        logger.info(
          TAG,
          userLoc
            ? `[GPS: ${userLoc.latitude.toFixed(5)}, ${userLoc.longitude.toFixed(5)}] API used: Photon API | Search: "${trimmedQuery}" | Results Count: ${cleanResults.length}`
            : `API used: Photon API | Search: "${trimmedQuery}" | Results Count: ${cleanResults.length}`,
        );
        cleanResults.forEach((r, idx) => {
          logger.info(
            TAG,
            `  ${idx + 1}. "${r.title}" (${r.subtitle}) - ${r.formattedDistance || 'Distance N/A'} (${typeof r.distanceMeters === 'number' ? `${r.distanceMeters}m away` : 'distance unavailable'})`,
          );
        });

        setBoundedCache(this.cache, cacheKey, {
          timestamp: Date.now(),
          data: cleanResults,
        });
        return cleanResults;
      } catch (error) {
        if (isCallerAbort(error, options?.signal)) throw error;
        const offlineResults = await searchStoredOfflinePOIs(
          trimmedQuery,
          options,
        );
        if (offlineResults.length > 0) return offlineResults;
        throw error;
      } finally {
        this.pendingRequests.delete(cacheKey);
        logger.performance(TAG, 'photon.search', startedAt, {
          queryLength: trimmedQuery.length,
        });
      }
    })();

    if (!options?.signal) {
      this.pendingRequests.set(cacheKey, fetchPromise);
    }
    return fetchPromise;
  }

  public async reverseGeocode(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.reverseGeocodeDetails(latitude, longitude, signal);
    return result.displayName;
  }

  public async reverseGeocodeDetails(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<ReverseGeocodeDetails> {
    if (!isValidCoordinate(latitude, longitude, true)) {
      return {
        displayName: 'Address unavailable',
        detectedArea: 'Current Location',
      };
    }
    if (connectivityService.getMode() === 'offline') {
      return getStoredOfflineLocationDetails(latitude, longitude);
    }

    const cacheKey = `${latitude.toFixed(4)}_${longitude.toFixed(4)}`;
    const cached = this.reverseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return { ...cached.data };
    }
    if (cached) this.reverseCache.delete(cacheKey);

    try {
      const url =
        `https://photon.komoot.io/reverse?lat=${latitude}` +
        `&lon=${longitude}&lang=en&limit=1`;
      let response: Response | null = null;
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const candidate = await fetchWithTimeout(url, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
            },
            signal,
            timeoutMs: 10000,
          });
          if (candidate.ok) {
            response = candidate;
            break;
          }
          lastError = new Error(
            `Photon reverse geocoding failed (${candidate.status})`,
          );
          if (candidate.status < 500 && candidate.status !== 429) break;
        } catch (error) {
          if (isCallerAbort(error, signal)) throw error;
          lastError = error;
        }
        if (attempt === 1) await waitForRetry(300, signal);
      }
      if (!response) {
        throw lastError instanceof Error
          ? lastError
          : new Error('Photon reverse geocoding failed.');
      }

      const payload = (await response.json()) as {
        features?: Array<{ properties?: Record<string, unknown> }>;
      };
      const properties = payload.features?.[0]?.properties;
      if (!properties) {
        return {
          displayName: 'Address not found',
          detectedArea: 'Current Location',
        };
      }

      const name = String(properties.name || '').trim();
      const street = String(properties.street || properties.road || '').trim();
      const district = String(
        properties.district ||
          properties.suburb ||
          properties.locality ||
          properties.neighbourhood ||
          '',
      ).trim();
      const city = String(properties.city || properties.town || '').trim();
      const county = String(properties.county || '').trim();
      const detectedCity = normalizeDetectedCity(city, county);
      const state = String(properties.state || '').trim();
      const country = String(properties.country || '').trim();
      const parts = Array.from(
        new Set([name, street, district, city, county, state, country].filter(Boolean)),
      );

      const details: ReverseGeocodeDetails = {
        displayName: parts.join(', ') || 'Address not found',
        detectedArea:
          district || city || county || street || name || 'Current Location',
        city: detectedCity || undefined,
        countryCode:
          String(properties.countrycode || properties.country_code || '')
            .trim()
            .toUpperCase() || undefined,
      };
      setBoundedCache(this.reverseCache, cacheKey, {
        timestamp: Date.now(),
        data: details,
      });
      return details;
    } catch (error: unknown) {
      if (isCallerAbort(error, signal)) {
        throw error;
      }
      logger.warn(TAG, 'Photon reverse geocoding unavailable.', error);
      return getStoredOfflineLocationDetails(latitude, longitude);
    }
  }

  public async getSuggestions(
    query: string,
    userLocation?: { latitude: number; longitude: number },
    signal?: AbortSignal,
  ): Promise<UnifiedSearchSuggestions> {
    const trimmed = query.trim();

    const recents = (await storageService.getRecentSearchesAsync()).map(item => ({
      id: `recent_${item.id}`,
      name: item.title,
      address: item.subtitle,
      latitude: item.latitude,
      longitude: item.longitude,
      category: item.categoryName || 'Recent',
      source: 'recent' as const,
    }));

    const savedList = await savedPlacesService.getSavedPlaces();
    const saved = savedList.map(p => ({
      id: `saved_${p.id}`,
      name: p.name,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      category: p.type ? p.type.toUpperCase() : 'Saved',
      source: 'saved' as const,
    }));

    if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
      return {
        recent: recents,
        saved,
        nearby: [],
        searchResults: [],
      };
    }

    const items = await this.searchPlaces(trimmed, { userLocation, signal });
    const searchResults: SearchResult[] = items.map(item => ({
      id: String(item.id),
      name: item.title,
      address: item.subtitle,
      latitude: item.latitude,
      longitude: item.longitude,
      category: item.categoryName || 'Location',
      distanceMeters: item.distanceMeters,
      formattedDistance: item.formattedDistance,
      source: 'search',
    }));

    let nearby: SearchResult[] = [];
    const categoryMatch = NEARBY_CATEGORIES.find(c =>
      !c.isSavedPlace &&
      c.title.toLowerCase().includes(trimmed.toLowerCase()),
    );
    if (
      categoryMatch &&
      isValidCoordinate(
        userLocation?.latitude,
        userLocation?.longitude,
        true,
      )
    ) {
      const nearbyPlaces = await nearbyPlacesService.searchNearby(
        {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          category: categoryMatch.category,
          radius: 2,
          includeRoadDistance: false,
        },
        signal,
      );
      nearby = nearbyPlaces.map(p => ({
        id: `nearby_${p.id}`,
        name: p.name,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        category: p.category,
        distanceMeters: p.distance,
        formattedDistance: p.formattedDistance,
        source: 'nearby' as const,
      }));
    }

    return {
      recent: recents.filter(r => r.name.toLowerCase().includes(trimmed.toLowerCase())),
      saved: saved.filter(s => s.name.toLowerCase().includes(trimmed.toLowerCase())),
      nearby,
      searchResults,
    };
  }
}
