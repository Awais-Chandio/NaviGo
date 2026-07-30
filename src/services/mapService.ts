import { OfflineManager } from '@maplibre/maplibre-react-native';
import { connectivityService } from './connectivityService';
import { calculateBoundingBox } from '../utils/locationUtils';
import { logger } from '../utils/logger';

const TAG = 'MapService';

export type MapStylePreset = 'light' | 'dark' | 'satellite' | 'offline';

export interface MapStyleConfig {
  id: MapStylePreset;
  name: string;
  url: string;
  isVector: boolean;
}

export const MAP_STYLES: Record<MapStylePreset, MapStyleConfig> = {
  light: {
    id: 'light',
    name: 'OpenFreeMap Bright',
    url: 'https://tiles.openfreemap.org/styles/bright',
    isVector: true,
  },
  dark: {
    id: 'dark',
    name: 'OpenFreeMap Dark',
    url: 'https://tiles.openfreemap.org/styles/dark',
    isVector: true,
  },
  satellite: {
    id: 'satellite',
    name: 'OpenFreeMap Liberty',
    url: 'https://tiles.openfreemap.org/styles/liberty',
    isVector: true,
  },
  offline: {
    id: 'offline',
    name: 'Offline Local Style',
    url: 'https://tiles.openfreemap.org/styles/bright',
    isVector: true,
  },
};

class MapService {
  private currentPreset: MapStylePreset = 'light';

  constructor() {
    this.configureTileCacheLimit(50 * 1024 * 1024);
  }

  public setStylePreset(preset: MapStylePreset) {
    this.currentPreset = preset;
  }

  public getStylePreset(): MapStylePreset {
    return this.currentPreset;
  }

  public getActiveStyleUrl(): string {
    if (!connectivityService.isOnlineMode() || this.currentPreset === 'offline') {
      return MAP_STYLES.offline.url;
    }

    return MAP_STYLES[this.currentPreset]?.url || MAP_STYLES.light.url;
  }

  public getFitBoundsForCoordinates(coordinates: [number, number][]) {
    const bounds = calculateBoundingBox(coordinates);
    return {
      bounds,
      padding: { top: 100, right: 60, bottom: 240, left: 60 },
      duration: 1200,
    };
  }

  public async configureTileCacheLimit(maxSizeBytes: number = 50 * 1024 * 1024): Promise<void> {
    try {
      if (OfflineManager?.setMaximumAmbientCacheSize) {
        await OfflineManager.setMaximumAmbientCacheSize(maxSizeBytes);
      }
      logger.info(TAG, `Tile cache limit configured: ${Math.round(maxSizeBytes / (1024 * 1024))} MB`);
    } catch (err) {
      logger.warn(TAG, 'Error configuring tile cache limit:', err);
    }
  }
}

export const mapService = new MapService();
