import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedPlace } from '../types/places';
import { logger } from '../utils/logger';

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
  private persistPromise: Promise<void> = Promise.resolve();

  private isValidPlace(place: unknown): place is SavedPlace {
    if (!place || typeof place !== 'object') return false;
    const candidate = place as Partial<SavedPlace>;
    return (
      typeof candidate.id === 'string' &&
      candidate.id.trim().length > 0 &&
      typeof candidate.name === 'string' &&
      candidate.name.trim().length > 0 &&
      typeof candidate.address === 'string' &&
      typeof candidate.latitude === 'number' &&
      Number.isFinite(candidate.latitude) &&
      candidate.latitude >= -90 &&
      candidate.latitude <= 90 &&
      typeof candidate.longitude === 'number' &&
      Number.isFinite(candidate.longitude) &&
      candidate.longitude >= -180 &&
      candidate.longitude <= 180
    );
  }

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
              if (this.isValidPlace(place)) {
                this.inMemoryCache.set(place.id, place);
              }
            });
          }
        }
      } catch (e) {
        logger.warn('SavedPlaces', 'Saved-place load failed.', e);
      } finally {
        this.isInitialized = true;
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  private async persist(): Promise<void> {
    const list = Array.from(this.inMemoryCache.values());
    await AsyncStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(list));
  }

  private queuePersist(): Promise<void> {
    const operation = this.persistPromise.then(() => this.persist());
    this.persistPromise = operation.catch(error => {
      logger.warn('SavedPlaces', 'Saved-place persistence failed.', error);
    });
    return operation;
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
    if (!this.isValidPlace(place)) {
      throw new Error('A valid saved place is required.');
    }
    const updated: SavedPlace = {
      ...place,
      createdAt: place.createdAt || new Date().toISOString(),
    };
    this.inMemoryCache.set(place.id, updated);
    await this.queuePersist();
    return Array.from(this.inMemoryCache.values());
  }

  public async updatePlace(
    id: string,
    updatedFields: Partial<SavedPlace>,
  ): Promise<SavedPlace[]> {
    await this.initializeIfNeeded();
    const existing = this.inMemoryCache.get(id);
    if (existing) {
      const merged: SavedPlace = { ...existing, ...updatedFields, id };
      if (!this.isValidPlace(merged)) {
        throw new Error('Saved-place update contains invalid data.');
      }
      this.inMemoryCache.set(id, merged);
      await this.queuePersist();
    }
    return Array.from(this.inMemoryCache.values());
  }

  public async deletePlace(id: string): Promise<SavedPlace[]> {
    await this.initializeIfNeeded();
    this.inMemoryCache.delete(id);
    await this.queuePersist();
    return Array.from(this.inMemoryCache.values());
  }
}

export const savedPlacesService = new SavedPlacesService();
