import { useState, useCallback, useEffect } from 'react';
import { storageService } from '../services/storageService';
import { savedPlacesService } from '../services/SavedPlacesService';
import { SearchPlaceItem } from '../services/searchService';
import { SavedPlace } from '../types/places';

export function useSavedPlaces() {
  const [recentSearches, setRecentSearches] = useState<SearchPlaceItem[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);

  const reloadPlaces = useCallback(async () => {
    setRecentSearches(await storageService.getRecentSearchesAsync());
    const places = await savedPlacesService.getSavedPlaces();
    setSavedPlaces(places);
  }, []);

  useEffect(() => {
    reloadPlaces();
  }, [reloadPlaces]);

  const addRecentSearch = useCallback((item: SearchPlaceItem) => {
    const updated = storageService.addRecentSearch(item);
    setRecentSearches(updated);
  }, []);

  const savePlace = useCallback(async (place: SavedPlace) => {
    const updated = await savedPlacesService.savePlace(place);
    setSavedPlaces(updated);
  }, []);

  const removeSavedPlace = useCallback(async (id: string) => {
    const updated = await savedPlacesService.deletePlace(id);
    setSavedPlaces(updated);
  }, []);

  const homePlace = savedPlaces.find(p => p.type === 'home' || p.id === 'home');
  const workPlace = savedPlaces.find(p => p.type === 'work' || p.id === 'work');

  return {
    recentSearches,
    savedPlaces,
    homePlace,
    workPlace,
    addRecentSearch,
    savePlace,
    removeSavedPlace,
    reloadPlaces,
  };
}
