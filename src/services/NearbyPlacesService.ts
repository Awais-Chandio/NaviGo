import { NearbySearchParams, NearbyPlace } from '../types/places';
import {
  INearbyPlacesRepository,
  OverpassNearbyPlacesRepository,
  CATEGORY_MAP,
} from '../repositories/NearbyPlacesRepository';

export { CATEGORY_MAP };

export class NearbyPlacesService {
  private repository: INearbyPlacesRepository;

  constructor(repository?: INearbyPlacesRepository) {
    this.repository = repository || new OverpassNearbyPlacesRepository();
  }

  public setRepository(repository: INearbyPlacesRepository) {
    this.repository = repository;
  }

  public async searchNearby(
    params: NearbySearchParams,
    signal?: AbortSignal,
  ): Promise<NearbyPlace[]> {
    return this.repository.searchNearby(params, signal);
  }
}

export const nearbyPlacesService = new NearbyPlacesService();
