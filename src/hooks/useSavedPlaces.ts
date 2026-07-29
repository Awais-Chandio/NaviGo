import { useState, useCallback, useEffect } from 'react';
import { storageService, SavedPlace } from '../services/storageService';
import { SearchPlaceItem } from '../services/searchService';

export function useSavedPlaces() {
  const [recentSearches, setRecentSearches] = useState<SearchPlaceItem[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);

  useEffect(() => {
    setRecentSearches(storageService.getRecentSearches());
    setSavedPlaces(storageService.getSavedPlaces());
  }, []);

  const addRecentSearch = useCallback((item: SearchPlaceItem) => {
    const updated = storageService.addRecentSearch(item);
    setRecentSearches(updated);
  }, []);

  const savePlace = useCallback((place: SavedPlace) => {
    const updated = storageService.savePlace(place);
    setSavedPlaces(updated);
  }, []);

  const removeSavedPlace = useCallback((id: string) => {
    const updated = storageService.removeSavedPlace(id);
    setSavedPlaces(updated);
  }, []);

  const homePlace = savedPlaces.find(p => p.type === 'home');
  const workPlace = savedPlaces.find(p => p.type === 'work');

  return {
    recentSearches,
    savedPlaces,
    homePlace,
    workPlace,
    addRecentSearch,
    savePlace,
    removeSavedPlace,
  };
}
