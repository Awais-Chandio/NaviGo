/**
 * Search Service for Places Autocomplete & Reverse Geocoding.
 * Standardized structure allows replacing Nominatim with Google Places or Mapbox easily in the future.
 */

export interface SearchPlaceItem {
  id: string | number;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  displayName: string;
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

/**
 * Abstract Places Provider interface to allow seamless swap between
 * Nominatim, Google Places API, or Mapbox Places API.
 */
export interface PlacesProvider {
  searchPlaces(query: string, options?: SearchOptions): Promise<SearchPlaceItem[]>;
  reverseGeocode(latitude: number, longitude: number, signal?: AbortSignal): Promise<string>;
}

/**
 * Parses raw Nominatim response display_name into a clean title and subtitle.
 */
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

/**
 * Default Nominatim OSM Provider implementation
 */
class NominatimPlacesProvider implements PlacesProvider {
  async searchPlaces(
    query: string,
    options?: SearchOptions,
  ): Promise<SearchPlaceItem[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) {
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

      return data.map((item: any) => {
        const { title, subtitle } = parseNominatimTitleAndSubtitle(
          item.display_name,
        );
        return {
          id: item.place_id,
          title,
          subtitle,
          latitude: parseFloat(item.lat),
          longitude: parseFloat(item.lon),
          displayName: item.display_name,
          raw: item,
        };
      });
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

// Active provider instance (can be swapped with GooglePlacesProvider)
let activePlacesProvider: PlacesProvider = new NominatimPlacesProvider();

export function setPlacesProvider(provider: PlacesProvider) {
  activePlacesProvider = provider;
}

/**
 * Searches places matching query string using active provider.
 */
export async function searchPlaces(
  query: string,
  options?: SearchOptions,
): Promise<SearchPlaceItem[]> {
  return activePlacesProvider.searchPlaces(query, options);
}

/**
 * Reverse geocodes coordinates to a human readable address using active provider.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<string> {
  return activePlacesProvider.reverseGeocode(latitude, longitude, signal);
}
