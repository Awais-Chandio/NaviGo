import { NearbyCategory } from '../types/places';

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
  {
    id: 'food',
    title: 'Food',
    icon: '🍔',
    category: 'restaurant',
  },
  {
    id: 'cafe',
    title: 'Cafe',
    icon: '☕',
    category: 'cafe',
  },
  {
    id: 'atm',
    title: 'ATM',
    icon: '🏧',
    category: 'atm',
  },
  {
    id: 'fuel',
    title: 'Fuel',
    icon: '⛽',
    category: 'fuel',
  },
  {
    id: 'hospital',
    title: 'Hospital',
    icon: '🏥',
    category: 'hospital',
  },
  {
    id: 'pharmacy',
    title: 'Pharmacy',
    icon: '💊',
    category: 'pharmacy',
  },
  {
    id: 'hotel',
    title: 'Hotel',
    icon: '🏨',
    category: 'hotel',
  },
  {
    id: 'parking',
    title: 'Parking',
    icon: '🅿️',
    category: 'parking',
  },
  {
    id: 'shopping',
    title: 'Shopping',
    icon: '🛒',
    category: 'supermarket',
  },
  {
    id: 'school',
    title: 'School',
    icon: '🏫',
    category: 'school',
  },
  {
    id: 'university',
    title: 'University',
    icon: '🎓',
    category: 'university',
  },
];
