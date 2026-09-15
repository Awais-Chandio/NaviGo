export interface PlaceCategoryDefinition {
  id: string;
  title: string;
  icon: string;
  aliases?: string[];
  searchQueries: string[];
  osmTags: Record<string, string[]>;
}

/**
 * Category semantics for the UI and OSM providers. This contains no places:
 * every result still comes from live GPS-bounded APIs or downloaded OSM data.
 */
export const PLACE_CATEGORIES: PlaceCategoryDefinition[] = [
  {
    id: 'restaurant',
    title: 'Food',
    icon: '🍔',
    aliases: ['food'],
    searchQueries: ['restaurant', 'fast food', 'food court'],
    osmTags: { amenity: ['restaurant', 'fast_food', 'food_court'] },
  },
  {
    id: 'cafe',
    title: 'Cafe',
    icon: '☕',
    searchQueries: ['cafe'],
    osmTags: { amenity: ['cafe'] },
  },
  {
    id: 'atm',
    title: 'ATM',
    icon: '🏧',
    searchQueries: ['atm'],
    osmTags: { amenity: ['atm'] },
  },
  {
    id: 'fuel',
    title: 'Fuel',
    icon: '⛽',
    aliases: ['petrol'],
    searchQueries: ['fuel station'],
    osmTags: { amenity: ['fuel'] },
  },
  {
    id: 'hospital',
    title: 'Hospital',
    icon: '🏥',
    searchQueries: ['hospital', 'clinic'],
    osmTags: {
      amenity: ['hospital', 'clinic'],
      healthcare: ['hospital', 'clinic', 'centre'],
    },
  },
  {
    id: 'pharmacy',
    title: 'Pharmacy',
    icon: '💊',
    searchQueries: ['pharmacy'],
    osmTags: { amenity: ['pharmacy'], shop: ['chemist'] },
  },
  {
    id: 'hotel',
    title: 'Hotel',
    icon: '🏨',
    searchQueries: ['hotel', 'guest house', 'hostel'],
    osmTags: { tourism: ['hotel', 'motel', 'guest_house', 'hostel'] },
  },
  {
    id: 'parking',
    title: 'Parking',
    icon: '🅿️',
    searchQueries: ['parking'],
    osmTags: {
      amenity: ['parking', 'parking_space', 'parking_entrance'],
    },
  },
  {
    id: 'supermarket',
    title: 'Shopping',
    icon: '🛒',
    aliases: ['shopping', 'grocery'],
    searchQueries: ['supermarket', 'shopping mall'],
    osmTags: {
      shop: [
        'supermarket',
        'mall',
        'department_store',
        'convenience',
        'grocery',
      ],
    },
  },
  {
    id: 'school',
    title: 'School',
    icon: '🏫',
    searchQueries: ['school'],
    osmTags: { amenity: ['school'] },
  },
  {
    id: 'university',
    title: 'University',
    icon: '🎓',
    searchQueries: ['university', 'college'],
    osmTags: { amenity: ['university', 'college'] },
  },
];

export function getPlaceCategory(
  category: string,
): PlaceCategoryDefinition | undefined {
  const normalized = category.trim().toLowerCase();
  return PLACE_CATEGORIES.find(
    definition =>
      definition.id === normalized ||
      definition.aliases?.includes(normalized),
  );
}

export function matchesPlaceCategory(
  category: string,
  tags: Record<string, unknown>,
): boolean {
  const definition = getPlaceCategory(category);
  if (!definition) return false;
  return Object.entries(definition.osmTags).some(([key, values]) =>
    values.includes(String(tags[key] || '').toLowerCase()),
  );
}

export function classifyPlaceTags(
  tags: Record<string, unknown>,
): PlaceCategoryDefinition | undefined {
  return PLACE_CATEGORIES.find(definition =>
    Object.entries(definition.osmTags).some(([key, values]) =>
      values.includes(String(tags[key] || '').toLowerCase()),
    ),
  );
}

export function getCategoryTagValues(category: string): string[] {
  const definition = getPlaceCategory(category);
  return definition
    ? Array.from(
        new Set(
          Object.values(definition.osmTags).reduce<string[]>(
            (allValues, values) => allValues.concat(values),
            [],
          ),
        ),
      )
    : [category.trim().toLowerCase()];
}
