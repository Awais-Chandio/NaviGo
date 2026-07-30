import AsyncStorage from '@react-native-async-storage/async-storage';
import { SearchPlaceItem } from './searchService';
import { SavedPlace } from '../types/places';
import { savedPlacesService } from './SavedPlacesService';

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
          this.recentSearches = parsed.filter(
            (item): item is SearchPlaceItem =>
              !!item &&
              typeof item === 'object' &&
              'id' in item &&
              'title' in item &&
              typeof item.title === 'string' &&
              'latitude' in item &&
              typeof item.latitude === 'number' &&
              Number.isFinite(item.latitude) &&
              'longitude' in item &&
              typeof item.longitude === 'number' &&
              Number.isFinite(item.longitude),
          );
        }
      }
    } catch (e) {
      console.warn('StorageService load error:', e);
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
      console.warn('Persist searches error:', e);
    }
  }

  public async initialize(): Promise<void> {
    return this.initializationPromise;
  }

  private queuePersist(): void {
    this.persistPromise = this.persistPromise
      .then(() => this.persistSearches())
      .catch(error => {
        console.warn('Persist searches queue error:', error);
      });
  }

  public addRecentSearch(item: SearchPlaceItem): SearchPlaceItem[] {
    this.recentSearches = this.recentSearches.filter(
      r => r.id.toString() !== item.id.toString(),
    );
    this.recentSearches.unshift(item);
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
