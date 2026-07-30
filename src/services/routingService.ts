import { formatDistance, formatDuration } from '../utils/locationUtils';

export interface OSRMManeuver {
  type: string;
  modifier?: string;
  location?: [number, number];
  bearing_after?: number;
  bearing_before?: number;
}

export interface OSRMStep {
  distance: number;
  duration: number;
  name?: string;
  maneuver: OSRMManeuver;
  mode?: string;
}

export interface NavigationStep {
  instruction: string;
  distance: number;
  duration: number;
  type: string;
  modifier?: string;
  formattedDistance?: string;
  iconSymbol?: string;
  location?: [number, number];
}

export interface RouteDetails {
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  formattedDistance: string;
  formattedDuration: string;
  steps: NavigationStep[];
}

function getManeuverIcon(type: string, modifier?: string): string {
  if (type === 'arrive') return '🏁';
  if (type === 'depart') return '🚗';
  if (type === 'roundabout' || type === 'rotary') return '🔄';

  if (modifier) {
    if (modifier.includes('right')) return '↱';
    if (modifier.includes('left')) return '↰';
    if (modifier.includes('straight')) return '↑';
  }

  return '↑';
}

export function parseOSRMSteps(rawSteps: OSRMStep[]): NavigationStep[] {
  if (!Array.isArray(rawSteps)) return [];

  return rawSteps.map(step => {
    const type = step.maneuver?.type || 'straight';
    const modifier = step.maneuver?.modifier || '';
    const streetName = step.name ? ` onto ${step.name}` : '';
    const location = step.maneuver?.location;

    let instruction = 'Continue straight';

    if (type === 'depart') {
      instruction = `Start navigation${step.name ? ' - Head onto ' + step.name : ''}`.trim();
    } else if (type === 'arrive') {
      instruction = 'You have arrived at your destination';
    } else if (type === 'turn') {
      if (modifier.includes('right')) {
        instruction = `Turn right${streetName}`.trim();
      } else if (modifier.includes('left')) {
        instruction = `Turn left${streetName}`.trim();
      } else {
        instruction = `Turn ${modifier}${streetName}`.trim();
      }
    } else if (type === 'new name' || type === 'continue' || type === 'straight') {
      instruction = `Continue straight${streetName}`.trim();
    } else if (type === 'roundabout' || type === 'rotary') {
      instruction = `Take roundabout${streetName}`.trim();
    } else if (type === 'merge') {
      instruction = `Merge ${modifier}${streetName}`.trim();
    } else if (type === 'fork') {
      instruction = `Keep ${modifier} at fork${streetName}`.trim();
    } else {
      instruction = `${type} ${modifier}${streetName}`.trim();
    }

    const distance = Math.round(step.distance || 0);
    const duration = Math.round(step.duration || 0);

    return {
      instruction: instruction || 'Continue along route',
      distance,
      duration,
      type: type === 'turn' && modifier ? `turn-${modifier}` : type,
      modifier: modifier || undefined,
      formattedDistance: formatDistance(distance),
      iconSymbol: getManeuverIcon(type, modifier),
      location,
    };
  });
}

export async function getRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  signal?: AbortSignal,
): Promise<RouteDetails | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`;

    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`OSRM API HTTP Error: ${response.status}`);
    }

    const data = await response.json();

    if (
      !data ||
      !Array.isArray(data.routes) ||
      data.routes.length === 0 ||
      !data.routes[0]?.geometry?.coordinates
    ) {
      console.warn('OSRM returned invalid route data:', data);
      return null;
    }

    const firstRoute = data.routes[0];
    const coordinates: [number, number][] = firstRoute.geometry.coordinates;
    const distanceMeters: number = Math.round(firstRoute.distance || 0);
    const durationSeconds: number = Math.round(firstRoute.duration || 0);
    const rawSteps: OSRMStep[] = firstRoute.legs?.[0]?.steps || [];
    const steps = parseOSRMSteps(rawSteps);

    return {
      coordinates,
      distanceMeters,
      durationSeconds,
      formattedDistance: formatDistance(distanceMeters),
      formattedDuration: formatDuration(durationSeconds),
      steps,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return null;
    }
    console.warn('Routing Fetch Error:', error);
    return null;
  }
}

export const getRouteDetails = getRoute;
