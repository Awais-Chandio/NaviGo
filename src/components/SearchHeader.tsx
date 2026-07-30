import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
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

import { ScrollView } from 'react-native';

interface SearchHeaderProps {
  userLocation: { latitude: number; longitude: number };
  navigationState: NavigationState;
  recentSearches: SearchPlaceItem[];
  savedPlaces: SavedPlace[];
  onSelectPlace: (item: SearchPlaceItem) => void;
  onSelectSavedPlace?: (place: SavedPlace) => void;
}

const CATEGORY_CHIPS = [
  { id: 'gas', title: 'Gas', icon: '⛽', query: 'fuel station' },
  { id: 'food', title: 'Food', icon: '🍔', query: 'restaurant' },
  { id: 'hospital', title: 'Hospital', icon: '🏥', query: 'hospital' },
  { id: 'atm', title: 'ATM', icon: '🏧', query: 'atm bank' },
  { id: 'hotel', title: 'Hotel', icon: '🏨', query: 'hotel' },
  { id: 'shop', title: 'Shopping', icon: '🛒', query: 'shopping mall' },
  { id: 'mosque', title: 'Mosque', icon: '🕌', query: 'mosque' },
];

const ItemSeparator: React.FC = () => <View style={styles.divider} />;

export const SearchHeader: React.FC<SearchHeaderProps> = ({
  userLocation,
  navigationState,
  recentSearches,
  savedPlaces,
  onSelectPlace,
  onSelectSavedPlace,
}) => {
  const insets = useSafeAreaInsets();
  const [searchText, setSearchText] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchPlaceItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  if (navigationState === 'navigating') {
    return null;
  }

  const executeSearch = async (text: string) => {
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsSearching(true);
    setHasSearched(true);

    const results = await geocodingService.searchPlaces(text, {
      userLocation,
      countryCode: 'pk',
      limit: 10,
      signal: controller.signal,
    });

    setIsSearching(false);
    setSearchResults(results);
  };

  const handleTextChange = (text: string) => {
    setSearchText(text);
    setSelectedCategory(null);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (text.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      setHasSearched(false);
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      executeSearch(text);
    }, 500);
  };

  const handleCategoryPress = (cat: typeof CATEGORY_CHIPS[0]) => {
    setSearchText(cat.title);
    setSelectedCategory(cat.id);
    executeSearch(cat.query);
  };

  const handleSelectItem = (item: SearchPlaceItem) => {
    setSearchText(item.title);
    setSearchResults([]);
    setIsFocused(false);
    onSelectPlace(item);
  };

  const handleSelectSaved = (saved: SavedPlace) => {
    setIsFocused(false);
    setSearchResults([]);
    if (onSelectSavedPlace) {
      onSelectSavedPlace(saved);
    } else {
      handleSelectItem({
        id: saved.id,
        title: saved.title,
        subtitle: saved.subtitle,
        latitude: saved.latitude,
        longitude: saved.longitude,
        displayName: `${saved.title}, ${saved.subtitle}`,
      });
    }
  };

  const handleClearText = () => {
    setSearchText('');
    setSearchResults([]);
    setHasSearched(false);
    setSelectedCategory(null);
  };

  return (
    <View style={[styles.searchCard, { top: Math.max(insets.top + 10, 16) }]}>
      <View style={styles.searchInputRow}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search destination, food, fuel, atm in Pakistan..."
          placeholderTextColor="#757575"
          value={searchText}
          onChangeText={handleTextChange}
          onFocus={() => setIsFocused(true)}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {isSearching && (
          <ActivityIndicator
            size="small"
            color="#1a73e8"
            style={styles.searchSpinner}
          />
        )}
        {searchText.length > 0 && !isSearching && (
          <Pressable onPress={handleClearText} style={styles.clearButton}>
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Quick Category & Saved Places Chips Row */}
      {searchText.length === 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.savedRow}
        >
          {savedPlaces.map(place => (
            <Pressable
              key={`saved-${place.id}`}
              onPress={() => handleSelectSaved(place)}
              style={styles.savedChip}
            >
              <Text style={styles.chipIcon}>
                {place.type === 'home'
                  ? '🏠'
                  : place.type === 'work'
                  ? '💼'
                  : '⭐'}
              </Text>
              <Text style={styles.chipText}>{place.title}</Text>
            </Pressable>
          ))}

          {CATEGORY_CHIPS.map(cat => (
            <Pressable
              key={`cat-${cat.id}`}
              onPress={() => handleCategoryPress(cat)}
              style={[
                styles.categoryChip,
                selectedCategory === cat.id && styles.categoryChipActive,
              ]}
            >
              <Text style={styles.chipIcon}>{cat.icon}</Text>
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === cat.id && styles.categoryChipTextActive,
                ]}
              >
                {cat.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {searchResults.length > 0 ? (
        <View style={styles.suggestionsContainer}>
          <FlatList
            data={searchResults}
            keyExtractor={item => item.id.toString()}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={ItemSeparator}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleSelectItem(item)}
                style={({ pressed }) => [
                  styles.searchResultItem,
                  pressed && styles.itemPressed,
                ]}
              >
                <View style={styles.iconContainer}>
                  <Text style={styles.pinIcon}>{item.categoryIcon || '📍'}</Text>
                </View>
                <View style={styles.textContainer}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
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
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleSelectItem(item)}
                style={({ pressed }) => [
                  styles.searchResultItem,
                  pressed && styles.itemPressed,
                ]}
              >
                <View style={styles.iconContainer}>
                  <Text style={styles.pinIcon}>{item.categoryIcon || '🕒'}</Text>
                </View>
                <View style={styles.textContainer}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
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
            )}
          />
        </View>
      ) : hasSearched && !isSearching && searchText.length >= 2 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No locations found</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  searchCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    maxWidth: 600,
    alignSelf: 'center',
    width: '92%',
    zIndex: 10,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 52,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#202124',
    paddingVertical: 8,
  },
  searchSpinner: {
    marginLeft: 8,
  },
  clearButton: {
    padding: 6,
    marginLeft: 4,
  },
  clearText: {
    fontSize: 16,
    color: '#70757a',
    fontWeight: 'bold',
  },
  savedRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 8,
  },
  savedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  chipIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a73e8',
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f3f4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  categoryChipActive: {
    backgroundColor: '#1a73e8',
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3c4043',
  },
  categoryChipTextActive: {
    color: '#ffffff',
  },
  suggestionsContainer: {
    maxHeight: 320,
    borderTopWidth: 1,
    borderTopColor: '#f1f3f4',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#70757a',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#ffffff',
  },
  itemPressed: {
    backgroundColor: '#f5f5f5',
  },
  iconContainer: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f1f3f4',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  pinIcon: {
    fontSize: 16,
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 2,
  },
  resultSubtitle: {
    fontSize: 13,
    color: '#70757a',
  },
  distanceBadge: {
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  distanceBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1a73e8',
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f3f4',
    marginLeft: 58,
  },
  emptyContainer: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f3f4',
  },
  emptyText: {
    fontSize: 14,
    color: '#70757a',
  },
});
