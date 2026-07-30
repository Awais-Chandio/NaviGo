import { RouteDetails } from './routingService';
import { logger } from '../utils/logger';

export class OfflineRoutingService {
  private readonly offlineGraphAvailable = false;

  public isAvailable(): boolean {
    return this.offlineGraphAvailable;
  }

  public async calculateOfflineRoute(
    _startLat: number,
    _startLng: number,
    _endLat: number,
    _endLng: number,
  ): Promise<RouteDetails | null> {
    logger.warn(
      'OfflineRouting',
      'No offline road graph is installed; refusing to create a straight-line driving route.',
    );
    return null;
  }
}

export const offlineRoutingService = new OfflineRoutingService();
export default offlineRoutingService;
