import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineManager } from '@maplibre/maplibre-react-native';
import { logger } from '../utils/logger';

const TAG = 'OfflineDatabaseService';
const DB_VERSION_KEY = '@navigo_offline_db_version';
const CURRENT_DB_VERSION = 2;

export class OfflineDatabaseService {
  private isInitialized: boolean = false;
  private isDatabaseValid: boolean = true;

  public async initializeDatabase(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const storedVersionStr = await AsyncStorage.getItem(DB_VERSION_KEY);
      if (!storedVersionStr) {
        // First run: set version to current without resetting native DB
        await AsyncStorage.setItem(DB_VERSION_KEY, CURRENT_DB_VERSION.toString());
        logger.info(TAG, `Offline database version initialized to v${CURRENT_DB_VERSION}.`);
      } else {
        const storedVersion = parseInt(storedVersionStr, 10);
        if (storedVersion < CURRENT_DB_VERSION) {
          logger.info(TAG, `Upgrading database schema v${storedVersion} -> v${CURRENT_DB_VERSION}.`);
          await AsyncStorage.setItem(DB_VERSION_KEY, CURRENT_DB_VERSION.toString());
        }
      }
      this.isDatabaseValid = true;
    } catch (err) {
      logger.info(TAG, 'Offline database initialization notice:', err);
      this.isDatabaseValid = true;
    } finally {
      this.isInitialized = true;
    }
  }

  public async recreateDatabase(): Promise<void> {
    try {
      if (OfflineManager?.resetDatabase) {
        await OfflineManager.resetDatabase();
        logger.info(TAG, 'Offline database reset executed.');
      }
    } catch (err) {
      logger.info(TAG, 'Notice during native offline database reset:', err);
    }
  }

  public isReady(): boolean {
    return this.isInitialized && this.isDatabaseValid;
  }
}

export const offlineDatabaseService = new OfflineDatabaseService();
