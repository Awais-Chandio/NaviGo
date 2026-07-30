export interface TrafficSegment {
  start: [number, number];
  end: [number, number];
  speed: 'free_flow' | 'moderate' | 'heavy' | 'severe';
  color: string;
}

export interface TrafficProvider {
  name: string;
  getTrafficSegments(routeCoordinates: [number, number][]): Promise<TrafficSegment[]>;
}

export class SimulatedTrafficProvider implements TrafficProvider {
  public name = 'Simulated Traffic Flow Engine';

  async getTrafficSegments(routeCoordinates: [number, number][]): Promise<TrafficSegment[]> {
    if (!routeCoordinates || routeCoordinates.length < 2) return [];

    const segments: TrafficSegment[] = [];
    const totalPoints = routeCoordinates.length;

    for (let i = 0; i < totalPoints - 1; i++) {
      const start = routeCoordinates[i];
      const end = routeCoordinates[i + 1];

      // Simulated traffic condition based on index modulo for realistic demo variations
      let speed: 'free_flow' | 'moderate' | 'heavy' | 'severe' = 'free_flow';
      let color = '#34A853'; // Green

      const ratio = i / totalPoints;
      if (ratio > 0.4 && ratio < 0.55) {
        speed = 'moderate';
        color = '#FBBC05'; // Yellow / Orange
      } else if (ratio >= 0.55 && ratio < 0.65) {
        speed = 'heavy';
        color = '#EA4335'; // Red
      } else if (ratio >= 0.65 && ratio < 0.7) {
        speed = 'severe';
        color = '#880E4F'; // Dark Red / Burgundy
      }

      segments.push({
        start,
        end,
        speed,
        color,
      });
    }

    return segments;
  }
}

class UnavailableTrafficProvider implements TrafficProvider {
  public name = 'Traffic unavailable';

  async getTrafficSegments(): Promise<TrafficSegment[]> {
    return [];
  }
}

export class TrafficService {
  private provider: TrafficProvider = new UnavailableTrafficProvider();

  public setProvider(provider: TrafficProvider) {
    this.provider = provider;
  }

  public async fetchTrafficSegments(
    routeCoordinates: [number, number][],
  ): Promise<TrafficSegment[]> {
    try {
      return await this.provider.getTrafficSegments(routeCoordinates);
    } catch (err) {
      console.warn('[TrafficService] Failed to fetch traffic segments:', err);
      return [];
    }
  }
}

export const trafficService = new TrafficService();
