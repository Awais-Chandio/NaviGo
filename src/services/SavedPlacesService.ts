import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedPlace } from '../types/places';
import { logger } from '../utils/logger';
import { isValidCoordinate } from '../utils/locationUtils';

const SAVED_PLACES_KEY = '@navigo_saved_places_v2';

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
      candidate.address.trim().length > 0 &&
      isValidCoordinate(candidate.latitude, candidate.longitude, true) &&
      (typeof candidate.type === 'undefined' ||
        candidate.type === 'home' ||
        candidate.type === 'work' ||
        candidate.type === 'favorite' ||
        candidate.type === 'custom')
    );
  }

  private normalizePlace(place: SavedPlace): SavedPlace {
    const canonicalId =
      place.type === 'home' || place.type === 'work' ? place.type : place.id;
    return {
      ...place,
      id: canonicalId.trim(),
      name: place.name.trim(),
      address: place.address.trim(),
    };
  }

  private snapshot(): SavedPlace[] {
    return Array.from(this.inMemoryCache.values(), place => ({ ...place }));
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
                const normalized = this.normalizePlace(place);
                this.inMemoryCache.set(normalized.id, normalized);
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
    return this.snapshot();
  }

  public async getPlaceByType(
    type: 'home' | 'work' | 'favorite',
  ): Promise<SavedPlace | undefined> {
    await this.initializeIfNeeded();
    const canonical = this.inMemoryCache.get(type);
    const place =
      canonical ||
      Array.from(this.inMemoryCache.values()).find(p => p.type === type);
    return place ? { ...place } : undefined;
  }

  public async savePlace(place: SavedPlace): Promise<SavedPlace[]> {
    await this.initializeIfNeeded();
    if (!this.isValidPlace(place)) {
      throw new Error('A valid saved place is required.');
    }
    const updated = this.normalizePlace({
      ...place,
      createdAt: place.createdAt || new Date().toISOString(),
    });
    this.inMemoryCache.set(updated.id, updated);
    await this.queuePersist();
    return this.snapshot();
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
      const normalized = this.normalizePlace(merged);
      if (normalized.id !== id) {
        this.inMemoryCache.delete(id);
      }
      this.inMemoryCache.set(normalized.id, normalized);
      await this.queuePersist();
    }
    return this.snapshot();
  }

  public async deletePlace(id: string): Promise<SavedPlace[]> {
    await this.initializeIfNeeded();
    this.inMemoryCache.delete(id);
    await this.queuePersist();
    return this.snapshot();
  }
}

export const savedPlacesService = new SavedPlacesService();
