export type TravelMode = 'walking' | 'motorbike' | 'driving';

export interface TravelModeConfig {
  id: TravelMode;
  label: string;
  icon: string;
  baselineSpeedKmH: number;
  minimumGpsSpeedKmH: number;
  maximumGpsSpeedKmH: number;
  usesRoadDuration: boolean;
}

export const TRAVEL_MODE_CONFIG: Record<TravelMode, TravelModeConfig> = {
  walking: {
    id: 'walking',
    label: 'Walk',
    icon: '🚶',
    baselineSpeedKmH: 5,
    minimumGpsSpeedKmH: 1,
    maximumGpsSpeedKmH: 12,
    usesRoadDuration: false,
  },
  motorbike: {
    id: 'motorbike',
    label: 'Bike',
    icon: '🏍️',
    baselineSpeedKmH: 35,
    minimumGpsSpeedKmH: 3,
    maximumGpsSpeedKmH: 140,
    usesRoadDuration: false,
  },
  driving: {
    id: 'driving',
    label: 'Car',
    icon: '🚗',
    baselineSpeedKmH: 30,
    minimumGpsSpeedKmH: 3,
    maximumGpsSpeedKmH: 220,
    usesRoadDuration: true,
  },
};

export const TRAVEL_MODES: readonly TravelMode[] = [
  'walking',
  'motorbike',
  'driving',
];

export function getTravelModeEstimateLabel(mode: TravelMode): string {
  const config = TRAVEL_MODE_CONFIG[mode];
  return config.usesRoadDuration
    ? 'Road-speed estimate'
    : `${config.baselineSpeedKmH} km/h baseline`;
}
