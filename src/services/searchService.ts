import {
  ISearchRepository,
  PhotonSearchRepository,
  detectCategory,
  parseNominatimTitleAndSubtitle,
} from '../repositories/SearchRepository';
import { logger } from '../utils/logger';

export interface SearchPlaceItem {
  id: string | number;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  displayName: string;
  distanceMeters?: number;
  formattedDistance?: string;
  categoryIcon?: string;
  categoryName?: string;
  raw?: unknown;
}

export interface SearchResult {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category: string;
  distanceMeters?: number;
  formattedDistance?: string;
  source?: 'recent' | 'saved' | 'nearby' | 'search' | 'category';
}

export interface ReverseGeocodeDetails {
  displayName: string;
  detectedArea: string;
  city?: string;
  countryCode?: string;
}

export interface SearchOptions {
  userLocation?: {
    latitude: number;
    longitude: number;
  };
  countryCode?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface UnifiedSearchSuggestions {
  recent: SearchResult[];
  saved: SearchResult[];
  nearby: SearchResult[];
  searchResults: SearchResult[];
}

export interface PlacesProvider {
  searchPlaces(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchPlaceItem[]>;
  reverseGeocode(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<string>;
}

export { detectCategory, parseNominatimTitleAndSubtitle };

export class NominatimPlacesProvider implements PlacesProvider {
  private repository: ISearchRepository = new PhotonSearchRepository();

  async searchPlaces(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchPlaceItem[]> {
    return this.repository.searchPlaces(query, options);
  }

  async reverseGeocode(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.repository.reverseGeocode(latitude, longitude, signal);
  }

  async reverseGeocodeDetails(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<ReverseGeocodeDetails> {
    return this.repository.reverseGeocodeDetails(latitude, longitude, signal);
  }
}

export class OfflinePlacesProvider implements PlacesProvider {
  async searchPlaces(
    query: string,
    _options?: SearchOptions,
  ): Promise<SearchPlaceItem[]> {
    logger.warn(
      'Search',
      'Offline place index is not installed; search is unavailable.',
      { queryLength: query.trim().length },
    );
    return [];
  }

  async reverseGeocode(
    latitude: number,
    longitude: number,
    _signal?: AbortSignal,
  ): Promise<string> {
    logger.warn('Search', 'Offline reverse-geocoding index is not installed.');
    return `Offline Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
  }
}

export class SearchService {
  private repository: ISearchRepository;

  constructor(repository?: ISearchRepository) {
    this.repository = repository || new PhotonSearchRepository();
  }

  public setRepository(repository: ISearchRepository) {
    this.repository = repository;
  }

  public setOnlineProvider(_provider: PlacesProvider) {
    // Kept for backward compatibility
  }

  public setOfflineProvider(_provider: PlacesProvider) {
    // Kept for backward compatibility
  }

  public async searchPlaces(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchPlaceItem[]> {
    return this.repository.searchPlaces(query, options);
  }

  public async reverseGeocode(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.repository.reverseGeocode(latitude, longitude, signal);
  }

  public async reverseGeocodeDetails(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<ReverseGeocodeDetails> {
    return this.repository.reverseGeocodeDetails(latitude, longitude, signal);
  }

  public async search(
    query: string,
    userLocation?: { latitude: number; longitude: number },
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const items = await this.searchPlaces(query, { userLocation, signal });
    return items.map(item => ({
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
  }

  public async getSuggestions(
    query: string,
    userLocation?: { latitude: number; longitude: number },
    signal?: AbortSignal,
  ): Promise<UnifiedSearchSuggestions> {
    return this.repository.getSuggestions(query, userLocation, signal);
  }
}

export const searchService = new SearchService();

export function setPlacesProvider(provider: PlacesProvider) {
  searchService.setOnlineProvider(provider);
}

export async function searchPlaces(
  query: string,
  options?: SearchOptions,
): Promise<SearchPlaceItem[]> {
  return searchService.searchPlaces(query, options);
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<string> {
  return searchService.reverseGeocode(latitude, longitude, signal);
}

export async function reverseGeocodeDetails(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeDetails> {
  return searchService.reverseGeocodeDetails(latitude, longitude, signal);
}
