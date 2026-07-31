import { useState, useCallback, useEffect, useRef } from 'react';
import { storageService } from '../services/storageService';
import { savedPlacesService } from '../services/SavedPlacesService';
import { SearchPlaceItem } from '../services/searchService';
import { SavedPlace } from '../types/places';
import { logger } from '../utils/logger';

export function useSavedPlaces() {
  const [recentSearches, setRecentSearches] = useState<SearchPlaceItem[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const isMountedRef = useRef(true);

  const reloadPlaces = useCallback(async () => {
    const recents = await storageService.getRecentSearchesAsync();
    const places = await savedPlacesService.getSavedPlaces();
    if (!isMountedRef.current) return;
    setRecentSearches(recents);
    setSavedPlaces(places);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    reloadPlaces().catch(error => {
      logger.warn('SavedPlaces', 'Unable to load saved places.', error);
    });
    return () => {
      isMountedRef.current = false;
    };
  }, [reloadPlaces]);

  const addRecentSearch = useCallback((item: SearchPlaceItem) => {
    const updated = storageService.addRecentSearch(item);
    setRecentSearches(updated);
  }, []);

  const savePlace = useCallback(async (place: SavedPlace) => {
    const updated = await savedPlacesService.savePlace(place);
    if (isMountedRef.current) {
      setSavedPlaces(updated);
    }
  }, []);

  const removeSavedPlace = useCallback(async (id: string) => {
    const updated = await savedPlacesService.deletePlace(id);
    if (isMountedRef.current) {
      setSavedPlaces(updated);
    }
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
