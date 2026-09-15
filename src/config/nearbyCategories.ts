import { NearbyCategory } from '../types/places';
import { PLACE_CATEGORIES } from './placeCategories';

export const NEARBY_CATEGORIES: NearbyCategory[] = [
  {
    id: 'home',
    title: 'Home',
    icon: '🏠',
    category: 'home',
    isSavedPlace: true,
    savedType: 'home',
  },
  {
    id: 'work',
    title: 'Work',
    icon: '💼',
    category: 'work',
    isSavedPlace: true,
    savedType: 'work',
  },
  ...PLACE_CATEGORIES.map(definition => ({
    id: definition.id,
    title: definition.title,
    icon: definition.icon,
    category: definition.id,
  })),
];
