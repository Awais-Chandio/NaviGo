import { getHaversineDistance, formatDistance } from '../utils/locationUtils';

export interface SearchPlaceItem {
  id: string | number;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  displayName: string;
  distanceMeters?: number;
  formattedDistance?: string;
  categoryIcon?: string;
  categoryName?: string;
  raw?: any;
}

export interface SearchOptions {
  userLocation?: {
    latitude: number;
    longitude: number;
  };
  countryCode?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface PlacesProvider {
  searchPlaces(query: string, options?: SearchOptions): Promise<SearchPlaceItem[]>;
  reverseGeocode(latitude: number, longitude: number, signal?: AbortSignal): Promise<string>;
}

export function detectCategory(
  displayName: string,
  categoryType?: string,
): { icon: string; name: string } {
  const text = (displayName + ' ' + (categoryType || '')).toLowerCase();

  if (text.includes('fuel') || text.includes('gas') || text.includes('petrol') || text.includes('cng') || text.includes('pso') || text.includes('shell') || text.includes('total')) {
    return { icon: '⛽', name: 'Gas Station' };
  }
  if (text.includes('restaurant') || text.includes('food') || text.includes('cafe') || text.includes('biryani') || text.includes('pizza') || text.includes('burger') || text.includes('dining')) {
    return { icon: '🍔', name: 'Restaurant' };
  }
  if (text.includes('hospital') || text.includes('clinic') || text.includes('medical') || text.includes('pharmacy') || text.includes('doctor') || text.includes('health')) {
    return { icon: '🏥', name: 'Hospital' };
  }
  if (text.includes('atm') || text.includes('bank') || text.includes('hbl') || text.includes('mcb') || text.includes('meezan') || text.includes('ubl') || text.includes('cash')) {
    return { icon: '🏧', name: 'ATM & Bank' };
  }
  if (text.includes('hotel') || text.includes('resort') || text.includes('lodging') || text.includes('inn') || text.includes('stay')) {
    return { icon: '🏨', name: 'Hotel' };
  }
  if (text.includes('mall') || text.includes('market') || text.includes('bazaar') || text.includes('shopping') || text.includes('store') || text.includes('supermarket')) {
    return { icon: '🛒', name: 'Shopping' };
  }
  if (text.includes('mosque') || text.includes('masjid') || text.includes('jamia')) {
    return { icon: '🕌', name: 'Mosque' };
  }
  if (text.includes('airport') || text.includes('aerodrome')) {
    return { icon: '✈️', name: 'Airport' };
  }
  if (text.includes('park') || text.includes('garden') || text.includes('ground')) {
    return { icon: '🏞️', name: 'Park' };
  }
  if (text.includes('school') || text.includes('university') || text.includes('college')) {
    return { icon: '🏫', name: 'Education' };
  }

  return { icon: '📍', name: 'Location' };
}

function parseNominatimTitleAndSubtitle(displayName: string): {
  title: string;
  subtitle: string;
} {
  if (!displayName) {
    return { title: 'Unknown Place', subtitle: '' };
  }

  const parts = displayName.split(',').map(p => p.trim());
  const title = parts[0] || displayName;
  const subtitle = parts.slice(1).join(', ');

  return { title, subtitle };
}

class NominatimPlacesProvider implements PlacesProvider {
  async searchPlaces(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchPlaceItem[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      return [];
    }

    try {
      const countryCode = options?.countryCode ?? 'pk';
      const limit = options?.limit ?? 10;
      const userLoc = options?.userLocation;

      let viewboxParam = '';
      if (userLoc?.latitude && userLoc?.longitude) {
        const delta = 1.5;
        const left = userLoc.longitude - delta;
        const top = userLoc.latitude + delta;
        const right = userLoc.longitude + delta;
        const bottom = userLoc.latitude - delta;
        viewboxParam = `&viewbox=${left},${top},${right},${bottom}&bounded=0`;
      }

      const primaryUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
        trimmedQuery,
      )}&accept-language=en&countrycodes=${countryCode}&limit=${limit}${viewboxParam}`;

      let response = await fetch(primaryUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NaviGo/1.0',
        },
        signal: options?.signal,
      });

      if (!response.ok) {
        throw new Error(`Search API HTTP Error: ${response.status}`);
      }

      let data = await response.json();

      if ((!Array.isArray(data) || data.length === 0) && countryCode) {
        const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
          trimmedQuery,
        )}&accept-language=en&limit=${limit}`;

        response = await fetch(fallbackUrl, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'NaviGo/1.0',
          },
          signal: options?.signal,
        });

        if (response.ok) {
          data = await response.json();
        }
      }

      if (!Array.isArray(data)) {
        return [];
      }

      const results: SearchPlaceItem[] = data.map((item: any) => {
        const { title, subtitle } = parseNominatimTitleAndSubtitle(
          item.display_name,
        );
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        const category = detectCategory(item.display_name, item.type || item.category);

        let distanceMeters: number | undefined;
        let formattedDist: string | undefined;

        if (userLoc?.latitude && userLoc?.longitude) {
          distanceMeters = Math.round(
            getHaversineDistance(userLoc.latitude, userLoc.longitude, lat, lon),
          );
          formattedDist = formatDistance(distanceMeters);
        }

        return {
          id: item.place_id,
          title,
          subtitle,
          latitude: lat,
          longitude: lon,
          displayName: item.display_name,
          distanceMeters,
          formattedDistance: formattedDist,
          categoryIcon: category.icon,
          categoryName: category.name,
          raw: item,
        };
      });

      return results;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return [];
      }
      console.warn('Search Places Error:', error);
      return [];
    }
  }

  async reverseGeocode(
    latitude: number,
    longitude: number,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=en`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NaviGo/1.0',
        },
        signal,
      });

      if (!response.ok) {
        return 'Address not found';
      }

      const data = await response.json();
      return data.display_name || 'Address not found';
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return '';
      }
      return 'Address unavailable';
    }
  }
}

let activePlacesProvider: PlacesProvider = new NominatimPlacesProvider();

export function setPlacesProvider(provider: PlacesProvider) {
  activePlacesProvider = provider;
}

export async function searchPlaces(
  query: string,
  options?: SearchOptions,
): Promise<SearchPlaceItem[]> {
  return activePlacesProvider.searchPlaces(query, options);
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<string> {
  return activePlacesProvider.reverseGeocode(latitude, longitude, signal);
}
