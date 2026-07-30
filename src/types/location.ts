export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  altitude?: number;
  speed?: number;
  timestamp?: number;
}

export interface RegionBoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export type OfflineRegionStatus =
  | 'idle'
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'paused'
  | 'error'
  | 'deleting';

export interface DownloadProgress {
  regionId: string;
  percentage: number;
  downloadedBytes: number;
  bytesDownloaded?: number;
  totalBytes: number;
  downloadedTiles: number;
  totalTiles: number;
  status: OfflineRegionStatus;
}

export interface OfflineRegion {
  id: string;
  nativePackId?: string;
  name: string;
  bounds: RegionBoundingBox;
  minZoom: number;
  maxZoom: number;
  status: OfflineRegionStatus;
  isDownloaded?: boolean;
  sizeBytes: number;
  estimatedTileCount: number;
  downloadedTileCount: number;
  createdAt: string;
  updatedAt: string;
  styleUrl?: string;
}

export type ProgressCallback = (progress: DownloadProgress) => void;
