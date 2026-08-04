import { NearbySearchParams, NearbyPlace } from '../types/places';
import {
  INearbyPlacesRepository,
  OverpassNearbyPlacesRepository,
  CATEGORY_MAP,
} from '../repositories/NearbyPlacesRepository';
import {
  roadDistanceService,
  type DrivingDistanceProvider,
} from './RoadDistanceService';
import { connectivityService } from './connectivityService';
import { formatDistance } from '../utils/locationUtils';
import { isCallerAbort } from '../utils/networkUtils';
import { logger } from '../utils/logger';

export { CATEGORY_MAP };

export class NearbyPlacesService {
  private repository: INearbyPlacesRepository;
  private drivingDistanceProvider: DrivingDistanceProvider;

  constructor(
    repository?: INearbyPlacesRepository,
    drivingDistanceProvider?: DrivingDistanceProvider,
  ) {
    this.repository = repository || new OverpassNearbyPlacesRepository();
    this.drivingDistanceProvider =
      drivingDistanceProvider || roadDistanceService;
  }

  public setRepository(repository: INearbyPlacesRepository) {
    this.repository = repository;
  }

  public async searchNearby(
    params: NearbySearchParams,
    signal?: AbortSignal,
  ): Promise<NearbyPlace[]> {
    const places = await this.repository.searchNearby(params, signal);
    if (places.length === 0 || !connectivityService.isOnlineMode()) {
      return places;
    }

    try {
      const roadDistances =
        await this.drivingDistanceProvider.getDrivingDistances(
          { latitude: params.latitude, longitude: params.longitude },
          places.map(place => ({
            latitude: place.latitude,
            longitude: place.longitude,
          })),
          signal,
        );

      return places
        .map((place, index) => {
          const roadDistance = roadDistances[index];
          if (typeof roadDistance !== 'number') return place;
          return {
            ...place,
            distance: roadDistance,
            formattedDistance: formatDistance(roadDistance),
          };
        })
        .sort((first, second) => first.distance - second.distance);
    } catch (error) {
      if (isCallerAbort(error, signal)) throw error;
      logger.warn(
        'NearbyPlacesService',
        'Road-distance enrichment failed; using direct distance.',
        error,
      );
      return places;
    }
  }
}

export const nearbyPlacesService = new NearbyPlacesService();
