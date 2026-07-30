import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { geocodingService } from '../services/geocodingService';
import { type SearchPlaceItem } from '../services/searchService';
import { SavedPlace } from '../services/storageService';
import { NavigationState } from '../hooks/useNavigation';
import { SearchBar } from './SearchBar';
import { NearbyCategoryBar } from './NearbyCategoryBar';
import { NearbyCategory } from '../types/places';

interface SearchHeaderProps {
  userLocation: { latitude: number; longitude: number };
  navigationState: NavigationState;
  recentSearches: SearchPlaceItem[];
  savedPlaces: SavedPlace[];
  categories?: NearbyCategory[];
  selectedCategory?: string | null;
  onCategoryPress?: (category: NearbyCategory) => void;
  onSelectPlace: (item: SearchPlaceItem) => void;
  onSelectSavedPlace?: (place: SavedPlace) => void;
}

const ItemSeparator = React.memo(() => <View style={styles.divider} />);

const SearchResultCardItem = React.memo(({
  item,
  onPress,
}: {
  item: SearchPlaceItem;
  onPress: (item: SearchPlaceItem) => void;
}) => {
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

      {item.formattedDistance && (
        <View style={styles.distanceBadge}>
          <Text style={styles.distanceBadgeText}>
            {item.formattedDistance}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

export const SearchHeader: React.FC<SearchHeaderProps> = ({
  userLocation,
  navigationState,
  recentSearches,
  categories,
  selectedCategory = null,
  onCategoryPress,
  onSelectPlace,
}) => {
  const insets = useSafeAreaInsets();
  const [searchText, setSearchText] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchPlaceItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState<boolean>(false);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

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
        userLocation?.latitude && userLocation?.longitude
          ? userLocation
          : { latitude: 25.396, longitude: 68.3578 };

      const results = await geocodingService.searchPlaces(text, {
        userLocation: locationToUse,
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
  }, [userLocation]);

  const handleTextChange = useCallback((text: string) => {
    setSearchText(text);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (text.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      setHasSearched(false);
      setSearchError(null);
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      executeSearch(text);
    }, 350);
  }, [executeSearch]);

  const handleSelectItem = useCallback((item: SearchPlaceItem) => {
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
      length: 64,
      offset: 64 * index,
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
        placeholder="Search destination, fuel, food, atm..."
        isLoading={isSearching}
        onChangeText={handleTextChange}
        onClear={handleClearText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      />

      {/* Category Chips Row */}
      {searchText.length === 0 && categories && onCategoryPress && (
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
      ) : isFocused && searchText.length === 0 && recentSearches.length > 0 ? (
        <View style={styles.suggestionsContainer}>
          <Text style={styles.sectionHeader}>Recent Searches</Text>
          <FlatList
            data={recentSearches}
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
      ) : hasSearched && !isSearching && searchText.length >= 2 ? (
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
