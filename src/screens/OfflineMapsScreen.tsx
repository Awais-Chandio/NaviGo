import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DuplicateOfflineRegionError,
  offlineMapManager,
} from '../services/offlineMapService';
import {
  DownloadProgress,
  OfflineRegion,
  OfflineRegionCenter,
} from '../types/location';
import { OfflineMapCard } from '../components/OfflineMapCard';
import { OfflineCoverageMap } from '../components/OfflineCoverageMap';
import { LOCATION_CONFIG } from '../config/locationConfig';
import { logger } from '../utils/logger';
import {
  cityMapService,
  type CityDownloadPlan,
} from '../services/cityMapService';

interface OfflineMapsScreenProps {
  visible: boolean;
  userLocation?: OfflineRegionCenter;
  suggestedRegionName?: string;
  suggestedCityName?: string;
  suggestedCountryCode?: string;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1024
    ? `${(megabytes / 1024).toFixed(1)} GB`
    : `${megabytes.toFixed(1)} MB`;
}

function getFallbackRegionName(location: OfflineRegionCenter): string {
  return `Current Area (${location.latitude.toFixed(
    3,
  )}, ${location.longitude.toFixed(3)})`;
}

export const OfflineMapsScreen: React.FC<OfflineMapsScreenProps> = ({
  visible,
  userLocation,
  suggestedRegionName,
  suggestedCityName,
  suggestedCountryCode,
  onClose,
}) => {
  const [regions, setRegions] = useState<OfflineRegion[]>([]);
  const [activeProgress, setActiveProgress] = useState<
    Record<string, DownloadProgress>
  >({});
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [storageUsage, setStorageUsage] = useState({
    totalSizeBytes: 0,
    regionCount: 0,
  });
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isPreparingCity, setIsPreparingCity] = useState(false);
  const isMountedRef = useRef(true);
  const cacheClearInFlightRef = useRef(false);
  const listRef = useRef<FlatList<OfflineRegion>>(null);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const syncRegions = useCallback((nextRegions: OfflineRegion[]) => {
    if (!isMountedRef.current) return;
    const sortedRegions = [...nextRegions].sort((first, second) => {
      const firstReady =
        first.status === 'completed' && first.isDownloaded ? 1 : 0;
      const secondReady =
        second.status === 'completed' && second.isDownloaded ? 1 : 0;
      if (firstReady !== secondReady) return secondReady - firstReady;
      return second.createdAt.localeCompare(first.createdAt);
    });
    setRegions(sortedRegions);
    setStorageUsage(offlineMapManager.getStorageUsage());
    setSelectedRegionId(previous => {
      if (previous && sortedRegions.some(region => region.id === previous)) {
        return previous;
      }
      return (
        sortedRegions.find(region => region.status === 'completed')?.id ??
        sortedRegions[0]?.id ??
        null
      );
    });
  }, []);

  const loadRegions = useCallback(async () => {
    await offlineMapManager.initialize();
    syncRegions(offlineMapManager.getRegions());
  }, [syncRegions]);

  useEffect(() => {
    if (!visible) return;
    loadRegions().catch(error => {
      logger.warn('OfflineMaps', 'Unable to load offline regions.', error);
    });
    return offlineMapManager.subscribe((nextRegions, progress) => {
      syncRegions(nextRegions);
      if (progress) {
        setActiveProgress(previous => ({
          ...previous,
          [progress.regionId]: progress,
        }));
      }
    });
  }, [loadRegions, syncRegions, visible]);

  const selectedRegion = useMemo(
    () => regions.find(region => region.id === selectedRegionId) ?? null,
    [regions, selectedRegionId],
  );

  const matchingCurrentRegions = useMemo(() => {
    if (!userLocation) return [];
    return regions.filter(
      region =>
        region.status === 'completed' &&
        region.isDownloaded &&
        offlineMapManager.isPointInsideRegion(userLocation, region),
    );
  }, [regions, userLocation]);

  const handleSelectRegion = useCallback((regionId: string) => {
    setSelectedRegionId(regionId);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const handleDownload = useCallback(
    (regionId: string) => {
      offlineMapManager
        .downloadRegion(regionId, progress => {
          if (!isMountedRef.current) return;
          setActiveProgress(previous => ({
            ...previous,
            [regionId]: progress,
          }));
        })
        .then(loadRegions)
        .catch(error => {
          if (!isMountedRef.current) return;
          if (error instanceof DuplicateOfflineRegionError) {
            handleSelectRegion(error.regionId);
            Alert.alert('Already Downloaded', error.message);
            return;
          }
          setActiveProgress(previous => {
            const next = { ...previous };
            delete next[regionId];
            return next;
          });
          logger.warn('OfflineMaps', 'Offline map download failed.', error);
          Alert.alert(
            'Download Failed',
            error instanceof Error
              ? error.message
              : 'The offline map could not be downloaded. Tap Retry to try again.',
          );
        });
    },
    [handleSelectRegion, loadRegions],
  );

  const handleDelete = useCallback(
    (regionId: string) => {
      const region = offlineMapManager.getRegion(regionId);
      Alert.alert(
        'Delete Offline Map',
        `Delete ${
          region?.name ?? 'this offline region'
        } and its downloaded map data?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await offlineMapManager.deleteRegion(regionId);
                if (!isMountedRef.current) return;
                setActiveProgress(previous => {
                  const next = { ...previous };
                  delete next[regionId];
                  return next;
                });
                await loadRegions();
              } catch (error) {
                logger.warn(
                  'OfflineMaps',
                  'Offline map deletion failed.',
                  error,
                );
                Alert.alert(
                  'Delete Failed',
                  error instanceof Error
                    ? error.message
                    : 'Unable to delete this offline map.',
                );
              }
            },
          },
        ],
      );
    },
    [loadRegions],
  );

  const handleDownloadCurrentRegion = useCallback(async () => {
    if (!userLocation) {
      Alert.alert(
        'GPS Unavailable',
        'Wait for an accurate GPS fix before downloading the current area.',
      );
      return;
    }

    const normalizedSuggestedName = suggestedRegionName?.trim();
    const name =
      normalizedSuggestedName &&
      normalizedSuggestedName !== 'Current Location' &&
      normalizedSuggestedName !== 'Current Area'
        ? normalizedSuggestedName
        : getFallbackRegionName(userLocation);

    try {
      const newRegion = await offlineMapManager.createRegionAroundPoint({
        name,
        center: userLocation,
        radiusKm: LOCATION_CONFIG.DEFAULT_OFFLINE_REGION_RADIUS_KM,
        minZoom: 10,
        maxZoom: 16,
      });
      handleSelectRegion(newRegion.id);
      await loadRegions();
      handleDownload(newRegion.id);
    } catch (error) {
      if (error instanceof DuplicateOfflineRegionError) {
        handleSelectRegion(error.regionId);
        const existingRegion = offlineMapManager.getRegion(error.regionId);
        const title =
          existingRegion?.status === 'completed'
            ? 'Already Downloaded'
            : 'Region Already Exists';
        const message =
          existingRegion?.status === 'completed'
            ? `${existingRegion.name} already provides this offline coverage.`
            : `${
                existingRegion?.name ?? 'This region'
              } already exists. Use its Download or Retry button instead.`;
        Alert.alert(title, message);
        return;
      }
      logger.warn('OfflineMaps', 'Unable to create offline region.', error);
      Alert.alert(
        'Offline Map Error',
        error instanceof Error
          ? error.message
          : 'Unable to create this offline region.',
      );
    }
  }, [
    handleDownload,
    handleSelectRegion,
    loadRegions,
    suggestedRegionName,
    userLocation,
  ]);

  const handleCreateCityRegion = useCallback(
    async (plan: CityDownloadPlan) => {
      try {
        const newRegion = await offlineMapManager.createRegionAroundPoint({
          name: plan.name,
          center: plan.center,
          radiusKm: plan.radiusKm,
          minZoom: 9,
          maxZoom: 16,
        });
        handleSelectRegion(newRegion.id);
        await loadRegions();
        handleDownload(newRegion.id);
      } catch (error) {
        if (error instanceof DuplicateOfflineRegionError) {
          handleSelectRegion(error.regionId);
          const existingRegion = offlineMapManager.getRegion(error.regionId);
          Alert.alert(
            existingRegion?.status === 'completed'
              ? 'City Already Downloaded'
              : 'City Download Already Exists',
            existingRegion?.status === 'completed'
              ? `${existingRegion.name} is already ready for offline use.`
              : `${
                  existingRegion?.name ?? 'This city map'
                } already exists. Use its Download or Retry button instead.`,
          );
          return;
        }
        logger.warn('OfflineMaps', 'Unable to create city map region.', error);
        Alert.alert(
          'City Map Error',
          error instanceof Error
            ? error.message
            : 'Unable to create the city map download.',
        );
      } finally {
        if (isMountedRef.current) {
          setIsPreparingCity(false);
        }
      }
    },
    [handleDownload, handleSelectRegion, loadRegions],
  );

  const handleDownloadCity = useCallback(async () => {
    if (!userLocation || isPreparingCity) {
      if (!userLocation) {
        Alert.alert(
          'GPS Unavailable',
          'Wait for an accurate GPS fix before downloading a city map.',
        );
      }
      return;
    }

    setIsPreparingCity(true);
    try {
      const plan = await cityMapService.resolveDownloadPlan({
        cityName: suggestedCityName,
        countryCode: suggestedCountryCode,
        userLocation,
      });
      const estimate = offlineMapManager.estimateRegionDownload(
        plan.center,
        plan.radiusKm,
        9,
        16,
      );
      const coverageDescription = plan.usedFallback
        ? `${plan.radiusKm.toFixed(0)} km around the city center`
        : `the detected city boundary with a ${plan.radiusKm.toFixed(
            1,
          )} km guaranteed coverage radius`;

      Alert.alert(
        `Download ${plan.name}?`,
        `This covers ${coverageDescription}. Estimated download: ${formatBytes(
          estimate.estimatedSizeBytes,
        )}. Wi-Fi is recommended.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => setIsPreparingCity(false),
          },
          {
            text: 'Download',
            onPress: () => {
              handleCreateCityRegion(plan).catch(error => {
                logger.warn(
                  'OfflineMaps',
                  'Unexpected city download setup failure.',
                  error,
                );
                if (isMountedRef.current) {
                  setIsPreparingCity(false);
                }
              });
            },
          },
        ],
        {
          cancelable: true,
          onDismiss: () => setIsPreparingCity(false),
        },
      );
    } catch (error) {
      logger.warn('OfflineMaps', 'City boundary lookup failed.', error);
      Alert.alert(
        'City Map Unavailable',
        error instanceof Error
          ? error.message
          : 'Unable to identify the complete city boundary.',
      );
      if (isMountedRef.current) {
        setIsPreparingCity(false);
      }
    }
  }, [
    handleCreateCityRegion,
    isPreparingCity,
    suggestedCityName,
    suggestedCountryCode,
    userLocation,
  ]);

  const handleClearCache = useCallback(async () => {
    if (cacheClearInFlightRef.current) return;
    cacheClearInFlightRef.current = true;
    setIsClearingCache(true);
    try {
      await offlineMapManager.clearCache();
      Alert.alert(
        'Cache Cleared',
        'Temporary map tiles were cleared. Downloaded offline regions were preserved.',
      );
    } catch (error) {
      Alert.alert(
        'Cache Clear Failed',
        error instanceof Error
          ? error.message
          : 'Unable to clear the temporary map cache.',
      );
    } finally {
      cacheClearInFlightRef.current = false;
      if (isMountedRef.current) {
        setIsClearingCache(false);
      }
    }
  }, []);

  const isCurrentLocationCovered = matchingCurrentRegions.length > 0;
  const currentCoverageText = !userLocation
    ? 'Waiting for an accurate GPS location'
    : isCurrentLocationCovered
    ? `Covered by ${matchingCurrentRegions
        .map(region => region.name)
        .join(', ')}`
    : 'Download the current area to use this map without internet';

  const listHeader = (
    <View>
      <View
        style={[
          styles.availabilityBanner,
          isCurrentLocationCovered
            ? styles.availableBanner
            : styles.unavailableBanner,
        ]}
      >
        <Text
          style={[
            styles.availabilityTitle,
            isCurrentLocationCovered
              ? styles.availableText
              : styles.unavailableText,
          ]}
        >
          {isCurrentLocationCovered
            ? '✓ Offline Map Available'
            : 'Offline Map Not Available'}
        </Text>
        <Text style={styles.availabilitySubtitle}>{currentCoverageText}</Text>
      </View>

      <View style={styles.storageBanner}>
        <View style={styles.storageInfo}>
          <Text style={styles.storageTitle}>Downloaded Coverage</Text>
          <Text style={styles.storageSubtitle}>
            {storageUsage.regionCount} ready{' '}
            {storageUsage.regionCount === 1 ? 'region' : 'regions'} •{' '}
            {formatBytes(storageUsage.totalSizeBytes)} used
          </Text>
        </View>

        <View style={styles.downloadActions}>
          <TouchableOpacity
            style={[
              styles.downloadCityButton,
              (!userLocation || isPreparingCity) &&
                styles.downloadCurrentButtonDisabled,
            ]}
            onPress={handleDownloadCity}
            disabled={!userLocation || isPreparingCity}
            activeOpacity={0.8}
          >
            <Text style={styles.downloadCurrentText}>
              {isPreparingCity
                ? 'Preparing City Map…'
                : suggestedCityName
                ? `Download ${suggestedCityName} City`
                : 'Download Whole City'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.downloadCurrentButton,
              !userLocation && styles.downloadAreaButtonDisabled,
            ]}
            onPress={handleDownloadCurrentRegion}
            disabled={!userLocation}
            activeOpacity={0.8}
          >
            <Text style={styles.downloadAreaText}>
              Download Current{' '}
              {LOCATION_CONFIG.DEFAULT_OFFLINE_REGION_RADIUS_KM} km Area
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {selectedRegion && (
        <View style={styles.coverageSection}>
          <View style={styles.sectionHeadingRow}>
            <View style={styles.sectionHeadingText}>
              <Text style={styles.sectionTitle}>{selectedRegion.name}</Text>
              <Text style={styles.sectionSubtitle}>
                {selectedRegion.isDownloaded &&
                selectedRegion.status === 'completed'
                  ? 'Blue circle = guaranteed offline coverage'
                  : 'Blue circle = planned coverage after download'}
              </Text>
            </View>
            <View style={styles.radiusBadge}>
              <Text style={styles.radiusBadgeText}>
                {selectedRegion.radiusKm.toFixed(1)} km
              </Text>
            </View>
          </View>
          <OfflineCoverageMap
            region={selectedRegion}
            currentLocation={userLocation}
          />
          <Text style={styles.coverageNote}>
            The MapLibre tile pack uses the circle’s enclosing bounds. Coverage
            checks and offline navigation validation use the blue circle once
            the download is complete.
          </Text>
        </View>
      )}

      <View style={styles.navigationNotice}>
        <Text style={styles.navigationNoticeTitle}>
          Offline navigation coverage
        </Text>
        <Text style={styles.navigationNoticeText}>
          Before an already-planned route starts offline, NaviGo checks the
          current location, destination, and route against downloaded coverage.
          Creating a new route or rerouting without internet still requires an
          offline routing engine.
        </Text>
      </View>

      <Text style={styles.listTitle}>Your Offline Regions</Text>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Offline Maps</Text>
          <TouchableOpacity
            onPress={handleClearCache}
            style={[
              styles.cacheButton,
              isClearingCache && styles.cacheButtonDisabled,
            ]}
            disabled={isClearingCache}
          >
            <Text style={styles.cacheButtonText}>
              {isClearingCache ? 'Clearing…' : 'Clear Cache'}
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          ref={listRef}
          data={regions}
          keyExtractor={item => item.id}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No offline regions yet</Text>
              <Text style={styles.emptyText}>
                Download the area around your current location to see its exact
                coverage here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <OfflineMapCard
              region={item}
              progress={activeProgress[item.id]}
              isSelected={selectedRegionId === item.id}
              onSelect={handleSelectRegion}
              onDownload={handleDownload}
              onDelete={handleDelete}
            />
          )}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8EAED',
  },
  closeButton: {
    padding: 6,
  },
  closeText: {
    fontSize: 18,
    color: '#5F6368',
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#202124',
  },
  cacheButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  cacheButtonDisabled: {
    opacity: 0.55,
  },
  cacheButtonText: {
    fontSize: 13,
    color: '#1A73E8',
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  availabilityBanner: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  availableBanner: {
    backgroundColor: '#E6F4EA',
    borderColor: '#A8DAB5',
  },
  unavailableBanner: {
    backgroundColor: '#FEF7E0',
    borderColor: '#FDD663',
  },
  availabilityTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 3,
  },
  availableText: {
    color: '#137333',
  },
  unavailableText: {
    color: '#B06000',
  },
  availabilitySubtitle: {
    fontSize: 12,
    color: '#3C4043',
    lineHeight: 17,
  },
  storageBanner: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8EAED',
    marginBottom: 16,
  },
  storageInfo: {
    marginBottom: 12,
  },
  storageTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 2,
  },
  storageSubtitle: {
    fontSize: 12,
    color: '#5F6368',
  },
  downloadCurrentButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1A73E8',
  },
  downloadCityButton: {
    backgroundColor: '#1A73E8',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
  },
  downloadCurrentButtonDisabled: {
    backgroundColor: '#BDC1C6',
  },
  downloadAreaButtonDisabled: {
    borderColor: '#BDC1C6',
  },
  downloadActions: {
    gap: 8,
  },
  downloadCurrentText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  downloadAreaText: {
    color: '#1A73E8',
    fontSize: 13,
    fontWeight: '700',
  },
  coverageSection: {
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D2E3FC',
    marginBottom: 16,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeadingText: {
    flex: 1,
    marginRight: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#202124',
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#5F6368',
    marginTop: 2,
  },
  radiusBadge: {
    backgroundColor: '#E8F0FE',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  radiusBadgeText: {
    color: '#174EA6',
    fontSize: 12,
    fontWeight: '700',
  },
  coverageNote: {
    marginTop: 9,
    fontSize: 11,
    lineHeight: 16,
    color: '#5F6368',
  },
  navigationNotice: {
    backgroundColor: '#F1F3F4',
    borderRadius: 14,
    padding: 13,
    marginBottom: 18,
  },
  navigationNoticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 3,
  },
  navigationNoticeText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#5F6368',
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 10,
  },
  emptyState: {
    paddingVertical: 30,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#3C4043',
    marginBottom: 5,
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    color: '#5F6368',
  },
});
