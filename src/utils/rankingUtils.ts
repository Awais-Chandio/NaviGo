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
  searchMetadata?: string;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Scores autocomplete relevance using the characters the user has typed.
 * Word-prefix matching makes short queries such as "gri" match both
 * "Grill Town" and "The Grill Town" without admitting unrelated results.
 */
export function calculateTextMatchScore(
  title: string,
  subtitle: string | undefined,
  query: string | undefined,
  searchMetadata = '',
): number {
  const normalizedQuery = normalizeSearchText(query || '');
  if (!normalizedQuery) return 0;

  const normalizedTitle = normalizeSearchText(title);
  const normalizedSubtitle = normalizeSearchText(subtitle || '');
  const normalizedMetadata = normalizeSearchText(searchMetadata);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const titleTokens = normalizedTitle.split(' ').filter(Boolean);
  const subtitleTokens = normalizedSubtitle.split(' ').filter(Boolean);
  const metadataTokens = normalizedMetadata.split(' ').filter(Boolean);
  const matchingTokenCount = (
    candidateTokens: string[],
  ): number =>
    queryTokens.filter(queryToken =>
      candidateTokens.some(candidateToken =>
        candidateToken.startsWith(queryToken),
      ),
    ).length;
  const allQueryTokensMatch = (
    candidateTokens: string[],
  ): boolean =>
    matchingTokenCount(candidateTokens) === queryTokens.length;

  if (normalizedTitle === normalizedQuery) return 500;
  if (normalizedTitle.startsWith(normalizedQuery)) return 450;
  if (allQueryTokensMatch(titleTokens)) return 400;
  if (normalizedTitle.includes(normalizedQuery)) return 350;
  if (normalizedSubtitle.startsWith(normalizedQuery)) return 220;
  if (allQueryTokensMatch(subtitleTokens)) return 180;
  if (normalizedSubtitle.includes(normalizedQuery)) return 140;
  if (allQueryTokensMatch(metadataTokens)) return 100;
  if (normalizedMetadata.includes(normalizedQuery)) return 80;
  return 0;
}

export function isBrandedPlace(
  _title: string,
  namedetails?: Record<string, string>,
  extratags?: Record<string, string>,
  tags?: Record<string, string>,
): boolean {
  return Boolean(
    extratags?.brand ||
      extratags?.operator ||
      tags?.brand ||
      tags?.operator ||
      namedetails?.brand,
  );
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
    searchMetadata,
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
  const textMatchScore = calculateTextMatchScore(
    title,
    subtitle,
    query,
    searchMetadata,
  );

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
