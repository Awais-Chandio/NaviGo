export interface NearbySearchParams {
  latitude: number;
  longitude: number;
  category: string;
  radius?: number;
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
