import React, { useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { NearbyPlace } from '../types/places';
import { formatDistance } from '../utils/locationUtils';

interface NearbyPlacesCardProps {
  categoryTitle: string;
  categoryIcon: string;
  detectedArea?: string;
  places: NearbyPlace[];
  isLoading: boolean;
  selectedPlaceId: string | null;
  error?: string | null;
  onSelectPlace: (place: NearbyPlace) => void;
  onNavigateToPlace: (place: NearbyPlace) => void;
  onClose: () => void;
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

const NearbyPlaceItemCard = React.memo(({
  item,
  isSelected,
  onSelect,
  onNavigate,
}: {
  item: NearbyPlace;
  isSelected: boolean;
  onSelect: (place: NearbyPlace) => void;
  onNavigate: (place: NearbyPlace) => void;
}) => {
  const displayDistance =
    typeof item.roadDistance === 'number'
      ? formatDistance(item.roadDistance)
      : undefined;

  return (
    <TouchableOpacity
      style={[styles.placeItem, isSelected && styles.selectedPlaceItem]}
      onPress={() => onSelect(item)}
      activeOpacity={0.8}
    >
      <View style={styles.placeInfo}>
        <Text style={styles.placeName} numberOfLines={1}>
          {item.name}
        </Text>
        {displayDistance ? (
          <Text style={styles.distanceText}>{displayDistance} by road</Text>
        ) : null}
        {!!item.address && (
          <Text style={styles.addressText} numberOfLines={1}>
            {item.address}
          </Text>
        )}
      </View>

      <TouchableOpacity
        style={styles.directionButton}
        onPress={() => onNavigate(item)}
        activeOpacity={0.7}
      >
        <Text style={styles.directionIcon}>➔</Text>
        <Text style={styles.directionText}>Directions</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
});

const NearbyPlacesCardComponent: React.FC<NearbyPlacesCardProps> = ({
  categoryTitle,
  categoryIcon,
  detectedArea,
  places,
  isLoading,
  selectedPlaceId,
  error,
  onSelectPlace,
  onNavigateToPlace,
  onClose,
}) => {
  const getItemLayout = useCallback(
    (_data: unknown, index: number) => ({
      length: 76,
      offset: 76 * index,
      index,
    }),
    [],
  );

  const displayTitle =
    detectedArea &&
    detectedArea !== 'Current Area' &&
    detectedArea !== 'Current Location'
      ? `${categoryTitle} near ${detectedArea}`
      : `${categoryTitle} Near You`;

  return (
    <View style={styles.cardContainer}>
      <View style={styles.dragHandleBar} />

      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerIcon}>{categoryIcon}</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayTitle}
          </Text>
          {places.length > 0 && (
            <Text style={styles.countBadge}>{places.length}</Text>
          )}
          {isLoading && places.length > 0 && (
            <ActivityIndicator
              size="small"
              color="#1A73E8"
              style={styles.refreshIndicator}
            />
          )}
        </View>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      {isLoading && places.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1A73E8" />
          <Text style={styles.loadingText}>
            Searching {categoryTitle.toLowerCase()} near your location...
          </Text>
        </View>
      ) : error ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>⚠️</Text>
          <Text style={styles.emptyTitle}>Search Error</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : places.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📍</Text>
          <Text style={styles.emptyTitle}>No Places Found</Text>
          <Text style={styles.emptyText}>
            No nearby {categoryTitle.toLowerCase()} found around your current
            location.
          </Text>
        </View>
      ) : (
        <FlatList
          data={places}
          keyExtractor={item => item.id}
          getItemLayout={getItemLayout}
          renderItem={({ item }) => (
            <NearbyPlaceItemCard
              item={item}
              isSelected={selectedPlaceId === item.id}
              onSelect={onSelectPlace}
              onNavigate={onNavigateToPlace}
            />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          style={styles.list}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          ListFooterComponent={
            isLoading ? (
              <Text style={styles.updatingText}>Updating nearby results…</Text>
            ) : null
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: SCREEN_HEIGHT * 0.44,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    paddingTop: 10,
    zIndex: 15,
  },
  dragHandleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DADCE0',
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F4',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  headerIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#202124',
    flexShrink: 1,
  },
  countBadge: {
    marginLeft: 8,
    backgroundColor: '#E8F0FE',
    color: '#1A73E8',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  refreshIndicator: {
    marginLeft: 8,
  },
  updatingText: {
    paddingVertical: 10,
    textAlign: 'center',
    color: '#5F6368',
    fontSize: 12,
    fontWeight: '500',
  },
  closeButton: {
    padding: 6,
    backgroundColor: '#F1F3F4',
    borderRadius: 14,
  },
  closeText: {
    fontSize: 13,
    color: '#5F6368',
    fontWeight: 'bold',
  },
  loadingContainer: {
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#5F6368',
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 13,
    color: '#70757A',
    textAlign: 'center',
  },
  list: {
    maxHeight: SCREEN_HEIGHT * 0.34,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  placeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 68,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 8,
    backgroundColor: '#F8F9FA',
  },
  selectedPlaceItem: {
    backgroundColor: '#E8F0FE',
    borderWidth: 1.5,
    borderColor: '#1A73E8',
  },
  placeInfo: {
    flex: 1,
    marginRight: 12,
  },
  placeName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 2,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A73E8',
    marginBottom: 2,
  },
  addressText: {
    fontSize: 11,
    color: '#5F6368',
  },
  directionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A73E8',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  directionIcon: {
    color: '#FFFFFF',
    fontSize: 11,
    marginRight: 4,
  },
  directionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});

export const NearbyPlacesCard = React.memo(NearbyPlacesCardComponent);
