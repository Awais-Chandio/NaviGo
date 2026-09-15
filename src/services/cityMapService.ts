import { LOCATION_CONFIG } from '../config/locationConfig';
import { OfflineRegionCenter, RegionBoundingBox } from '../types/location';
import { getHaversineDistance } from '../utils/locationUtils';
import { fetchWithTimeout } from '../utils/networkUtils';

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const CITY_BOUNDARY_TIMEOUT_MS = 12000;
const CITY_COVERAGE_MARGIN_KM = 1;
const MIN_CITY_RADIUS_KM = 5;
const MAX_CITY_RADIUS_KM = 100;

interface NominatimCityResult {
  osm_type?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  display_name?: string;
  boundingbox?: unknown;
  address?: Record<string, unknown>;
}

export interface CityDownloadPlan {
  name: string;
  center: OfflineRegionCenter;
  radiusKm: number;
  cityBounds: RegionBoundingBox;
  usedFallback: boolean;
}

export interface ResolveCityDownloadOptions {
  cityName?: string;
  countryCode?: string;
  userLocation: OfflineRegionCenter;
  signal?: AbortSignal;
}

function parseBounds(value: unknown): RegionBoundingBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [minLat, maxLat, minLng, maxLng] = value.map(Number);
  if (
    ![minLat, maxLat, minLng, maxLng].every(Number.isFinite) ||
    minLat < -85.05112878 ||
    maxLat > 85.05112878 ||
    minLng < -180 ||
    maxLng > 180 ||
    minLat >= maxLat ||
    minLng >= maxLng
  ) {
    return null;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function boundsContainPoint(
  bounds: RegionBoundingBox,
  point: OfflineRegionCenter,
): boolean {
  return (
    point.latitude >= bounds.minLat &&
    point.latitude <= bounds.maxLat &&
    point.longitude >= bounds.minLng &&
    point.longitude <= bounds.maxLng
  );
}

function getCoverageForBounds(bounds: RegionBoundingBox): {
  center: OfflineRegionCenter;
  radiusKm: number;
} {
  const center = {
    latitude: (bounds.minLat + bounds.maxLat) / 2,
    longitude: (bounds.minLng + bounds.maxLng) / 2,
  };
  const corners: OfflineRegionCenter[] = [
    { latitude: bounds.minLat, longitude: bounds.minLng },
    { latitude: bounds.minLat, longitude: bounds.maxLng },
    { latitude: bounds.maxLat, longitude: bounds.minLng },
    { latitude: bounds.maxLat, longitude: bounds.maxLng },
  ];
  const furthestCornerKm = Math.max(
    ...corners.map(
      corner =>
        getHaversineDistance(
          center.latitude,
          center.longitude,
          corner.latitude,
          corner.longitude,
        ) / 1000,
    ),
  );
  return {
    center,
    radiusKm: Math.max(
      MIN_CITY_RADIUS_KM,
      furthestCornerKm + CITY_COVERAGE_MARGIN_KM,
    ),
  };
}

function getCandidateScore(
  candidate: NominatimCityResult,
  bounds: RegionBoundingBox,
  cityName: string,
  userLocation: OfflineRegionCenter,
): number {
  const address = candidate.address ?? {};
  const candidateName = String(
    address.city ||
      address.town ||
      address.municipality ||
      address.county ||
      candidate.display_name?.split(',')[0] ||
      '',
  )
    .trim()
    .toLowerCase();
  const requestedName = cityName.trim().toLowerCase();
  let score = boundsContainPoint(bounds, userLocation) ? 1000 : 0;
  if (candidateName === requestedName) score += 500;
  if (candidate.osm_type === 'relation') score += 200;
  // Prefer the actual place=city relation over a smaller administrative
  // subdivision that may also report addresstype=city (for example a taluka).
  if (candidate.category === 'place' && candidate.type === 'city') score += 500;
  if (candidate.addresstype === 'city') score += 100;
  if (candidate.category === 'boundary') score += 50;
  return score;
}

class CityMapService {
  private getFallbackPlan(
    cityName: string,
    userLocation: OfflineRegionCenter,
  ): CityDownloadPlan {
    const fallbackCenter = { ...userLocation };
    const radiusKm = LOCATION_CONFIG.DEFAULT_OFFLINE_REGION_RADIUS_KM;
    const latitudeDelta = radiusKm / 111.32;
    const longitudeDelta =
      radiusKm /
      (111.32 *
        Math.max(0.1, Math.cos((fallbackCenter.latitude * Math.PI) / 180)));
    return {
      name: `${cityName} Area`,
      center: fallbackCenter,
      radiusKm,
      cityBounds: {
        minLat: fallbackCenter.latitude - latitudeDelta,
        maxLat: fallbackCenter.latitude + latitudeDelta,
        minLng: fallbackCenter.longitude - longitudeDelta,
        maxLng: fallbackCenter.longitude + longitudeDelta,
      },
      usedFallback: true,
    };
  }

  public async resolveDownloadPlan({
    cityName,
    countryCode,
    userLocation,
    signal,
  }: ResolveCityDownloadOptions): Promise<CityDownloadPlan> {
    const requestedCity = cityName?.trim() || '';
    if (!requestedCity) {
      throw new Error(
        'City name is not available yet. Wait for address detection and try again.',
      );
    }

    const countryFilter = countryCode?.trim().toLowerCase();
    const query = [
      `format=jsonv2`,
      `city=${encodeURIComponent(requestedCity)}`,
      `limit=8`,
      `addressdetails=1`,
      countryFilter ? `countrycodes=${encodeURIComponent(countryFilter)}` : '',
    ]
      .filter(Boolean)
      .join('&');

    try {
      const response = await fetchWithTimeout(
        `${NOMINATIM_SEARCH_URL}?${query}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
          },
          signal,
          timeoutMs: CITY_BOUNDARY_TIMEOUT_MS,
        },
      );
      if (!response.ok) {
        throw new Error(`City boundary lookup failed (${response.status}).`);
      }

      const payload = (await response.json()) as NominatimCityResult[];
      const candidates = Array.isArray(payload)
        ? payload
            .map(candidate => ({
              candidate,
              bounds: parseBounds(candidate.boundingbox),
            }))
            .filter(
              (
                entry,
              ): entry is {
                candidate: NominatimCityResult;
                bounds: RegionBoundingBox;
              } => entry.bounds !== null,
            )
            .sort(
              (first, second) =>
                getCandidateScore(
                  second.candidate,
                  second.bounds,
                  requestedCity,
                  userLocation,
                ) -
                getCandidateScore(
                  first.candidate,
                  first.bounds,
                  requestedCity,
                  userLocation,
                ),
            )
        : [];
      const best = candidates[0];
      if (!best) {
        throw new Error(
          `No downloadable boundary was found for ${requestedCity}.`,
        );
      }

      const coverage = getCoverageForBounds(best.bounds);
      if (coverage.radiusKm > MAX_CITY_RADIUS_KM) {
        throw new Error(
          `${requestedCity} is too large for one safe offline map download.`,
        );
      }
      return {
        name: `${requestedCity} City`,
        center: coverage.center,
        radiusKm: coverage.radiusKm,
        cityBounds: best.bounds,
        usedFallback: false,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (
        error instanceof Error &&
        (error.message.startsWith('No downloadable boundary') ||
          error.message.includes('too large'))
      ) {
        throw error;
      }
      return this.getFallbackPlan(requestedCity, userLocation);
    }
  }
}

export const cityMapService = new CityMapService();
