import {
  searchService,
  type SearchPlaceItem,
  type SearchOptions,
} from './searchService';
import { NominatimSearchRepository } from '../repositories/SearchRepository';
import { logger } from '../utils/logger';
import { isCallerAbort } from '../utils/networkUtils';
import {
  formatDistance,
  getHaversineDistance,
  isValidCoordinate,
} from '../utils/locationUtils';

export interface SearchProvider {
  name: string;
  search(query: string, options?: SearchOptions): Promise<SearchPlaceItem[]>;
  reverseGeocode(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<string>;
}

class UnifiedGeocodingProvider implements SearchProvider {
  public name = 'Unified Geocoding Provider';

  public async search(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchPlaceItem[]> {
    return searchService.searchPlaces(query, options);
  }

  public async reverseGeocode(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return searchService.reverseGeocode(latitude, longitude, signal);
  }
}

class GeocodingService {
  private activeProvider: SearchProvider = new UnifiedGeocodingProvider();
  private categorySearchRepository = new NominatimSearchRepository();

  public setProvider(provider: SearchProvider) {
    this.activeProvider = provider;
    logger.info('Search', 'Geocoding provider changed.', {
      provider: provider.name,
    });
  }

  public getActiveProviderName(): string {
    return this.activeProvider.name;
  }

  public async searchPlaces(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchPlaceItem[]> {
    const providerResults = await this.activeProvider.search(query, options);
    return this.normalizeResults(providerResults, options);
  }

  /**
   * Explicit category taps are regular searches, not type-ahead autocomplete,
   * so they may safely use the existing bounded Nominatim repository when
   * Overpass is unavailable. Typed search remains on Photon.
   */
  public async searchCategoryPlaces(
    query: string,
    options: SearchOptions & { radiusMeters: number },
  ): Promise<SearchPlaceItem[]> {
    try {
      const categoryResults = this.normalizeResults(
        await this.categorySearchRepository.searchPlaces(query, options),
        options,
      ).filter(
        result =>
          typeof result.distanceMeters === 'number' &&
          result.distanceMeters <= options.radiusMeters,
      );
      if (categoryResults.length > 0) {
        return categoryResults;
      }
    } catch (error) {
      if (isCallerAbort(error, options.signal)) {
        throw error;
      }
      logger.info(
        'Search',
        'Bounded category search unavailable; trying Photon fallback.',
        error,
      );
    }

    return this.searchPlaces(query, options);
  }

  private normalizeResults(
    providerResults: SearchPlaceItem[],
    options?: SearchOptions,
  ): SearchPlaceItem[] {
    const results = providerResults.filter(
      result =>
        typeof result.title === 'string' &&
        result.title.trim().length > 0 &&
        isValidCoordinate(result.latitude, result.longitude, true),
    );
    const origin = options?.userLocation;
    const hasValidOrigin =
      origin &&
      isValidCoordinate(origin.latitude, origin.longitude, true);

    const withDirectDistances = () =>
      results.map(result => {
        const directDistance = hasValidOrigin
          ? Math.round(
              getHaversineDistance(
                origin.latitude,
                origin.longitude,
                result.latitude,
                result.longitude,
              ),
            )
          : undefined;
        return {
          ...result,
          distanceMeters: directDistance,
          formattedDistance:
            typeof directDistance === 'number'
              ? formatDistance(directDistance)
              : undefined,
        };
      });

    return withDirectDistances();
  }

  public async reverseGeocode(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.activeProvider.reverseGeocode(latitude, longitude, signal);
  }
}

export const geocodingService = new GeocodingService();
