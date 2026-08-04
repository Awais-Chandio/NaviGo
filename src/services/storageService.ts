import AsyncStorage from '@react-native-async-storage/async-storage';
import { SearchPlaceItem } from './searchService';
import { SavedPlace } from '../types/places';
import { savedPlacesService } from './SavedPlacesService';
import { logger } from '../utils/logger';
import { getHaversineDistance, isValidCoordinate } from '../utils/locationUtils';

export type { SavedPlace };

const RECENT_SEARCHES_KEY = '@navigo_recent_searches_v2';

class StorageService {
  private recentSearches: SearchPlaceItem[] = [];
  private asyncStorage = AsyncStorage;
  private initializationPromise: Promise<void>;
  private persistPromise: Promise<void> = Promise.resolve();

  constructor() {
    this.initializationPromise = this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    if (!this.asyncStorage) return;
    try {
      const storedSearches = await this.asyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (storedSearches) {
        const parsed: unknown = JSON.parse(storedSearches);
        if (Array.isArray(parsed)) {
          const sanitizedStoredSearches = parsed
            .map(item => this.sanitizeRecentSearch(item))
            .filter((item): item is SearchPlaceItem => item !== null)
            .slice(0, 10);
          // Preserve searches added while AsyncStorage was still loading.
          this.recentSearches = this.mergeRecentSearches(
            this.recentSearches,
            sanitizedStoredSearches,
          );
        }
      }
    } catch (e) {
      logger.warn('Storage', 'Recent-search load failed.', e);
    }
  }

  private async persistSearches(): Promise<void> {
    if (!this.asyncStorage) return;
    try {
      await this.asyncStorage.setItem(
        RECENT_SEARCHES_KEY,
        JSON.stringify(this.recentSearches),
      );
    } catch (e) {
      logger.warn('Storage', 'Recent-search persistence failed.', e);
    }
  }

  private sanitizeRecentSearch(item: unknown): SearchPlaceItem | null {
    if (!item || typeof item !== 'object') return null;
    const candidate = item as Partial<SearchPlaceItem>;
    if (
      (typeof candidate.id !== 'string' &&
        typeof candidate.id !== 'number') ||
      typeof candidate.title !== 'string' ||
      !candidate.title.trim() ||
      !isValidCoordinate(candidate.latitude, candidate.longitude, true)
    ) {
      return null;
    }

    return {
      id: candidate.id,
      title: candidate.title.trim(),
      subtitle:
        typeof candidate.subtitle === 'string' ? candidate.subtitle.trim() : '',
      latitude: candidate.latitude,
      longitude: candidate.longitude as number,
      displayName:
        typeof candidate.displayName === 'string'
          ? candidate.displayName.trim()
          : candidate.title.trim(),
      // Distance is derived from the live GPS fix when recents are displayed;
      // persisting it makes the same place show a stale distance next launch.
      distanceMeters: undefined,
      formattedDistance: undefined,
      categoryIcon: candidate.categoryIcon,
      categoryName: candidate.categoryName,
    };
  }

  public async initialize(): Promise<void> {
    return this.initializationPromise;
  }

  private isSameRecentPlace(
    first: SearchPlaceItem,
    second: SearchPlaceItem,
  ): boolean {
    if (String(first.id) === String(second.id)) return true;
    const firstTitle = first.title
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    const secondTitle = second.title
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    const separation = getHaversineDistance(
      first.latitude,
      first.longitude,
      second.latitude,
      second.longitude,
    );
    return separation < 5 || (firstTitle === secondTitle && separation < 100);
  }

  private mergeRecentSearches(
    preferred: SearchPlaceItem[],
    fallback: SearchPlaceItem[],
  ): SearchPlaceItem[] {
    const merged: SearchPlaceItem[] = [];
    for (const item of [...preferred, ...fallback]) {
      if (!merged.some(existing => this.isSameRecentPlace(existing, item))) {
        merged.push(item);
      }
      if (merged.length === 10) break;
    }
    return merged;
  }

  private queuePersist(): void {
    this.persistPromise = this.persistPromise
      .then(() => this.initializationPromise)
      .then(() => this.persistSearches())
      .catch(error => {
        logger.warn('Storage', 'Recent-search persistence queue failed.', error);
      });
  }

  public addRecentSearch(item: SearchPlaceItem): SearchPlaceItem[] {
    const sanitizedItem = this.sanitizeRecentSearch(item);
    if (!sanitizedItem) {
      logger.warn('Storage', 'Rejected invalid recent-search item.');
      return [...this.recentSearches];
    }
    this.recentSearches = this.recentSearches.filter(
      recent => !this.isSameRecentPlace(recent, sanitizedItem),
    );
    this.recentSearches.unshift(sanitizedItem);
    if (this.recentSearches.length > 10) {
      this.recentSearches.pop();
    }
    this.queuePersist();
    return [...this.recentSearches];
  }

  public getRecentSearches(): SearchPlaceItem[] {
    return [...this.recentSearches];
  }

  public async getRecentSearchesAsync(): Promise<SearchPlaceItem[]> {
    await this.initialize();
    return this.getRecentSearches();
  }

  public clearRecentSearches(): SearchPlaceItem[] {
    this.recentSearches = [];
    this.queuePersist();
    return [];
  }

  // Delegated saved places helpers
  public async getSavedPlacesAsync(): Promise<SavedPlace[]> {
    return savedPlacesService.getSavedPlaces();
  }

  public async savePlaceAsync(place: SavedPlace): Promise<SavedPlace[]> {
    return savedPlacesService.savePlace(place);
  }

  public async removeSavedPlaceAsync(id: string): Promise<SavedPlace[]> {
    return savedPlacesService.deletePlace(id);
  }
}

export const storageService = new StorageService();
