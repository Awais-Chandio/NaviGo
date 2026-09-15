import type {
  OsmObjectType,
  PlaceProvider,
} from '../utils/placeIdentity';

export interface NearbySearchParams {
  latitude: number;
  longitude: number;
  category: string;
  radius?: number;
  countryCode?: string;
  /** Road-distance enrichment is optional because it requires a second API call. */
  includeRoadDistance?: boolean;
}

export interface NearbyPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  category: string;
  distance: number;
  formattedDistance?: string;
  source?: PlaceProvider;
  objectType?: OsmObjectType;
  objectId?: string | number;
}

export interface SavedPlace {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  type?: 'home' | 'work' | 'favorite' | 'custom';
  createdAt?: string;
}

export interface NearbyCategory {
  id: string;
  title: string;
  icon: string;
  category: string;
  isSavedPlace?: boolean;
  savedType?: 'home' | 'work';
}
