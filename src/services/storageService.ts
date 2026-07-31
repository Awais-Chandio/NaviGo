import AsyncStorage from '@react-native-async-storage/async-storage';
import { SearchPlaceItem } from './searchService';
import { SavedPlace } from '../types/places';
import { savedPlacesService } from './SavedPlacesService';
import { logger } from '../utils/logger';

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
          this.recentSearches = parsed
            .map(item => this.sanitizeRecentSearch(item))
            .filter((item): item is SearchPlaceItem => item !== null)
            .slice(0, 10);
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
      typeof candidate.latitude !== 'number' ||
      !Number.isFinite(candidate.latitude) ||
      candidate.latitude < -90 ||
      candidate.latitude > 90 ||
      typeof candidate.longitude !== 'number' ||
      !Number.isFinite(candidate.longitude) ||
      candidate.longitude < -180 ||
      candidate.longitude > 180
    ) {
      return null;
    }

    return {
      id: candidate.id,
      title: candidate.title,
      subtitle:
        typeof candidate.subtitle === 'string' ? candidate.subtitle : '',
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      displayName:
        typeof candidate.displayName === 'string'
          ? candidate.displayName
          : candidate.title,
      distanceMeters: candidate.distanceMeters,
      formattedDistance: candidate.formattedDistance,
      categoryIcon: candidate.categoryIcon,
      categoryName: candidate.categoryName,
    };
  }

  public async initialize(): Promise<void> {
    return this.initializationPromise;
  }

  private queuePersist(): void {
    this.persistPromise = this.persistPromise
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
      r => r.id.toString() !== sanitizedItem.id.toString(),
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
