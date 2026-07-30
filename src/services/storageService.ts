import { SearchPlaceItem } from './searchService';

export interface SavedPlace {
  id: string;
  type: 'home' | 'work' | 'favorite';
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
}

const RECENT_SEARCHES_KEY = '@my_places_tracker_recent_searches_v1';
const SAVED_PLACES_KEY = '@my_places_tracker_saved_places_v1';

class StorageService {
  private recentSearches: SearchPlaceItem[] = [];
  private savedPlaces: Map<string, SavedPlace> = new Map();
  private asyncStorage: any = null;

  constructor() {
    try {
      this.asyncStorage = require('@react-native-async-storage/async-storage').default;
      this.loadFromStorage();
    } catch {
      this.asyncStorage = null;
    }

    if (this.savedPlaces.size === 0) {
      this.savedPlaces.set('home', {
        id: 'home',
        type: 'home',
        title: 'Home',
        subtitle: 'Hyderabad, Sindh, Pakistan',
        latitude: 25.396,
        longitude: 68.3578,
      });
      this.savedPlaces.set('work', {
        id: 'work',
        type: 'work',
        title: 'Work',
        subtitle: 'Karachi Financial Center, Pakistan',
        latitude: 24.8607,
        longitude: 67.0011,
      });
      this.savedPlaces.set('centaurus', {
        id: 'centaurus',
        type: 'favorite',
        title: 'Centaurus Mall',
        subtitle: 'F-8, Islamabad, Pakistan',
        latitude: 33.7077,
        longitude: 73.0498,
      });
      this.savedPlaces.set('mazar', {
        id: 'mazar',
        type: 'favorite',
        title: 'Mazar-e-Quaid',
        subtitle: 'M.A. Jinnah Rd, Karachi, Pakistan',
        latitude: 24.8746,
        longitude: 67.0399,
      });
      this.savedPlaces.set('minar', {
        id: 'minar',
        type: 'favorite',
        title: 'Minar-e-Pakistan',
        subtitle: 'Greater Iqbal Park, Lahore, Pakistan',
        latitude: 31.5925,
        longitude: 74.3095,
      });
      this.savedPlaces.set('faisal_mosque', {
        id: 'faisal_mosque',
        type: 'favorite',
        title: 'Faisal Mosque',
        subtitle: 'Shah Faisal Ave, Islamabad, Pakistan',
        latitude: 33.7297,
        longitude: 73.0372,
      });
    }
  }

  private async loadFromStorage(): Promise<void> {
    if (!this.asyncStorage) return;
    try {
      const storedSearches = await this.asyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (storedSearches) {
        this.recentSearches = JSON.parse(storedSearches);
      }

      const storedSaved = await this.asyncStorage.getItem(SAVED_PLACES_KEY);
      if (storedSaved) {
        const parsed: SavedPlace[] = JSON.parse(storedSaved);
        parsed.forEach(p => this.savedPlaces.set(p.id, p));
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

  private async persistSavedPlaces(): Promise<void> {
    if (!this.asyncStorage) return;
    try {
      await this.asyncStorage.setItem(
        SAVED_PLACES_KEY,
        JSON.stringify(Array.from(this.savedPlaces.values())),
      );
    } catch (e) {
      console.warn('Persist saved places error:', e);
    }
  }

  public addRecentSearch(item: SearchPlaceItem): SearchPlaceItem[] {
    this.recentSearches = this.recentSearches.filter(
      r => r.id.toString() !== item.id.toString(),
    );
    this.recentSearches.unshift(item);
    if (this.recentSearches.length > 10) {
      this.recentSearches.pop();
    }
    this.persistSearches();
    return [...this.recentSearches];
  }

  public getRecentSearches(): SearchPlaceItem[] {
    return [...this.recentSearches];
  }

  public clearRecentSearches(): SearchPlaceItem[] {
    this.recentSearches = [];
    this.persistSearches();
    return [];
  }

  public savePlace(place: SavedPlace): SavedPlace[] {
    this.savedPlaces.set(place.id, place);
    this.persistSavedPlaces();
    return Array.from(this.savedPlaces.values());
  }

  public removeSavedPlace(id: string): SavedPlace[] {
    this.savedPlaces.delete(id);
    this.persistSavedPlaces();
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
