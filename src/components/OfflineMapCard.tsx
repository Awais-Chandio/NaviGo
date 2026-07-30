import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { OfflineRegion, DownloadProgress } from '../types/location';

interface OfflineMapCardProps {
  region: OfflineRegion;
  progress?: DownloadProgress;
  onDownload: (regionId: string) => void;
  onDelete: (regionId: string) => void;
}

export const OfflineMapCard: React.FC<OfflineMapCardProps> = ({
  region,
  progress,
  onDownload,
  onDelete,
}) => {
  const isDownloading = region.status === 'downloading' || progress?.status === 'downloading';
  const isCompleted = region.status === 'completed' || progress?.status === 'completed';
  const percentage = progress?.percentage ?? (isCompleted ? 100 : 0);

  const formattedSize = `${(region.sizeBytes / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleContainer}>
          <Text style={styles.regionName}>{region.name}</Text>
          <Text style={styles.detailsText}>
            {formattedSize} • Approx. {region.estimatedTileCount} tiles
          </Text>
        </View>

        {isCompleted ? (
          <View style={styles.completedBadge}>
            <Text style={styles.completedBadgeText}>Available Offline</Text>
          </View>
        ) : isDownloading ? (
          <View style={styles.downloadingBadge}>
            <Text style={styles.downloadingBadgeText}>{percentage}%</Text>
          </View>
        ) : (
          <View style={styles.idleBadge}>
            <Text style={styles.idleBadgeText}>Not Downloaded</Text>
          </View>
        )}
      </View>

      {isDownloading && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBarBackground}>
            <View style={[styles.progressBarFill, { width: `${percentage}%` }]} />
          </View>
        </View>
      )}

      <View style={styles.actionsRow}>
        {isCompleted ? (
          <>
            <TouchableOpacity
              style={styles.updateButton}
              onPress={() => onDownload(region.id)}
              activeOpacity={0.75}
            >
              <Text style={styles.updateButtonText}>↻ Update</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => onDelete(region.id)}
              activeOpacity={0.75}
            >
              <Text style={styles.deleteButtonText}>🗑 Delete</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.downloadButton, isDownloading && styles.downloadButtonDisabled]}
            onPress={() => onDownload(region.id)}
            disabled={isDownloading}
            activeOpacity={0.8}
          >
            <Text style={styles.downloadButtonText}>
              {isDownloading ? `Downloading (${percentage}%)...` : '⬇ Download Map'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8EAED',
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleContainer: {
    flex: 1,
    marginRight: 10,
  },
  regionName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 4,
  },
  detailsText: {
    fontSize: 12,
    color: '#5F6368',
  },
  completedBadge: {
    backgroundColor: '#E6F4EA',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  completedBadgeText: {
    color: '#137333',
    fontSize: 11,
    fontWeight: '700',
  },
  downloadingBadge: {
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  downloadingBadgeText: {
    color: '#1A73E8',
    fontSize: 11,
    fontWeight: '700',
  },
  idleBadge: {
    backgroundColor: '#F1F3F4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  idleBadgeText: {
    color: '#5F6368',
    fontSize: 11,
    fontWeight: '600',
  },
  progressContainer: {
    marginVertical: 8,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: '#E8F0FE',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#1A73E8',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  downloadButton: {
    flex: 1,
    backgroundColor: '#1A73E8',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  downloadButtonDisabled: {
    backgroundColor: '#8AB4F8',
  },
  downloadButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  updateButton: {
    flex: 1,
    backgroundColor: '#F1F3F4',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  updateButtonText: {
    color: '#202124',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#FCE8E6',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#C5221F',
    fontSize: 13,
    fontWeight: '700',
  },
});
