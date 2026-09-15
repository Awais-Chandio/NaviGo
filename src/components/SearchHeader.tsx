import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { geocodingService } from '../services/geocodingService';
import { type SearchPlaceItem, MIN_SEARCH_QUERY_LENGTH } from '../services/searchService';
import { SavedPlace } from '../services/storageService';
import { NavigationState } from '../hooks/useNavigation';
import { SearchBar } from './SearchBar';
import { NearbyCategoryBar } from './NearbyCategoryBar';
import { NearbyCategory } from '../types/places';
import {
  formatDistance,
  getHaversineDistance,
  isValidCoordinate,
} from '../utils/locationUtils';
import { LOCATION_CONFIG } from '../config/locationConfig';

interface SearchHeaderProps {
  userLocation: { latitude: number; longitude: number };
  hasLocationFix: boolean;
  countryCode?: string;
  navigationState: NavigationState;
  recentSearches: SearchPlaceItem[];
  savedPlaces: SavedPlace[];
  categories?: NearbyCategory[];
  selectedCategory?: string | null;
  savedPlaceSetupType?: 'home' | 'work' | null;
  onCategoryPress?: (category: NearbyCategory) => void;
  onCancelSavedPlaceSetup?: () => void;
  onSelectPlace: (item: SearchPlaceItem) => void;
  onSelectSavedPlace?: (place: SavedPlace) => void;
}

const ItemSeparator = React.memo(() => <View style={styles.divider} />);

function withoutDistance(item: SearchPlaceItem): SearchPlaceItem {
  return {
    ...item,
    distanceMeters: undefined,
    formattedDistance: undefined,
  };
}

function withDistanceFromOrigin(
  item: SearchPlaceItem,
  latitude: number,
  longitude: number,
): SearchPlaceItem {
  if (!isValidCoordinate(item.latitude, item.longitude, true)) {
    return withoutDistance(item);
  }
  const distance = Math.round(
    getHaversineDistance(latitude, longitude, item.latitude, item.longitude),
  );
  return {
    ...item,
    distanceMeters: distance,
    formattedDistance: formatDistance(distance),
  };
}

const SearchResultCardItem = React.memo(({
  item,
  onPress,
}: {
  item: SearchPlaceItem;
  onPress: (item: SearchPlaceItem) => void;
}) => {
  const displayDistance =
    typeof item.distanceMeters === 'number'
      ? formatDistance(item.distanceMeters)
      : item.formattedDistance;

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.searchResultItem,
        pressed && styles.itemPressed,
      ]}
    >
      <View style={styles.iconContainer}>
        <Text style={styles.pinIcon}>{item.categoryIcon || '📍'}</Text>
      </View>
      <View style={styles.textContainer}>
        <View style={styles.titleRow}>
          <Text style={styles.resultTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {item.categoryName ? (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{item.categoryName}</Text>
            </View>
          ) : null}
        </View>
        {item.subtitle ? (
          <Text style={styles.resultSubtitle} numberOfLines={1}>
            {item.subtitle}
          </Text>
        ) : null}
      </View>

      {displayDistance && (
        <View style={styles.distanceBadge}>
          <Text style={styles.distanceBadgeText}>{displayDistance}</Text>
        </View>
      )}
    </Pressable>
  );
});

export const SearchHeader: React.FC<SearchHeaderProps> = ({
  userLocation,
  hasLocationFix,
  countryCode,
  navigationState,
  recentSearches,
  categories,
  selectedCategory = null,
  savedPlaceSetupType = null,
  onCategoryPress,
  onCancelSavedPlaceSetup,
  onSelectPlace,
}) => {
  const insets = useSafeAreaInsets();
  const [searchText, setSearchText] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchPlaceItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [currentRecentSearches, setCurrentRecentSearches] = useState<
    SearchPlaceItem[]
  >(() => recentSearches.map(withoutDistance));

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const previousSetupTypeRef = useRef<'home' | 'work' | null>(null);
  const userLatitude = userLocation.latitude;
  const userLongitude = userLocation.longitude;

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    const withoutStaleDistances = recentSearches.map(withoutDistance);

    if (
      recentSearches.length === 0 ||
      !hasLocationFix ||
      !isValidCoordinate(userLatitude, userLongitude, true)
    ) {
      setCurrentRecentSearches(withoutStaleDistances);
      return;
    }

    const withCurrentDirectDistances = recentSearches.map(item =>
      withDistanceFromOrigin(item, userLatitude, userLongitude),
    );
    setCurrentRecentSearches(withCurrentDirectDistances);
  }, [hasLocationFix, recentSearches, userLatitude, userLongitude]);

  useEffect(() => {
    if (previousSetupTypeRef.current !== savedPlaceSetupType) {
      setSearchText('');
      setSearchResults([]);
      setIsSearching(false);
      setHasSearched(false);
      setSearchError(null);
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
    }
    previousSetupTypeRef.current = savedPlaceSetupType;
  }, [savedPlaceSetupType]);

  const executeSearch = useCallback(async (text: string) => {
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsSearching(true);
    setHasSearched(true);
    setSearchError(null);

    try {
      const locationToUse =
        hasLocationFix &&
        Number.isFinite(userLatitude) &&
        Number.isFinite(userLongitude)
          ? { latitude: userLatitude, longitude: userLongitude }
          : undefined;

      if (!locationToUse) {
        setIsSearching(false);
        setSearchResults([]);
        setSearchError('Waiting for your current location. Enable location to search nearby.');
        return;
      }
      const results = await geocodingService.searchPlaces(text, {
        userLocation: locationToUse,
        countryCode,
        radiusMeters: LOCATION_CONFIG.TYPED_SEARCH_RADIUS_METERS,
        limit: 15,
        signal: controller.signal,
      });

      if (
        controller.signal.aborted ||
        searchAbortRef.current !== controller
      ) {
        return;
      }
      setIsSearching(false);
      setSearchResults(results);
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name: string }).name === 'AbortError'
      ) {
        return;
      }
      if (searchAbortRef.current !== controller) {
        return;
      }
      setIsSearching(false);
      setSearchError('Unable to fetch search results. Please check connection.');
      setSearchResults([]);
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }
    }
  }, [countryCode, hasLocationFix, userLatitude, userLongitude]);

  const handleTextChange = useCallback((text: string) => {
    setSearchText(text);
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setSearchResults([]);
    setSearchError(null);
    setIsSearching(text.trim().length >= MIN_SEARCH_QUERY_LENGTH);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (text.trim().length < MIN_SEARCH_QUERY_LENGTH) {
      setSearchResults([]);
      setIsSearching(false);
      setHasSearched(false);
      setSearchError(null);
      return;
    }

  }, []);

  useEffect(() => {
    if (!isFocused || searchText.trim().length < MIN_SEARCH_QUERY_LENGTH) return;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setSearchResults([]);
    searchTimeoutRef.current = setTimeout(() => {
      executeSearch(searchText);
    }, LOCATION_CONFIG.SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
    };
  }, [executeSearch, isFocused, searchText]);

  const handleSelectItem = useCallback((item: SearchPlaceItem) => {
    Keyboard.dismiss();
    setSearchText(item.title);
    setSearchResults([]);
    setIsFocused(false);
    onSelectPlace(item);
  }, [onSelectPlace]);

  const handleClearText = useCallback(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    setSearchText('');
    setSearchResults([]);
    setIsSearching(false);
    setHasSearched(false);
    setSearchError(null);
  }, []);

  const getItemLayout = useCallback(
    (_data: unknown, index: number) => ({
      length: 65,
      offset: 65 * index,
      index,
    }),
    [],
  );

  if (navigationState === 'navigating') {
    return null;
  }

  return (
    <View style={[styles.container, { top: Math.max(insets.top + 8, 14) }]}>
      {/* Search Input Bar */}
      <SearchBar
        value={searchText}
        placeholder={
          savedPlaceSetupType
            ? `Search ${savedPlaceSetupType === 'home' ? 'Home' : 'Work'} address...`
            : 'Search destination, fuel, food, atm...'
        }
        isLoading={isSearching}
        focusRequestKey={savedPlaceSetupType}
        onChangeText={handleTextChange}
        onClear={handleClearText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      />

      {savedPlaceSetupType && (
        <View style={styles.savedPlaceSetupBanner}>
          <Text style={styles.savedPlaceSetupText}>
            Search and select your{' '}
            {savedPlaceSetupType === 'home' ? 'Home' : 'Work'} address
          </Text>
          <Pressable
            onPress={onCancelSavedPlaceSetup}
            accessibilityRole="button"
            accessibilityLabel="Cancel address setup"
            hitSlop={8}
          >
            <Text style={styles.savedPlaceSetupCancel}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {/* Category Chips Row */}
      {searchText.length === 0 &&
        !savedPlaceSetupType &&
        categories &&
        onCategoryPress && (
        <View style={styles.categoryBarWrapper}>
          <NearbyCategoryBar
            categories={categories}
            selectedCategory={selectedCategory}
            onCategoryPress={onCategoryPress}
          />
        </View>
      )}

      {/* Search Results / Suggestions Overlay */}
      {searchResults.length > 0 ? (
        <View style={styles.suggestionsContainer}>
          <FlatList
            data={searchResults}
            keyExtractor={item => String(item.id)}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={ItemSeparator}
            getItemLayout={getItemLayout}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={true}
            renderItem={({ item }) => (
              <SearchResultCardItem item={item} onPress={handleSelectItem} />
            )}
          />
        </View>
      ) : isFocused &&
        searchText.length === 0 &&
        currentRecentSearches.length > 0 ? (
        <View style={styles.suggestionsContainer}>
          <Text style={styles.sectionHeader}>Recent Searches</Text>
          <FlatList
            data={currentRecentSearches}
            keyExtractor={item => `recent-${item.id}`}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={ItemSeparator}
            getItemLayout={getItemLayout}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={true}
            renderItem={({ item }) => (
              <SearchResultCardItem item={item} onPress={handleSelectItem} />
            )}
          />
        </View>
      ) : isSearching ? (
        <View style={styles.statusContainer}>
          <ActivityIndicator size="small" color="#1A73E8" />
          <Text style={styles.statusText}>Searching places...</Text>
        </View>
      ) : searchError ? (
        <View style={styles.statusContainer}>
          <Text style={styles.errorText}>{searchError}</Text>
        </View>
      ) : hasSearched && !isSearching && searchText.length >= MIN_SEARCH_QUERY_LENGTH ? (
        <View style={styles.statusContainer}>
          <Text style={styles.emptyText}>No matching places found</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    maxWidth: 600,
    alignSelf: 'center',
    width: '92%',
    zIndex: 20,
  },
  categoryBarWrapper: {
    marginTop: 8,
  },
  savedPlaceSetupBanner: {
    marginTop: 8,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  savedPlaceSetupText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#174EA6',
  },
  savedPlaceSetupCancel: {
    marginLeft: 10,
    fontSize: 12,
    fontWeight: '700',
    color: '#D93025',
  },
  suggestionsContainer: {
    maxHeight: 320,
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#70757A',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
  },
  itemPressed: {
    backgroundColor: '#F5F5F5',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F3F4',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  pinIcon: {
    fontSize: 18,
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#202124',
    flexShrink: 1,
  },
  categoryBadge: {
    marginLeft: 6,
    backgroundColor: '#F1F3F4',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#5F6368',
  },
  resultSubtitle: {
    fontSize: 12,
    color: '#70757A',
  },
  distanceBadge: {
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  distanceBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A73E8',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F3F4',
    marginLeft: 62,
  },
  statusContainer: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginTop: 8,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statusText: {
    fontSize: 14,
    color: '#5F6368',
    marginLeft: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#70757A',
  },
  errorText: {
    fontSize: 13,
    color: '#D93025',
    fontWeight: '500',
  },
});
