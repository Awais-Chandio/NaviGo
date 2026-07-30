import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedPlace } from '../types/places';

const SAVED_PLACES_KEY = '@navigo_saved_places_v2';

export const DEFAULT_HOME_PLACE: SavedPlace = {
  id: 'home',
  name: 'Home',
  address: 'Prince Town, Hyderabad',
  latitude: 25.396,
  longitude: 68.3578,
  type: 'home',
};

export const DEFAULT_WORK_PLACE: SavedPlace = {
  id: 'work',
  name: 'Work',
  address: 'Gor Colony, Noor Tower, Hyderabad',
  latitude: 25.405,
  longitude: 68.368,
  type: 'work',
};

export class SavedPlacesService {
  private inMemoryCache: Map<string, SavedPlace> = new Map();
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  private async initializeIfNeeded(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(SAVED_PLACES_KEY);
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            parsed.forEach(place => {
              if (
                place &&
                typeof place === 'object' &&
                'id' in place &&
                typeof place.id === 'string' &&
                'name' in place &&
                typeof place.name === 'string' &&
                'latitude' in place &&
                typeof place.latitude === 'number' &&
                Number.isFinite(place.latitude) &&
                'longitude' in place &&
                typeof place.longitude === 'number' &&
                Number.isFinite(place.longitude)
              ) {
                this.inMemoryCache.set(place.id, place as SavedPlace);
              }
            });
          }
        }
      } catch (e) {
        console.warn('SavedPlacesService load error:', e);
      } finally {
        this.isInitialized = true;
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  private async persist(): Promise<void> {
    const list = Array.from(this.inMemoryCache.values());
    try {
      await AsyncStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('SavedPlacesService persist error:', e);
    }
  }

  public async getSavedPlaces(): Promise<SavedPlace[]> {
    await this.initializeIfNeeded();
    return Array.from(this.inMemoryCache.values());
  }

  public async getPlaceByType(
    type: 'home' | 'work' | 'favorite',
  ): Promise<SavedPlace | undefined> {
    await this.initializeIfNeeded();
    return Array.from(this.inMemoryCache.values()).find(
      p => p.type === type || p.id === type,
    );
  }

  public async savePlace(place: SavedPlace): Promise<SavedPlace[]> {
    await this.initializeIfNeeded();
    const updated: SavedPlace = {
      ...place,
      createdAt: place.createdAt || new Date().toISOString(),
    };
    this.inMemoryCache.set(place.id, updated);
    await this.persist();
    return Array.from(this.inMemoryCache.values());
  }

  public async updatePlace(
    id: string,
    updatedFields: Partial<SavedPlace>,
  ): Promise<SavedPlace[]> {
    await this.initializeIfNeeded();
    const existing = this.inMemoryCache.get(id);
    if (existing) {
      const merged: SavedPlace = { ...existing, ...updatedFields };
      this.inMemoryCache.set(id, merged);
      await this.persist();
    }
    return Array.from(this.inMemoryCache.values());
  }

  public async deletePlace(id: string): Promise<SavedPlace[]> {
    await this.initializeIfNeeded();
    this.inMemoryCache.delete(id);
    await this.persist();
    return Array.from(this.inMemoryCache.values());
  }
}

export const savedPlacesService = new SavedPlacesService();
