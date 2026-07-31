import React, { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  Text,
  type TextStyle,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { OfflineRegion, DownloadProgress } from '../types/location';

interface OfflineMapCardProps {
  region: OfflineRegion;
  progress?: DownloadProgress;
  isSelected: boolean;
  onSelect: (regionId: string) => void;
  onDownload: (regionId: string) => void;
  onDelete: (regionId: string) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toFixed(1)} GB`;
  }
  return `${megabytes.toFixed(1)} MB`;
}

function formatRadius(radiusKm: number): string {
  return Number.isInteger(radiusKm)
    ? `${radiusKm} km`
    : `${radiusKm.toFixed(1)} km`;
}

function formatDownloadDate(downloadedAt?: string): string {
  if (!downloadedAt) return 'Not downloaded';
  const date = new Date(downloadedAt);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const dayDifference = Math.round(
    (startOfToday - startOfDate) / (24 * 60 * 60 * 1000),
  );
  if (dayDifference === 0) return 'Today';
  if (dayDifference === 1) return 'Yesterday';
  return date.toLocaleDateString();
}

const OfflineMapCardComponent: React.FC<OfflineMapCardProps> = ({
    region,
    progress,
    isSelected,
    onSelect,
    onDownload,
    onDelete,
  }) => {
    const isDownloading =
      region.status === 'downloading' ||
      progress?.status === 'downloading';
    const isCompleted =
      region.isDownloaded === true &&
      (region.status === 'completed' ||
        progress?.status === 'completed');
    const hasFailed = region.status === 'error';
    const percentage = Math.max(
      0,
      Math.min(100, progress?.percentage ?? (isCompleted ? 100 : 0)),
    );
    const metadata = useMemo(
      () => ({
        radius: formatRadius(region.radiusKm),
        coverage: `~${Math.round(region.coverageAreaKm2).toLocaleString()} km²`,
        size: formatBytes(region.sizeBytes),
        downloaded: formatDownloadDate(region.downloadedAt),
      }),
      [
        region.coverageAreaKm2,
        region.downloadedAt,
        region.radiusKm,
        region.sizeBytes,
      ],
    );

    let badgeLabel = 'Not Downloaded';
    let badgeStyle: StyleProp<ViewStyle> = styles.idleBadge;
    let badgeTextStyle: StyleProp<TextStyle> = styles.idleBadgeText;
    if (isCompleted) {
      badgeLabel = '✓ Offline Ready';
      badgeStyle = styles.completedBadge;
      badgeTextStyle = styles.completedBadgeText;
    } else if (isDownloading) {
      badgeLabel = `${percentage}%`;
      badgeStyle = styles.downloadingBadge;
      badgeTextStyle = styles.downloadingBadgeText;
    } else if (hasFailed) {
      badgeLabel = 'Failed';
      badgeStyle = styles.failedBadge;
      badgeTextStyle = styles.failedBadgeText;
    } else if (region.status === 'paused') {
      badgeLabel = 'Paused';
    }

    const actionLabel = isDownloading
      ? `Downloading ${percentage}%`
      : isCompleted
        ? '✓ Downloaded'
        : hasFailed
          ? 'Retry'
          : region.status === 'paused'
            ? 'Resume'
            : 'Download';

    return (
      <View style={[styles.card, isSelected && styles.selectedCard]}>
        <Pressable
          onPress={() => onSelect(region.id)}
          accessibilityRole="button"
          accessibilityLabel={`View coverage for ${region.name}`}
        >
          <View style={styles.headerRow}>
            <View style={styles.titleContainer}>
              <Text style={styles.regionName}>{region.name}</Text>
              <Text style={styles.coordinates}>
                {region.center.latitude.toFixed(4)},{' '}
                {region.center.longitude.toFixed(4)} • Version {region.version}
              </Text>
            </View>
            <View style={badgeStyle}>
              <Text style={badgeTextStyle}>{badgeLabel}</Text>
            </View>
          </View>

          <View style={styles.metadataGrid}>
            <View style={styles.metadataItem}>
              <Text style={styles.metadataLabel}>Radius</Text>
              <Text style={styles.metadataValue}>{metadata.radius}</Text>
            </View>
            <View style={styles.metadataItem}>
              <Text style={styles.metadataLabel}>Coverage</Text>
              <Text style={styles.metadataValue}>{metadata.coverage}</Text>
            </View>
            <View style={styles.metadataItem}>
              <Text style={styles.metadataLabel}>Size</Text>
              <Text style={styles.metadataValue}>{metadata.size}</Text>
            </View>
            <View style={styles.metadataItem}>
              <Text style={styles.metadataLabel}>Downloaded</Text>
              <Text style={styles.metadataValue}>{metadata.downloaded}</Text>
            </View>
          </View>
        </Pressable>

        {isDownloading && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBackground}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${percentage}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{percentage}% complete</Text>
          </View>
        )}

        <View style={styles.actionsRow}>
          {isCompleted ? (
            <TouchableOpacity
              style={styles.viewButton}
              onPress={() => onSelect(region.id)}
              activeOpacity={0.75}
            >
              <Text style={styles.viewButtonText}>View Coverage</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.downloadButton,
                isDownloading && styles.downloadButtonDisabled,
                hasFailed && styles.retryButton,
              ]}
              onPress={() => onDownload(region.id)}
              disabled={isDownloading}
              activeOpacity={0.8}
            >
              <Text style={styles.downloadButtonText}>{actionLabel}</Text>
            </TouchableOpacity>
          )}

          {isCompleted && (
            <View style={styles.downloadedButton}>
              <Text style={styles.downloadedButtonText}>{actionLabel}</Text>
            </View>
          )}

          {!isDownloading && (
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => onDelete(region.id)}
              activeOpacity={0.75}
            >
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
};

export const OfflineMapCard = React.memo(
  OfflineMapCardComponent,
  (previous, next) =>
    previous.region.id === next.region.id &&
    previous.region.name === next.region.name &&
    previous.region.status === next.region.status &&
    previous.region.isDownloaded === next.region.isDownloaded &&
    previous.region.radiusKm === next.region.radiusKm &&
    previous.region.coverageAreaKm2 === next.region.coverageAreaKm2 &&
    previous.region.sizeBytes === next.region.sizeBytes &&
    previous.region.downloadedAt === next.region.downloadedAt &&
    previous.region.version === next.region.version &&
    previous.region.center.latitude === next.region.center.latitude &&
    previous.region.center.longitude === next.region.center.longitude &&
    previous.progress?.percentage === next.progress?.percentage &&
    previous.progress?.status === next.progress?.status &&
    previous.isSelected === next.isSelected &&
    previous.onSelect === next.onSelect &&
    previous.onDownload === next.onDownload &&
    previous.onDelete === next.onDelete,
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8EAED',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
  },
  selectedCard: {
    borderColor: '#1A73E8',
    borderWidth: 2,
    backgroundColor: '#F8FBFF',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
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
  coordinates: {
    fontSize: 11,
    color: '#5F6368',
  },
  metadataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
  },
  metadataItem: {
    width: '50%',
    paddingVertical: 5,
  },
  metadataLabel: {
    fontSize: 11,
    color: '#5F6368',
    marginBottom: 2,
  },
  metadataValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#202124',
  },
  completedBadge: {
    backgroundColor: '#E6F4EA',
    paddingHorizontal: 10,
    paddingVertical: 5,
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
    paddingVertical: 5,
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
    paddingVertical: 5,
    borderRadius: 12,
  },
  idleBadgeText: {
    color: '#5F6368',
    fontSize: 11,
    fontWeight: '600',
  },
  failedBadge: {
    backgroundColor: '#FCE8E6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  failedBadgeText: {
    color: '#C5221F',
    fontSize: 11,
    fontWeight: '700',
  },
  progressContainer: {
    marginTop: 12,
  },
  progressBarBackground: {
    height: 7,
    backgroundColor: '#D2E3FC',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#1A73E8',
  },
  progressText: {
    marginTop: 5,
    fontSize: 11,
    color: '#1A73E8',
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
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
  retryButton: {
    backgroundColor: '#C5221F',
  },
  downloadButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  viewButton: {
    flex: 1,
    backgroundColor: '#E8F0FE',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  viewButtonText: {
    color: '#174EA6',
    fontSize: 13,
    fontWeight: '700',
  },
  downloadedButton: {
    backgroundColor: '#E6F4EA',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  downloadedButtonText: {
    color: '#137333',
    fontSize: 12,
    fontWeight: '700',
  },
  deleteButton: {
    backgroundColor: '#FCE8E6',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#C5221F',
    fontSize: 13,
    fontWeight: '700',
  },
});
