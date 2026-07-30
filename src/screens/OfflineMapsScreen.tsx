import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { offlineMapService } from '../services/offlineMapService';
import { OfflineRegion, DownloadProgress } from '../types/location';
import { OfflineMapCard } from '../components/OfflineMapCard';
import { LOCATION_CONFIG } from '../config/locationConfig';

interface OfflineMapsScreenProps {
  visible: boolean;
  userLocation?: { latitude: number; longitude: number };
  onClose: () => void;
}

export const OfflineMapsScreen: React.FC<OfflineMapsScreenProps> = ({
  visible,
  userLocation,
  onClose,
}) => {
  const [regions, setRegions] = useState<OfflineRegion[]>([]);
  const [activeProgress, setActiveProgress] = useState<Record<string, DownloadProgress>>({});
  const [storageUsage, setStorageUsage] = useState<{ totalSizeBytes: number; regionCount: number }>({
    totalSizeBytes: 0,
    regionCount: 0,
  });
  const isMountedRef = useRef(true);

  const loadRegions = useCallback(async () => {
    await offlineMapService.initialize();
    if (!isMountedRef.current) return;
    const list = offlineMapService.getRegions();
    setRegions(list);
    setStorageUsage(offlineMapService.getStorageUsage());
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (visible) {
      void loadRegions();
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [visible, loadRegions]);

  const handleDownload = useCallback((regionId: string) => {
    offlineMapService
      .startDownload(regionId, progress => {
        if (!isMountedRef.current) return;
        setActiveProgress(prev => ({
          ...prev,
          [regionId]: progress,
        }));
        if (progress.percentage >= 100) {
          void loadRegions();
        }
      })
      .then(() => {
        void loadRegions();
      })
      .catch(err => {
        Alert.alert('Download Error', String(err));
      });
  }, [loadRegions]);

  const handleDelete = useCallback((regionId: string) => {
    Alert.alert(
      'Delete Offline Map',
      'Are you sure you want to delete this offline region tile pack?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await offlineMapService.deleteRegion(regionId);
            if (!isMountedRef.current) return;
            setActiveProgress(prev => {
              const copy = { ...prev };
              delete copy[regionId];
              return copy;
            });
            void loadRegions();
          },
        },
      ],
    );
  }, [loadRegions]);

  const handleDownloadCurrentRegion = useCallback(async () => {
    if (!userLocation || !userLocation.latitude || !userLocation.longitude) {
      Alert.alert('GPS Unavailable', 'Current location is not available yet.');
      return;
    }

    const { latitude, longitude } = userLocation;
    const latDelta = LOCATION_CONFIG.OFFLINE_REGION_DELTA_DEG;
    const lonDelta = LOCATION_CONFIG.OFFLINE_REGION_DELTA_DEG;

    const bounds = {
      minLat: latitude - latDelta,
      maxLat: latitude + latDelta,
      minLng: longitude - lonDelta,
      maxLng: longitude + lonDelta,
    };

    try {
      const newRegion = await offlineMapService.createRegion(
        `Current Area (${latitude.toFixed(2)}, ${longitude.toFixed(2)})`,
        bounds,
        10,
        16,
      );

      await loadRegions();
      handleDownload(newRegion.id);
    } catch (err) {
      Alert.alert('Offline Map Error', String(err));
    }
  }, [userLocation, loadRegions, handleDownload]);

  const handleClearCache = useCallback(async () => {
    try {
      await offlineMapService.clearCache();
      Alert.alert(
        'Cache Cleared',
        'Ambient tile cache was cleared. Downloaded regions were preserved.',
      );
    } catch (error) {
      Alert.alert('Cache Error', String(error));
    }
  }, []);

  const formattedStorage = `${(storageUsage.totalSizeBytes / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Offline Maps</Text>
          <TouchableOpacity onPress={handleClearCache} style={styles.cacheButton}>
            <Text style={styles.cacheButtonText}>Clear Cache</Text>
          </TouchableOpacity>
        </View>

        {/* Storage Banner */}
        <View style={styles.storageBanner}>
          <View style={styles.storageInfo}>
            <Text style={styles.storageTitle}>Local Offline Storage</Text>
            <Text style={styles.storageSubtitle}>
              {storageUsage.regionCount} downloaded regions • {formattedStorage} used
            </Text>
          </View>

          {userLocation && (
            <TouchableOpacity
              style={styles.customDownloadBtn}
              onPress={handleDownloadCurrentRegion}
              activeOpacity={0.8}
            >
              <Text style={styles.customDownloadText}>＋ Download Current Area</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Region List */}
        <FlatList
          data={regions}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <OfflineMapCard
              region={item}
              progress={activeProgress[item.id]}
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
  cacheButtonText: {
    fontSize: 13,
    color: '#1A73E8',
    fontWeight: '600',
  },
  storageBanner: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8EAED',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
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
  customDownloadBtn: {
    backgroundColor: '#E8F0FE',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  customDownloadText: {
    color: '#1A73E8',
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
  },
});
