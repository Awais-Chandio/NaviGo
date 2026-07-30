import {
  searchService,
  type SearchPlaceItem,
  type SearchOptions,
} from './searchService';

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

  public setProvider(provider: SearchProvider) {
    this.activeProvider = provider;
    console.log(`[GeocodingService]: Switched provider to ${provider.name}`);
  }

  public getActiveProviderName(): string {
    return this.activeProvider.name;
  }

  public async searchPlaces(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchPlaceItem[]> {
    return this.activeProvider.search(query, options);
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
