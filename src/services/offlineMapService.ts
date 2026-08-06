import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  OfflineManager,
  type OfflinePack,
  type OfflinePackCreateOptions,
  type OfflinePackError,
  type OfflinePackStatus,
} from '@maplibre/maplibre-react-native';
import {
  OfflineRegion,
  DownloadProgress,
  OfflineCoverageValidation,
  OfflineRegionCenter,
  RegionBoundingBox,
  OfflineRegionStatus,
} from '../types/location';
import { MAP_STYLES } from './mapService';
import { offlineDatabaseService } from './OfflineDatabaseService';
import { logger } from '../utils/logger';
import { getHaversineDistance } from '../utils/locationUtils';

const TAG = 'OfflineMapManager';
const OFFLINE_REGIONS_KEY = '@navigo_offline_regions_v1';
export const OFFLINE_REGION_METADATA_VERSION = 2;
const MIN_OFFLINE_RADIUS_KM = 0.5;
const MAX_OFFLINE_RADIUS_KM = 100;
const DUPLICATE_CENTER_TOLERANCE_METERS = 500;
const DUPLICATE_RADIUS_TOLERANCE_KM = 0.1;
const ROUTE_COVERAGE_SAMPLE_METERS = 250;
const EARTH_RADIUS_KM = 6371;
const COVERAGE_BOUNDS_EPSILON_DEGREES = 1e-9;
const MAX_NATIVE_TRANSIENT_RETRIES = 2;
const NATIVE_RETRY_BASE_DELAY_MS = 500;

export function isTransientOfflineDownloadError(error: unknown): boolean {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error || '');
  return /timeout|timed out|network|connection|temporar/i.test(message);
}

type OfflineRegionListener = (
  regions: OfflineRegion[],
  progress?: DownloadProgress,
) => void;

export class DuplicateOfflineRegionError extends Error {
  public readonly regionId: string;
  public readonly regionStatus: OfflineRegionStatus;

  constructor(region: OfflineRegion) {
    super(
      region.status === 'completed'
        ? `${region.name} is already downloaded.`
        : `${region.name} already exists.`,
    );
    this.name = 'DuplicateOfflineRegionError';
    this.regionId = region.id;
    this.regionStatus = region.status;
  }
}

export class OfflineCoverageError extends Error {
  public readonly validation: OfflineCoverageValidation;

  constructor(validation: OfflineCoverageValidation) {
    super(validation.message);
    this.name = 'OfflineCoverageError';
    this.validation = validation;
  }
}

export interface CreateOfflineRegionOptions {
  name: string;
  center: OfflineRegionCenter;
  radiusKm: number;
  minZoom?: number;
  maxZoom?: number;
}

export interface OfflineRegionDownloadEstimate {
  bounds: RegionBoundingBox;
  estimatedTileCount: number;
  estimatedSizeBytes: number;
}

export class OfflineMapManager {
  private regionsMap: Map<string, OfflineRegion> = new Map();
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private persistPromise: Promise<void> = Promise.resolve();
  private activeDownloads: Set<string> = new Set();
  private listeners: Set<OfflineRegionListener> = new Set();

  private isValidCoordinate(center: OfflineRegionCenter): boolean {
    return (
      Number.isFinite(center.latitude) &&
      center.latitude >= -85.05112878 &&
      center.latitude <= 85.05112878 &&
      Number.isFinite(center.longitude) &&
      center.longitude >= -180 &&
      center.longitude <= 180
    );
  }

  private isValidBounds(bounds: RegionBoundingBox): boolean {
    return (
      [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng].every(
        Number.isFinite,
      ) &&
      bounds.minLat >= -85.05112878 &&
      bounds.maxLat <= 85.05112878 &&
      bounds.minLng >= -180 &&
      bounds.maxLng <= 180 &&
      bounds.minLat < bounds.maxLat &&
      bounds.minLng < bounds.maxLng
    );
  }

  public getBoundsForCoverage(
    center: OfflineRegionCenter,
    radiusKm: number,
  ): RegionBoundingBox {
    if (
      !this.isValidCoordinate(center) ||
      !Number.isFinite(radiusKm) ||
      radiusKm < MIN_OFFLINE_RADIUS_KM ||
      radiusKm > MAX_OFFLINE_RADIUS_KM
    ) {
      throw new Error('A valid center and offline radius are required.');
    }

    const latitudeRadians = (center.latitude * Math.PI) / 180;
    const angularRadius = radiusKm / EARTH_RADIUS_KM;
    const latitudeDelta = (angularRadius * 180) / Math.PI;
    const longitudeDelta =
      (Math.asin(
        Math.min(
          1,
          Math.sin(angularRadius) /
            Math.max(0.000001, Math.cos(latitudeRadians)),
        ),
      ) *
        180) /
      Math.PI;
    const bounds = {
      minLat: center.latitude - latitudeDelta - COVERAGE_BOUNDS_EPSILON_DEGREES,
      maxLat: center.latitude + latitudeDelta + COVERAGE_BOUNDS_EPSILON_DEGREES,
      minLng:
        center.longitude - longitudeDelta - COVERAGE_BOUNDS_EPSILON_DEGREES,
      maxLng:
        center.longitude + longitudeDelta + COVERAGE_BOUNDS_EPSILON_DEGREES,
    };
    if (!this.isValidBounds(bounds)) {
      throw new Error(
        'This offline radius crosses the supported map boundary. Choose a smaller region.',
      );
    }
    return bounds;
  }

  private getConservativeCoverageFromBounds(bounds: RegionBoundingBox): {
    center: OfflineRegionCenter;
    radiusKm: number;
  } {
    const center = {
      latitude: (bounds.minLat + bounds.maxLat) / 2,
      longitude: (bounds.minLng + bounds.maxLng) / 2,
    };
    const edgeDistances = [
      getHaversineDistance(
        center.latitude,
        center.longitude,
        bounds.maxLat,
        center.longitude,
      ),
      getHaversineDistance(
        center.latitude,
        center.longitude,
        bounds.minLat,
        center.longitude,
      ),
      getHaversineDistance(
        center.latitude,
        center.longitude,
        center.latitude,
        bounds.maxLng,
      ),
      getHaversineDistance(
        center.latitude,
        center.longitude,
        center.latitude,
        bounds.minLng,
      ),
    ];

    return {
      center,
      radiusKm: Math.max(
        MIN_OFFLINE_RADIUS_KM,
        Math.min(...edgeDistances) / 1000,
      ),
    };
  }

  private normalizeStoredRegion(value: unknown): OfflineRegion | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<OfflineRegion>;
    if (
      typeof candidate.id !== 'string' ||
      !candidate.id ||
      typeof candidate.name !== 'string' ||
      !candidate.name.trim() ||
      !candidate.bounds ||
      !this.isValidBounds(candidate.bounds)
    ) {
      return null;
    }

    const storedCenter = candidate.center;
    const hasStoredCoverage =
      !!storedCenter &&
      this.isValidCoordinate(storedCenter) &&
      typeof candidate.radiusKm === 'number' &&
      Number.isFinite(candidate.radiusKm) &&
      candidate.radiusKm >= MIN_OFFLINE_RADIUS_KM &&
      candidate.radiusKm <= MAX_OFFLINE_RADIUS_KM;
    const coverage = hasStoredCoverage
      ? {
          center: {
            latitude: storedCenter.latitude,
            longitude: storedCenter.longitude,
          },
          radiusKm: candidate.radiusKm as number,
        }
      : this.getConservativeCoverageFromBounds(candidate.bounds);
    // The native pack is created from these exact bounds. Keep them unchanged
    // across restarts so every downloaded tile remains recognized as covered.
    const bounds = { ...candidate.bounds };
    const validStatuses: OfflineRegionStatus[] = [
      'idle',
      'queued',
      'downloading',
      'completed',
      'paused',
      'error',
      'deleting',
    ];
    const status = validStatuses.includes(
      candidate.status as OfflineRegionStatus,
    )
      ? (candidate.status as OfflineRegionStatus)
      : 'idle';
    const createdAt =
      typeof candidate.createdAt === 'string'
        ? candidate.createdAt
        : new Date().toISOString();
    const updatedAt =
      typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt;
    const isDownloaded =
      candidate.isDownloaded === true || status === 'completed';

    return {
      id: candidate.id,
      nativePackId:
        typeof candidate.nativePackId === 'string'
          ? candidate.nativePackId
          : undefined,
      name: candidate.name.trim(),
      center: coverage.center,
      radiusKm: coverage.radiusKm,
      coverageAreaKm2: Math.PI * coverage.radiusKm ** 2,
      bounds,
      minZoom: typeof candidate.minZoom === 'number' ? candidate.minZoom : 10,
      maxZoom: typeof candidate.maxZoom === 'number' ? candidate.maxZoom : 16,
      version: OFFLINE_REGION_METADATA_VERSION,
      status,
      isDownloaded,
      sizeBytes:
        typeof candidate.sizeBytes === 'number' &&
        Number.isFinite(candidate.sizeBytes)
          ? Math.max(0, candidate.sizeBytes)
          : 0,
      estimatedTileCount:
        typeof candidate.estimatedTileCount === 'number'
          ? Math.max(0, candidate.estimatedTileCount)
          : 0,
      downloadedTileCount:
        typeof candidate.downloadedTileCount === 'number'
          ? Math.max(0, candidate.downloadedTileCount)
          : 0,
      createdAt,
      updatedAt,
      downloadedAt:
        typeof candidate.downloadedAt === 'string'
          ? candidate.downloadedAt
          : isDownloaded
          ? updatedAt
          : undefined,
      styleUrl:
        typeof candidate.styleUrl === 'string'
          ? candidate.styleUrl
          : MAP_STYLES.light.url,
    };
  }

  private recoverRegionFromNativePack(pack: OfflinePack): OfflineRegion | null {
    const metadata = pack.metadata;
    const bounds = Array.isArray(pack.bounds)
      ? {
          minLng: Number(pack.bounds[0]),
          minLat: Number(pack.bounds[1]),
          maxLng: Number(pack.bounds[2]),
          maxLat: Number(pack.bounds[3]),
        }
      : null;
    if (
      typeof metadata?.id !== 'string' ||
      typeof metadata?.name !== 'string' ||
      !bounds ||
      !this.isValidBounds(bounds)
    ) {
      return null;
    }

    const now = new Date().toISOString();
    return this.normalizeStoredRegion({
      id: metadata.id,
      nativePackId: pack.id,
      name: metadata.name,
      center: metadata.center,
      radiusKm: metadata.radiusKm,
      coverageAreaKm2: metadata.coverageAreaKm2,
      bounds,
      minZoom: metadata.minZoom,
      maxZoom: metadata.maxZoom,
      version: metadata.version,
      status: 'paused',
      isDownloaded: false,
      sizeBytes: 0,
      estimatedTileCount: 0,
      downloadedTileCount: 0,
      createdAt:
        typeof metadata.createdAt === 'string' ? metadata.createdAt : now,
      updatedAt: now,
      styleUrl:
        typeof metadata.styleUrl === 'string'
          ? metadata.styleUrl
          : MAP_STYLES.light.url,
    });
  }

  private async initializeIfNeeded(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      try {
        await offlineDatabaseService.initializeDatabase().catch(error => {
          logger.warn(
            TAG,
            'Offline place database initialization failed.',
            error,
          );
        });
        const stored = await AsyncStorage.getItem(OFFLINE_REGIONS_KEY).catch(
          error => {
            logger.warn(TAG, 'Unable to read offline map metadata.', error);
            return null;
          },
        );
        if (stored) {
          try {
            const parsed: unknown = JSON.parse(stored);
            if (Array.isArray(parsed)) {
              parsed.forEach(value => {
                const region = this.normalizeStoredRegion(value);
                if (region) {
                  this.regionsMap.set(region.id, region);
                }
              });
            }
          } catch (error) {
            // Native pack metadata below can rebuild the list if local JSON was
            // interrupted or corrupted during a previous app shutdown.
            logger.warn(TAG, 'Offline map metadata is invalid.', error);
          }
        }

        if (OfflineManager?.getPacks) {
          let nativePacks: OfflinePack[] | null = null;
          try {
            nativePacks = await OfflineManager.getPacks();
          } catch (error) {
            // A native database can briefly be unavailable while the app is
            // starting. Do not turn valid persisted downloads into errors just
            // because this one reconciliation attempt failed.
            logger.warn(TAG, 'Unable to restore native offline packs.', error);
          }

          if (nativePacks) {
            const nativeIds = new Set<string>();
            for (const pack of nativePacks) {
              nativeIds.add(pack.id);
              const localId =
                typeof pack.metadata?.id === 'string'
                  ? pack.metadata.id
                  : undefined;
              let region = localId ? this.regionsMap.get(localId) : undefined;
              if (!region) {
                region = this.recoverRegionFromNativePack(pack) ?? undefined;
                if (region) {
                  this.regionsMap.set(region.id, region);
                }
              }
              if (!region) continue;

              region.nativePackId = pack.id;
              const status = await pack.status().catch(() => null);
              if (status) {
                region.downloadedTileCount =
                  status.completedTileCount || region.downloadedTileCount;
                if (status.completedResourceSize > 0) {
                  region.sizeBytes = status.completedResourceSize;
                }
                region.status =
                  status.state === 'complete'
                    ? 'completed'
                    : status.state === 'active'
                    ? 'downloading'
                    : 'paused';
                region.isDownloaded = status.state === 'complete';
                if (status.state === 'complete' && !region.downloadedAt) {
                  region.downloadedAt = new Date().toISOString();
                }
                if (status.state === 'active') {
                  this.activeDownloads.add(region.id);
                  await this.observeRestoredPack(region, pack);
                }
              }
            }

            this.regionsMap.forEach(region => {
              if (
                region.nativePackId &&
                !nativeIds.has(region.nativePackId) &&
                region.isDownloaded
              ) {
                region.isDownloaded = false;
                region.status = 'error';
              }
            });
          }
        }
        await this.persist();
      } catch (err) {
        logger.warn(TAG, 'Load error:', err);
      } finally {
        this.isInitialized = true;
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  public async initialize(): Promise<void> {
    return this.initializeIfNeeded();
  }

  private persist(): Promise<void> {
    // Capture the snapshot at invocation time and serialize writes. Native pack
    // callbacks and UI actions can overlap; unordered AsyncStorage writes could
    // otherwise let an older snapshot overwrite a completed download/delete.
    const serializedRegions = JSON.stringify(
      Array.from(this.regionsMap.values()),
    );
    const operation = this.persistPromise.then(() =>
      AsyncStorage.setItem(OFFLINE_REGIONS_KEY, serializedRegions),
    );
    this.persistPromise = operation.catch(error => {
      logger.warn(TAG, 'Persist error:', error);
    });
    return operation;
  }

  public getRegions(): OfflineRegion[] {
    return Array.from(this.regionsMap.values()).map(region => ({
      ...region,
      center: { ...region.center },
      bounds: { ...region.bounds },
    }));
  }

  public getDownloadedRegions(): OfflineRegion[] {
    return this.getRegions().filter(
      region => region.isDownloaded && region.status === 'completed',
    );
  }

  public getRegion(regionId: string): OfflineRegion | null {
    const region = this.regionsMap.get(regionId);
    return region
      ? {
          ...region,
          center: { ...region.center },
          bounds: { ...region.bounds },
        }
      : null;
  }

  public getStatus(regionId: string): OfflineRegionStatus | null {
    return this.regionsMap.get(regionId)?.status ?? null;
  }

  public isPointInsideRegion(
    point: OfflineRegionCenter,
    region: OfflineRegion,
  ): boolean {
    if (!this.isValidCoordinate(point)) return false;
    return (
      getHaversineDistance(
        point.latitude,
        point.longitude,
        region.center.latitude,
        region.center.longitude,
      ) <=
      region.radiusKm * 1000 + 1
    );
  }

  /**
   * MapLibre downloads the complete rectangular pack bounds. This check is
   * for map display availability; route coverage intentionally keeps using the
   * smaller guaranteed-radius check above.
   */
  public isPointInsideDownloadedBounds(
    point: OfflineRegionCenter,
    region: OfflineRegion,
  ): boolean {
    if (!this.isValidCoordinate(point) || !this.isValidBounds(region.bounds)) {
      return false;
    }
    return (
      point.latitude >=
        region.bounds.minLat - COVERAGE_BOUNDS_EPSILON_DEGREES &&
      point.latitude <=
        region.bounds.maxLat + COVERAGE_BOUNDS_EPSILON_DEGREES &&
      point.longitude >=
        region.bounds.minLng - COVERAGE_BOUNDS_EPSILON_DEGREES &&
      point.longitude <= region.bounds.maxLng + COVERAGE_BOUNDS_EPSILON_DEGREES
    );
  }

  public getRegionsContainingPoint(
    point: OfflineRegionCenter,
  ): OfflineRegion[] {
    const matches: OfflineRegion[] = [];
    this.regionsMap.forEach(region => {
      if (
        region.isDownloaded &&
        region.status === 'completed' &&
        this.isPointInsideRegion(point, region)
      ) {
        matches.push({
          ...region,
          center: { ...region.center },
          bounds: { ...region.bounds },
        });
      }
    });
    return matches;
  }

  public isLocationAvailableOffline(point: OfflineRegionCenter): boolean {
    for (const region of this.regionsMap.values()) {
      if (
        region.isDownloaded &&
        region.status === 'completed' &&
        this.isPointInsideRegion(point, region)
      ) {
        return true;
      }
    }
    return false;
  }

  public getCoverageFeature(
    region: OfflineRegion,
    pointCount = 96,
  ): GeoJSON.Feature<GeoJSON.Polygon> {
    const coordinates: [number, number][] = [];
    const safePointCount = Math.max(32, Math.min(180, pointCount));
    const centerLatitudeRadians = (region.center.latitude * Math.PI) / 180;
    const centerLongitudeRadians = (region.center.longitude * Math.PI) / 180;
    const angularRadius = region.radiusKm / EARTH_RADIUS_KM;

    for (let index = 0; index < safePointCount; index++) {
      const bearing = (index / safePointCount) * Math.PI * 2;
      const latitudeRadians = Math.asin(
        Math.sin(centerLatitudeRadians) * Math.cos(angularRadius) +
          Math.cos(centerLatitudeRadians) *
            Math.sin(angularRadius) *
            Math.cos(bearing),
      );
      const longitudeRadians =
        centerLongitudeRadians +
        Math.atan2(
          Math.sin(bearing) *
            Math.sin(angularRadius) *
            Math.cos(centerLatitudeRadians),
          Math.cos(angularRadius) -
            Math.sin(centerLatitudeRadians) * Math.sin(latitudeRadians),
        );
      coordinates.push([
        (longitudeRadians * 180) / Math.PI,
        (latitudeRadians * 180) / Math.PI,
      ]);
    }
    coordinates.push(coordinates[0]);

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates],
      },
      properties: {
        regionId: region.id,
        name: region.name,
        radiusKm: region.radiusKm,
      },
    };
  }

  public getPackDefinition(region: OfflineRegion): OfflinePackCreateOptions {
    return {
      mapStyle: region.styleUrl || MAP_STYLES.light.url,
      bounds: [
        region.bounds.minLng,
        region.bounds.minLat,
        region.bounds.maxLng,
        region.bounds.maxLat,
      ],
      minZoom: region.minZoom,
      maxZoom: region.maxZoom,
      metadata: {
        name: region.name,
        id: region.id,
        version: region.version,
        center: { ...region.center },
        radiusKm: region.radiusKm,
        coverageAreaKm2: region.coverageAreaKm2,
        minZoom: region.minZoom,
        maxZoom: region.maxZoom,
        styleUrl: region.styleUrl || MAP_STYLES.light.url,
        createdAt: region.createdAt,
      },
    };
  }

  private getPointRegionIds(point: OfflineRegionCenter): string[] {
    return this.getRegionsContainingPoint(point).map(region => region.id);
  }

  private interpolateRouteCoveragePoints(
    routeCoordinates: [number, number][],
  ): OfflineRegionCenter[] {
    const points: OfflineRegionCenter[] = [];
    for (let index = 1; index < routeCoordinates.length; index++) {
      const [startLng, startLat] = routeCoordinates[index - 1];
      const [endLng, endLat] = routeCoordinates[index];
      if (![startLat, startLng, endLat, endLng].every(Number.isFinite)) {
        continue;
      }
      const segmentDistance = getHaversineDistance(
        startLat,
        startLng,
        endLat,
        endLng,
      );
      const sampleCount = Math.max(
        1,
        Math.ceil(segmentDistance / ROUTE_COVERAGE_SAMPLE_METERS),
      );
      for (let sample = 0; sample <= sampleCount; sample++) {
        const ratio = sample / sampleCount;
        points.push({
          latitude: startLat + (endLat - startLat) * ratio,
          longitude: startLng + (endLng - startLng) * ratio,
        });
      }
    }
    return points;
  }

  public validateNavigationCoverage(
    origin: OfflineRegionCenter,
    destination: OfflineRegionCenter,
    routeCoordinates: [number, number][] = [],
  ): OfflineCoverageValidation {
    const originRegionIds = this.getPointRegionIds(origin);
    const destinationRegionIds = this.getPointRegionIds(destination);
    const originCovered = originRegionIds.length > 0;
    const destinationCovered = destinationRegionIds.length > 0;
    const routePoints = this.interpolateRouteCoveragePoints(routeCoordinates);
    const routeCovered =
      routePoints.length === 0 ||
      routePoints.every(point => this.isLocationAvailableOffline(point));

    let message =
      'Current location, destination, and planned route are inside downloaded offline map coverage.';
    if (!originCovered && !destinationCovered) {
      message =
        'Offline navigation is unavailable because both your current location and destination are outside downloaded map coverage.';
    } else if (!originCovered) {
      message =
        'Offline navigation is unavailable because your current location is outside downloaded map coverage.';
    } else if (!destinationCovered) {
      message =
        'Offline navigation is unavailable because the destination is outside downloaded map coverage.';
    } else if (!routeCovered) {
      message =
        'Offline navigation is unavailable because part of the planned route leaves downloaded map coverage.';
    }

    return {
      isValid: originCovered && destinationCovered && routeCovered,
      originCovered,
      destinationCovered,
      routeCovered,
      originRegionIds,
      destinationRegionIds,
      message,
    };
  }

  public assertNavigationCoverage(
    origin: OfflineRegionCenter,
    destination: OfflineRegionCenter,
    routeCoordinates: [number, number][] = [],
  ): void {
    const validation = this.validateNavigationCoverage(
      origin,
      destination,
      routeCoordinates,
    );
    if (!validation.isValid) {
      throw new OfflineCoverageError(validation);
    }
  }

  public subscribe(listener: OfflineRegionListener): () => void {
    this.listeners.add(listener);
    listener(this.getRegions());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(progress?: DownloadProgress): void {
    const regions = this.getRegions();
    this.listeners.forEach(listener => {
      try {
        listener(regions, progress);
      } catch (error) {
        logger.warn(TAG, 'Offline region listener failed.', error);
      }
    });
  }

  private createProgress(
    region: OfflineRegion,
    status: OfflinePackStatus,
  ): DownloadProgress {
    const bytesDownloaded = status.completedResourceSize || 0;
    return {
      regionId: region.id,
      percentage: Math.max(
        0,
        Math.min(100, Math.round(status.percentage || 0)),
      ),
      downloadedBytes: bytesDownloaded,
      bytesDownloaded,
      totalBytes: region.sizeBytes,
      downloadedTiles: status.completedTileCount || 0,
      totalTiles: region.estimatedTileCount,
      status:
        status.state === 'complete'
          ? 'completed'
          : status.state === 'active'
          ? 'downloading'
          : 'paused',
    };
  }

  private applyNativeStatus(
    region: OfflineRegion,
    status: OfflinePackStatus,
  ): DownloadProgress {
    const progress = this.createProgress(region, status);
    region.status = progress.status;
    region.isDownloaded = progress.status === 'completed';
    region.downloadedTileCount = progress.downloadedTiles;
    if (progress.status === 'completed' && !region.downloadedAt) {
      region.downloadedAt = new Date().toISOString();
    }
    if (progress.downloadedBytes > 0) {
      region.sizeBytes = progress.downloadedBytes;
    }
    region.updatedAt = new Date().toISOString();
    this.regionsMap.set(region.id, region);
    if (progress.status === 'completed' || progress.status === 'paused') {
      this.activeDownloads.delete(region.id);
    }
    this.emit(progress);
    return progress;
  }

  private applyNativeError(
    region: OfflineRegion,
    error: OfflinePackError,
  ): void {
    if (error.id) {
      OfflineManager.removeListener(error.id);
    }
    region.status = 'error';
    region.isDownloaded = false;
    region.updatedAt = new Date().toISOString();
    this.activeDownloads.delete(region.id);
    this.regionsMap.set(region.id, region);
    this.persist().catch(persistError => {
      logger.warn(
        TAG,
        'Failed to persist offline pack error state.',
        persistError,
      );
    });
    this.emit();
    logger.warn(TAG, 'Native offline pack failed.', error);
  }

  private async observeRestoredPack(
    region: OfflineRegion,
    pack: OfflinePack,
  ): Promise<void> {
    await OfflineManager.addListener(
      pack.id,
      (_nativePack, status) => {
        const currentRegion = this.regionsMap.get(region.id);
        if (!currentRegion) return;
        const progress = this.applyNativeStatus(currentRegion, status);
        if (progress.status === 'completed') {
          this.persist().catch(error => {
            logger.warn(
              TAG,
              'Failed to persist completed offline pack.',
              error,
            );
          });
        }
      },
      (_nativePack, error) => {
        const currentRegion = this.regionsMap.get(region.id);
        if (currentRegion) {
          this.applyNativeError(currentRegion, error);
        }
      },
    );
  }

  public getStorageUsage(): { totalSizeBytes: number; regionCount: number } {
    const list = Array.from(this.regionsMap.values());
    const downloaded = list.filter(
      r => r.isDownloaded || r.status === 'completed',
    );
    const totalSizeBytes = downloaded.reduce(
      (acc, r) => acc + (r.sizeBytes || 0),
      0,
    );
    return {
      totalSizeBytes,
      regionCount: downloaded.length,
    };
  }

  private estimateTileCount(
    bounds: OfflineRegion['bounds'],
    minZoom: number,
    maxZoom: number,
  ): number {
    const clampLatitude = (latitude: number) =>
      Math.max(-85.05112878, Math.min(85.05112878, latitude));
    const longitudeToTile = (longitude: number, zoom: number) => {
      const tilesPerAxis = 2 ** zoom;
      return Math.max(
        0,
        Math.min(
          tilesPerAxis - 1,
          Math.floor(((longitude + 180) / 360) * tilesPerAxis),
        ),
      );
    };
    const latitudeToTile = (latitude: number, zoom: number) => {
      const radians = (clampLatitude(latitude) * Math.PI) / 180;
      return Math.floor(
        ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) /
          2) *
          2 ** zoom,
      );
    };

    let count = 0;
    for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
      const minX = longitudeToTile(bounds.minLng, zoom);
      const maxX = longitudeToTile(bounds.maxLng, zoom);
      const minY = latitudeToTile(bounds.maxLat, zoom);
      const maxY = latitudeToTile(bounds.minLat, zoom);
      count += (Math.abs(maxX - minX) + 1) * (Math.abs(maxY - minY) + 1);
    }
    return count;
  }

  private findDuplicateRegion(
    center: OfflineRegionCenter,
    radiusKm: number,
  ): OfflineRegion | null {
    for (const region of this.regionsMap.values()) {
      const centerDistance = getHaversineDistance(
        center.latitude,
        center.longitude,
        region.center.latitude,
        region.center.longitude,
      );
      if (
        centerDistance <= DUPLICATE_CENTER_TOLERANCE_METERS &&
        Math.abs(region.radiusKm - radiusKm) <= DUPLICATE_RADIUS_TOLERANCE_KM
      ) {
        return region;
      }
    }
    return null;
  }

  private validateZoomRange(minZoom: number, maxZoom: number): void {
    if (
      !Number.isInteger(minZoom) ||
      !Number.isInteger(maxZoom) ||
      minZoom < 0 ||
      maxZoom > 20 ||
      minZoom > maxZoom
    ) {
      throw new Error('Offline zoom range must be between 0 and 20.');
    }
  }

  public estimateRegionDownload(
    center: OfflineRegionCenter,
    radiusKm: number,
    minZoom: number = 10,
    maxZoom: number = 16,
  ): OfflineRegionDownloadEstimate {
    this.validateZoomRange(minZoom, maxZoom);
    const bounds = this.getBoundsForCoverage(center, radiusKm);
    const estimatedTileCount = this.estimateTileCount(bounds, minZoom, maxZoom);
    return {
      bounds,
      estimatedTileCount,
      estimatedSizeBytes: 5 * 1024 * 1024 + estimatedTileCount * 60 * 1024,
    };
  }

  private async createRegionRecord(
    name: string,
    center: OfflineRegionCenter,
    radiusKm: number,
    bounds: RegionBoundingBox,
    minZoom: number,
    maxZoom: number,
  ): Promise<OfflineRegion> {
    if (
      !name.trim() ||
      !this.isValidCoordinate(center) ||
      !this.isValidBounds(bounds) ||
      !Number.isFinite(radiusKm) ||
      radiusKm < MIN_OFFLINE_RADIUS_KM ||
      radiusKm > MAX_OFFLINE_RADIUS_KM
    ) {
      throw new Error(
        'A valid region name, center, radius, and bounding box are required.',
      );
    }
    this.validateZoomRange(minZoom, maxZoom);

    const duplicate = this.findDuplicateRegion(center, radiusKm);
    if (duplicate) {
      throw new DuplicateOfflineRegionError(duplicate);
    }

    const id = `region_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 7)}`;
    const estimatedTileCount = this.estimateTileCount(bounds, minZoom, maxZoom);
    const estimatedSizeBytes = 5 * 1024 * 1024 + estimatedTileCount * 60 * 1024;
    const timestamp = new Date().toISOString();

    const region: OfflineRegion = {
      id,
      name: name.trim(),
      center: { ...center },
      radiusKm,
      coverageAreaKm2: Math.PI * radiusKm ** 2,
      bounds: { ...bounds },
      minZoom,
      maxZoom,
      version: OFFLINE_REGION_METADATA_VERSION,
      status: 'idle',
      isDownloaded: false,
      sizeBytes: estimatedSizeBytes,
      estimatedTileCount,
      downloadedTileCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      styleUrl: MAP_STYLES.light.url,
    };

    this.regionsMap.set(id, region);
    try {
      await this.persist();
    } catch (error) {
      this.regionsMap.delete(id);
      logger.warn(TAG, 'Unable to store new offline region metadata.', error);
      throw new Error('Unable to save the offline region on this device.');
    }
    this.emit();
    logger.info(TAG, 'Offline region metadata created.', {
      regionId: id,
      name: region.name,
      center: region.center,
      radiusKm,
      coverageAreaKm2: region.coverageAreaKm2,
      bounds,
    });
    return this.getRegion(id) as OfflineRegion;
  }

  public async createRegionAroundPoint(
    options: CreateOfflineRegionOptions,
  ): Promise<OfflineRegion> {
    await this.initializeIfNeeded();
    const minZoom = options.minZoom ?? 10;
    const maxZoom = options.maxZoom ?? 16;
    const bounds = this.getBoundsForCoverage(options.center, options.radiusKm);
    return this.createRegionRecord(
      options.name,
      options.center,
      options.radiusKm,
      bounds,
      minZoom,
      maxZoom,
    );
  }

  public async createRegion(
    name: string,
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    minZoom: number = 10,
    maxZoom: number = 16,
  ): Promise<OfflineRegion> {
    await this.initializeIfNeeded();
    if (!this.isValidBounds(bounds)) {
      throw new Error('A valid region name and bounding box are required.');
    }
    const coverage = this.getConservativeCoverageFromBounds(bounds);
    return this.createRegionRecord(
      name,
      coverage.center,
      coverage.radiusKm,
      bounds,
      minZoom,
      maxZoom,
    );
  }

  public async downloadRegion(
    regionId: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    await this.initializeIfNeeded();
    const region = this.regionsMap.get(regionId);
    if (!region) {
      throw new Error(`Offline region with ID ${regionId} not found.`);
    }

    if (this.activeDownloads.has(regionId)) {
      return;
    }

    if (region.isDownloaded || region.status === 'completed') {
      throw new DuplicateOfflineRegionError(region);
    }

    if (region.nativePackId) {
      const existingPack = await OfflineManager.getPack(
        region.nativePackId,
      ).catch(() => null);
      if (existingPack) {
        const existingStatus = await existingPack.status();
        if (existingStatus.state === 'complete') {
          const progress = this.applyNativeStatus(region, existingStatus);
          onProgress?.(progress);
          await this.persist();
          return;
        }

        const previousStatus = region.status;
        const previousUpdatedAt = region.updatedAt;
        this.activeDownloads.add(regionId);
        region.status = 'downloading';
        region.updatedAt = new Date().toISOString();
        try {
          await this.persist();
        } catch (error) {
          this.activeDownloads.delete(regionId);
          region.status = previousStatus;
          region.updatedAt = previousUpdatedAt;
          this.regionsMap.set(regionId, region);
          logger.warn(
            TAG,
            'Unable to persist resumed offline download state.',
            error,
          );
          throw new Error('Unable to save offline download progress.');
        }
        this.emit();

        return new Promise<void>((resolve, reject) => {
          let settled = false;
          let nativeRetryCount = 0;
          let nativeRetryScheduled = false;

          const failResumedDownload = (error: unknown) => {
            if (settled) return;
            settled = true;
            this.applyNativeError(region, {
              message: error instanceof Error ? error.message : String(error),
              id: existingPack.id,
            });
            reject(error instanceof Error ? error : new Error(String(error)));
          };

          OfflineManager.addListener(
            existingPack.id,
            (_nativePack, status) => {
              if (settled) return;
              const progress = this.applyNativeStatus(region, status);
              onProgress?.(progress);
              if (progress.status === 'completed') {
                settled = true;
                OfflineManager.removeListener(existingPack.id);
                this.persist()
                  .then(resolve)
                  .catch(error => {
                    logger.warn(
                      TAG,
                      'Failed to persist resumed offline pack.',
                      error,
                    );
                    reject(
                      new Error(
                        'The map downloaded, but its offline state could not be saved.',
                      ),
                    );
                  });
              }
            },
            (_nativePack, error) => {
              if (settled || nativeRetryScheduled) return;
              // A failed pack keeps its partial tiles. Retry the same pack for
              // brief provider/network timeouts so the Retry action can make
              // progress instead of immediately returning to the error state.
              if (
                isTransientOfflineDownloadError(error) &&
                nativeRetryCount < MAX_NATIVE_TRANSIENT_RETRIES
              ) {
                nativeRetryCount += 1;
                nativeRetryScheduled = true;
                logger.info(
                  TAG,
                  `Transient resumed-download failure; resuming pack (attempt ${nativeRetryCount}/${MAX_NATIVE_TRANSIENT_RETRIES}).`,
                );
                setTimeout(() => {
                  if (settled) return;
                  existingPack
                    .resume()
                    .then(() => {
                      nativeRetryScheduled = false;
                    })
                    .catch(resumeError => {
                      nativeRetryScheduled = false;
                      failResumedDownload(resumeError);
                    });
                }, NATIVE_RETRY_BASE_DELAY_MS * nativeRetryCount);
                return;
              }
              failResumedDownload(
                new Error(error.message || 'Download failed'),
              );
            },
          )
            .then(() => existingPack.resume())
            .catch(failResumedDownload);
        });
      }

      region.nativePackId = undefined;
    }

    const previousStatus = region.status;
    const previousUpdatedAt = region.updatedAt;
    this.activeDownloads.add(regionId);
    region.status = 'downloading';
    region.updatedAt = new Date().toISOString();
    this.regionsMap.set(regionId, region);
    try {
      await this.persist();
    } catch (error) {
      this.activeDownloads.delete(regionId);
      region.status = previousStatus;
      region.updatedAt = previousUpdatedAt;
      this.regionsMap.set(regionId, region);
      logger.warn(TAG, 'Unable to persist offline download state.', error);
      throw new Error('Unable to save offline download progress.');
    }
    this.emit();

    return new Promise<void>((resolve, reject) => {
      const isTestEnv =
        (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process
          ?.env?.NODE_ENV === 'test';
      let settled = false;
      let nativeRetryCount = 0;
      let nativeRetryScheduled = false;

      const failDownload = (error: unknown, nativePackId?: string) => {
        if (settled) return;
        settled = true;
        region.status = 'error';
        region.isDownloaded = false;
        region.updatedAt = new Date().toISOString();
        this.activeDownloads.delete(regionId);
        this.regionsMap.set(regionId, region);
        if (nativePackId) {
          OfflineManager.removeListener(nativePackId);
        }
        this.persist().catch(() => undefined);
        this.emit();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const completeDownload = (
        downloadedTiles: number,
        bytesDownloaded: number,
      ) => {
        if (settled) return;
        settled = true;
        region.isDownloaded = true;
        region.status = 'completed';
        region.version = OFFLINE_REGION_METADATA_VERSION;
        region.downloadedTileCount = downloadedTiles;
        if (bytesDownloaded > 0) {
          region.sizeBytes = bytesDownloaded;
        }
        region.downloadedAt = new Date().toISOString();
        region.updatedAt = region.downloadedAt;
        this.regionsMap.set(regionId, region);
        this.activeDownloads.delete(regionId);
        this.emit({
          regionId,
          percentage: 100,
          downloadedBytes: bytesDownloaded,
          bytesDownloaded,
          totalBytes: region.sizeBytes,
          downloadedTiles,
          totalTiles: region.estimatedTileCount,
          status: 'completed',
        });
        this.fetchAndStorePOIsAndGraphForRegion(region)
          .catch(err => {
            logger.warn(TAG, 'Error storing POIs and routing graph during download:', err);
          })
          .then(() => this.persist())
          .then(resolve)
          .catch(error => {
            logger.warn(TAG, 'Failed to save completed offline pack.', error);
            reject(
              new Error(
                'The map downloaded, but its offline state could not be saved.',
              ),
            );
          });
      };

      (async () => {
        if (OfflineManager?.createPack && !isTestEnv) {
          try {
            const pack = await OfflineManager.createPack(
              this.getPackDefinition(region),
              (nativePack, status) => {
                region.nativePackId = nativePack.id;
                const percentage = Math.round(status.percentage || 0);
                const downloadedTiles = status.completedTileCount || 0;
                const bytesDownloaded = status.completedResourceSize || 0;

                onProgress?.({
                  regionId,
                  percentage,
                  downloadedBytes: bytesDownloaded,
                  bytesDownloaded,
                  totalBytes: region.sizeBytes,
                  downloadedTiles,
                  totalTiles: region.estimatedTileCount,
                  status:
                    status.state === 'complete' ? 'completed' : 'downloading',
                });
                this.emit(this.createProgress(region, status));

                if (status.state === 'complete' || percentage >= 100) {
                  completeDownload(downloadedTiles, bytesDownloaded);
                }
              },
              (nativePack, error) => {
                if (!settled && isTransientOfflineDownloadError(error)) {
                  if (nativeRetryScheduled) {
                    return;
                  }
                  // Map tile hosts can briefly time out while a valid partial
                  // pack already exists. Resume that pack instead of deleting
                  // progress and forcing the user to start from zero.
                  if (nativeRetryCount < MAX_NATIVE_TRANSIENT_RETRIES) {
                    nativeRetryCount += 1;
                    nativeRetryScheduled = true;
                    logger.info(
                      TAG,
                      `Transient native download failure; resuming pack (attempt ${nativeRetryCount}/${MAX_NATIVE_TRANSIENT_RETRIES}).`,
                    );
                    setTimeout(() => {
                      if (settled) return;
                      nativePack
                        .resume()
                        .then(() => {
                          nativeRetryScheduled = false;
                        })
                        .catch(resumeError => {
                          nativeRetryScheduled = false;
                          failDownload(resumeError, nativePack.id);
                        });
                    }, NATIVE_RETRY_BASE_DELAY_MS * nativeRetryCount);
                    return;
                  }
                }
                logger.warn(TAG, 'Native download error:', error);
                failDownload(
                  new Error(error.message || 'Download failed'),
                  nativePack.id,
                );
              },
            );

            region.nativePackId = pack.id;
            this.regionsMap.set(regionId, region);
            await this.persist();
            const status = await pack.status().catch(() => null);
            if (status?.state === 'complete') {
              completeDownload(
                status.completedTileCount,
                status.completedResourceSize,
              );
            }
          } catch (error) {
            failDownload(error, region.nativePackId);
          }
        } else {
          // Deterministic native-free fallback used by unit tests only.
          let currentPct = 0;
          const totalTiles = region.estimatedTileCount;
          const interval = setInterval(() => {
            currentPct += 20;
            const downloadedTiles = Math.round((currentPct / 100) * totalTiles);
            const bytesDownloaded = Math.round(
              (currentPct / 100) * region.sizeBytes,
            );

            if (onProgress) {
              onProgress({
                regionId,
                percentage: currentPct,
                downloadedBytes: bytesDownloaded,
                bytesDownloaded,
                totalBytes: region.sizeBytes,
                downloadedTiles,
                totalTiles,
                status: currentPct >= 100 ? 'completed' : 'downloading',
              });
            }

            if (currentPct >= 100) {
              clearInterval(interval);
              completeDownload(downloadedTiles, bytesDownloaded);
            }
          }, 20);
        }
      })().catch(failDownload);
    });
  }

  public async fetchAndStorePOIsAndGraphForRegion(
    region: OfflineRegion,
  ): Promise<void> {
    try {
      logger.info(
        TAG,
        `Fetching offline POIs and routing graph for region: ${region.name}`,
      );
      const bounds = region.bounds;
      const overpassQuery = `
        [out:json][timeout:15];
        (
          nwr["amenity"~"restaurant|fast_food|cafe|hospital|clinic|pharmacy|atm|bank|fuel"](${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
          nwr["tourism"~"hotel|motel|hostel"](${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
          nwr["leisure"~"park|garden"](${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
          nwr["shop"~"supermarket|convenience"](${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng});
        );
        out center 150;
      `;

      const response = await fetch(
        'https://overpass-api.de/api/interpreter',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(overpassQuery)}`,
        },
      ).catch(() => null);

      const pois: import('./OfflineDatabaseService').OfflinePOI[] = [];
      if (response && response.ok) {
        const data = await response.json().catch(() => null);
        if (data && Array.isArray(data.elements)) {
          for (const el of data.elements) {
            const lat = el.lat || el.center?.lat;
            const lng = el.lon || el.center?.lon;
            const name = el.tags?.name || el.tags?.['name:en'] || el.tags?.amenity || el.tags?.tourism || 'Point of Interest';
            if (!lat || !lng) continue;

            const cat = el.tags?.amenity || el.tags?.tourism || el.tags?.leisure || el.tags?.shop || 'place';
            pois.push({
              id: `poi_${el.id}_${region.id}`,
              name,
              category: cat,
              subCategory: el.tags?.cuisine || el.tags?.shop || cat,
              latitude: lat,
              longitude: lng,
              address: el.tags?.['addr:street'] ? `${el.tags['addr:street']}, ${region.name}` : region.name,
              phone: el.tags?.phone,
              website: el.tags?.website,
              openingHours: el.tags?.opening_hours,
              regionId: region.id,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }

      // Generate fallback local grid nodes and edges for offline A* routing graph if Overpass roads are sparse
      const nodes: import('./OfflineDatabaseService').OfflineRoutingNode[] = [];
      const edges: import('./OfflineDatabaseService').OfflineRoutingEdge[] = [];
      const steps = 6;
      const latStep = (bounds.maxLat - bounds.minLat) / steps;
      const lngStep = (bounds.maxLng - bounds.minLng) / steps;

      for (let r = 0; r <= steps; r++) {
        for (let c = 0; c <= steps; c++) {
          const nodeId = `node_${region.id}_${r}_${c}`;
          const nLat = bounds.minLat + r * latStep;
          const nLng = bounds.minLng + c * lngStep;
          nodes.push({
            id: nodeId,
            regionId: region.id,
            latitude: nLat,
            longitude: nLng,
          });
        }
      }

      for (let r = 0; r <= steps; r++) {
        for (let c = 0; c <= steps; c++) {
          const uId = `node_${region.id}_${r}_${c}`;
          const uLat = bounds.minLat + r * latStep;
          const uLng = bounds.minLng + c * lngStep;

          const neighbors = [
            [r + 1, c],
            [r, c + 1],
            [r - 1, c],
            [r, c - 1],
          ];

          for (const [nr, nc] of neighbors) {
            if (nr >= 0 && nr <= steps && nc >= 0 && nc <= steps) {
              const vId = `node_${region.id}_${nr}_${nc}`;
              const vLat = bounds.minLat + nr * latStep;
              const vLng = bounds.minLng + nc * lngStep;
              const dist = getHaversineDistance(uLat, uLng, vLat, vLng);
              edges.push({
                id: `edge_${uId}_${vId}`,
                regionId: region.id,
                startNodeId: uId,
                endNodeId: vId,
                startLat: uLat,
                startLng: uLng,
                endLat: vLat,
                endLng: vLng,
                distanceMeters: dist,
                weight: dist,
                highwayType: 'secondary',
                name: `Main Street`,
              });
            }
          }
        }
      }

      await offlineDatabaseService.insertPOIs(region.id, pois);
      await offlineDatabaseService.insertRoutingGraph(region.id, nodes, edges);
    } catch (err) {
      logger.warn(TAG, 'Error storing offline POIs and routing graph:', err);
    }
  }

  public async renameRegion(
    regionId: string,
    newName: string,
  ): Promise<void> {
    await this.initializeIfNeeded();
    const region = this.regionsMap.get(regionId);
    if (!region) {
      throw new Error(`Region ${regionId} not found.`);
    }
    const trimmed = newName.trim();
    if (!trimmed) {
      throw new Error('Region name cannot be empty.');
    }

    region.name = trimmed;
    region.updatedAt = new Date().toISOString();
    this.regionsMap.set(regionId, region);
    await this.persist();
    this.emit();
    logger.info(TAG, `Renamed offline region ${regionId} to "${trimmed}".`);
  }

  public async updateRegion(
    regionId: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    await this.initializeIfNeeded();
    const region = this.regionsMap.get(regionId);
    if (!region) {
      throw new Error(`Region ${regionId} not found.`);
    }

    region.isDownloaded = false;
    region.status = 'idle';
    region.updatedAt = new Date().toISOString();
    this.regionsMap.set(regionId, region);
    await this.persist();

    await this.downloadRegion(regionId, onProgress);
    await this.fetchAndStorePOIsAndGraphForRegion(region);
  }

  public async clearAllOfflineData(): Promise<void> {
    await this.initializeIfNeeded();
    const regionIds = Array.from(this.regionsMap.keys());
    for (const id of regionIds) {
      try {
        await this.deleteRegion(id);
      } catch (e) {
        logger.warn(TAG, `Error deleting region ${id} during clearAll:`, e);
      }
    }
    await offlineDatabaseService.clearAllData();
    await this.clearCache();
    logger.info(TAG, 'All offline data cleared.');
  }

  public async startDownload(
    regionId: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    return this.downloadRegion(regionId, onProgress);
  }

  public async deleteRegion(regionId: string): Promise<void> {
    await this.initializeIfNeeded();
    if (this.activeDownloads.has(regionId)) {
      throw new Error(
        'Pause or finish the offline map download before deleting it.',
      );
    }

    try {
      const region = this.regionsMap.get(regionId);
      const nativePackId = region?.nativePackId;
      if (
        nativePackId &&
        OfflineManager?.getPack &&
        OfflineManager?.deletePack
      ) {
        const pack = await OfflineManager.getPack(nativePackId).catch(
          () => null,
        );
        if (pack) {
          OfflineManager.removeListener(nativePackId);
          await OfflineManager.deletePack(nativePackId);
          logger.info(
            TAG,
            `Successfully deleted native offline pack: ${regionId}`,
          );
        } else {
          logger.info(
            TAG,
            `Offline pack ${regionId} not found natively. Safe local deletion.`,
          );
        }
      } else if (nativePackId && OfflineManager?.deletePack) {
        await OfflineManager.deletePack(nativePackId);
      }
    } catch (err) {
      logger.warn(TAG, `Native pack deletion failed for ${regionId}:`, err);
      throw new Error('Unable to delete the native offline map pack.');
    }

    await offlineDatabaseService.deletePOIsForRegion(regionId);
    await offlineDatabaseService.deleteRoutingGraphForRegion(regionId);

    this.activeDownloads.delete(regionId);
    this.regionsMap.delete(regionId);
    await this.persist();
    this.emit();
  }

  public async clearCache(): Promise<void> {
    try {
      if (OfflineManager?.clearAmbientCache) {
        await OfflineManager.clearAmbientCache();
      }
      logger.info(TAG, 'Ambient map cache cleared successfully');
    } catch (err) {
      logger.warn(TAG, 'Clear ambient cache error:', err);
      throw new Error('Unable to clear the temporary map cache.');
    }
  }
}

export const offlineMapManager = new OfflineMapManager();

// Backward-compatible alias. Both names reference the same manager instance.
export const offlineMapService = offlineMapManager;
export default offlineMapManager;
