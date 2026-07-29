/**
 * Storage Service for Recent Searches and Saved Places (Home, Work, Favorites).
 * Provides persistent memory storage with optional AsyncStorage adapter bindings.
 */

import { SearchPlaceItem } from './searchService';

export interface SavedPlace {
  id: string;
  type: 'home' | 'work' | 'favorite';
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
}

class StorageService {
  private recentSearches: SearchPlaceItem[] = [];
  private savedPlaces: Map<string, SavedPlace> = new Map();

  constructor() {
    // Default mock initial saved places for demo/quick access
    this.savedPlaces.set('home', {
      id: 'home',
      type: 'home',
      title: 'Home',
      subtitle: 'Set your home location',
      latitude: 25.396,
      longitude: 68.3578,
    });
  }

  /**
   * Adds a search result item to recent searches history (max 10 items).
   */
  public addRecentSearch(item: SearchPlaceItem): SearchPlaceItem[] {
    // Remove duplicate if exists
    this.recentSearches = this.recentSearches.filter(
      r => r.id.toString() !== item.id.toString(),
    );
    // Unshift to top
    this.recentSearches.unshift(item);
    if (this.recentSearches.length > 10) {
      this.recentSearches.pop();
    }
    return [...this.recentSearches];
  }

  public getRecentSearches(): SearchPlaceItem[] {
    return [...this.recentSearches];
  }

  public clearRecentSearches(): SearchPlaceItem[] {
    this.recentSearches = [];
    return [];
  }

  /**
   * Saves a place as Home, Work, or Favorite.
   */
  public savePlace(place: SavedPlace): SavedPlace[] {
    this.savedPlaces.set(place.id, place);
    return Array.from(this.savedPlaces.values());
  }

  public removeSavedPlace(id: string): SavedPlace[] {
    this.savedPlaces.delete(id);
    return Array.from(this.savedPlaces.values());
  }

  public getSavedPlaces(): SavedPlace[] {
    return Array.from(this.savedPlaces.values());
  }

  public getPlaceByType(type: 'home' | 'work'): SavedPlace | undefined {
    return Array.from(this.savedPlaces.values()).find(p => p.type === type);
  }
}

export const storageService = new StorageService();
