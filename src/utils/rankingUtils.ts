import { getHaversineDistance } from './locationUtils';

export interface PlaceRankingInput {
  title: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
  userLocation?: {
    latitude: number;
    longitude: number;
  };
  maxRadiusMeters?: number;
  importance?: number;
  address?: Record<string, string>;
  namedetails?: Record<string, string>;
  extratags?: Record<string, string>;
  tags?: Record<string, string>;
  query?: string;
}

const BRAND_KEYWORDS = [
  'shell',
  'total',
  'pso',
  'caltex',
  'attock',
  'hascol',
  'byco',
  'mcdonald',
  'kfc',
  'subway',
  'domino',
  'pizza hut',
  'starbucks',
  'dunkin',
  'hbl',
  'ubl',
  'mcb',
  'allied bank',
  'meezan',
  'alfalah',
  'marriott',
  'serena',
  'pearl continental',
  'pc hotel',
  'hyperstar',
  'carrefour',
  'metro',
  'chaseup',
  'imtiaz',
  'nandos',
  'hardees',
];

export function isBrandedPlace(
  title: string,
  namedetails?: Record<string, string>,
  extratags?: Record<string, string>,
  tags?: Record<string, string>,
): boolean {
  if (extratags?.brand || extratags?.operator || tags?.brand || tags?.operator || namedetails?.brand) {
    return true;
  }

  const textLower = (title + ' ' + (namedetails?.name || '') + ' ' + (tags?.brand || '')).toLowerCase();

  return BRAND_KEYWORDS.some(brand => textLower.includes(brand));
}

export function hasCompleteMetadata(
  subtitle?: string,
  address?: Record<string, string>,
  tags?: Record<string, string>,
): boolean {
  if (address) {
    const hasStreetOrRoad = Boolean(address.road || address.street || address.pedestrian);
    const hasAreaOrCity = Boolean(address.suburb || address.city || address.town || address.neighbourhood);
    if (hasStreetOrRoad && hasAreaOrCity) return true;
  }

  if (subtitle && subtitle.split(',').length >= 2) {
    return true;
  }

  if (tags && (tags['addr:street'] || tags['addr:city'] || tags.phone || tags.website)) {
    return true;
  }

  return false;
}

export function calculateRankingScore(input: PlaceRankingInput): number {
  const {
    title,
    subtitle,
    latitude,
    longitude,
    userLocation,
    maxRadiusMeters = 5000,
    importance,
    address,
    namedetails,
    extratags,
    tags,
    query,
  } = input;

  let distanceScore = 0;
  let distanceMeters: number | undefined;

  // 1. Current-location proximity is the primary geographic signal. Use a
  // smooth decay so a result just outside an arbitrary radius is not treated
  // the same as one hundreds of kilometres away.
  if (
    Number.isFinite(userLocation?.latitude) &&
    Number.isFinite(userLocation?.longitude)
  ) {
    distanceMeters = getHaversineDistance(
      userLocation!.latitude,
      userLocation!.longitude,
      latitude,
      longitude,
    );
    const proximityScaleMeters = Math.max(maxRadiusMeters, 5000);
    // Keep proximity strong enough that a generic title-prefix match cannot
    // push a materially farther result ahead of an equally relevant nearby
    // place (for example, "Hospital Parking" ahead of a closer hospital).
    distanceScore =
      700 * Math.exp(-distanceMeters / proximityScaleMeters);
  }

  // Metadata, brand, importance, and text relevance refine proximity. There
  // is intentionally no hard-coded city bonus: the live GPS fix is the only
  // geographic preference, so ranking remains correct outside one home city.
  let metadataBonus = hasCompleteMetadata(subtitle, address, tags) ? 20 : 0;
  if (tags) {
    if (tags.opening_hours) metadataBonus += 15;
    if (tags.phone || tags['contact:phone']) metadataBonus += 15;
    if (tags.website || tags['contact:website']) metadataBonus += 15;
  }

  // Brand Availability Bonus: +30 points for known brands/operators
  const brandBonus = isBrandedPlace(title, namedetails, extratags, tags) ? 30 : 0;

  // Importance Score
  const importanceScore = typeof importance === 'number' && !isNaN(importance)
    ? Math.min(50, Math.max(0, importance * 50))
    : 25;

  // Text match score (when searching with query)
  let textMatchScore = 0;
  if (query && query.trim().length > 0) {
    const qLower = query.trim().toLowerCase();
    const titleLower = title.toLowerCase();
    const subLower = (subtitle || '').toLowerCase();

    if (titleLower.startsWith(qLower)) {
      textMatchScore = 150;
    } else if (titleLower.includes(qLower)) {
      textMatchScore = 80;
    } else if (subLower.includes(qLower)) {
      textMatchScore = 40;
    }
  }

  // Penalty for generic names
  let genericPenalty = 0;
  if (
    !title ||
    title.toLowerCase().includes('spot') ||
    title.toLowerCase().includes('unknown place') ||
    title.toLowerCase() === 'unnamed'
  ) {
    genericPenalty = -200;
  }

  return (
    distanceScore +
    importanceScore +
    metadataBonus +
    brandBonus +
    textMatchScore +
    genericPenalty
  );
}
