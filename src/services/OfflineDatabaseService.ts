import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineManager } from '@maplibre/maplibre-react-native';
import { logger } from '../utils/logger';
import { getHaversineDistance } from '../utils/locationUtils';

const TAG = 'OfflineDatabaseService';
const DB_VERSION_KEY = '@navigo_offline_db_version';
const POIS_KEY_PREFIX = '@navigo_offline_pois_';
const ROUTING_NODES_PREFIX = '@navigo_offline_rnodes_';
const ROUTING_EDGES_PREFIX = '@navigo_offline_redges_';
const CURRENT_DB_VERSION = 3;

export interface OfflinePOI {
  id: string;
  name: string;
  category: string;
  subCategory?: string;
  latitude: number;
  longitude: number;
  address: string;
  phone?: string;
  website?: string;
  openingHours?: string;
  regionId: string;
  createdAt: string;
}

export interface OfflineRoutingNode {
  id: string;
  regionId: string;
  latitude: number;
  longitude: number;
}

export interface OfflineRoutingEdge {
  id: string;
  regionId: string;
  startNodeId: string;
  endNodeId: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceMeters: number;
  weight: number;
  highwayType?: string;
  name?: string;
}

export class OfflineDatabaseService {
  private isInitialized: boolean = false;
  private isDatabaseValid: boolean = true;

  private poisMap: Map<string, OfflinePOI> = new Map();
  private regionPOIsMap: Map<string, Set<string>> = new Map();

  private routingNodesMap: Map<string, OfflineRoutingNode> = new Map();
  private routingEdgesMap: Map<string, OfflineRoutingEdge[]> = new Map();
  private regionGraphMap: Map<string, Set<string>> = new Map();

  public async initializeDatabase(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const storedVersionStr = await AsyncStorage.getItem(DB_VERSION_KEY);
      if (!storedVersionStr) {
        await AsyncStorage.setItem(
          DB_VERSION_KEY,
          CURRENT_DB_VERSION.toString(),
        );
        logger.info(
          TAG,
          `Offline database version initialized to v${CURRENT_DB_VERSION}.`,
        );
      } else {
        const storedVersion = parseInt(storedVersionStr, 10);
        if (storedVersion < CURRENT_DB_VERSION) {
          logger.info(
            TAG,
            `Upgrading database schema v${storedVersion} -> v${CURRENT_DB_VERSION}.`,
          );
          await AsyncStorage.setItem(
            DB_VERSION_KEY,
            CURRENT_DB_VERSION.toString(),
          );
        }
      }

      await this.loadAllPOIsFromStorage();
      await this.loadAllRoutingGraphsFromStorage();

      this.isDatabaseValid = true;
    } catch (err) {
      logger.info(TAG, 'Offline database initialization notice:', err);
      this.isDatabaseValid = true;
    } finally {
      this.isInitialized = true;
    }
  }

  private async loadAllPOIsFromStorage(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const poiKeys = keys.filter(key => key.startsWith(POIS_KEY_PREFIX));
      if (poiKeys.length === 0) return;

      for (const key of poiKeys) {
        const value = await AsyncStorage.getItem(key);
        if (!value) continue;
        const regionId = key.replace(POIS_KEY_PREFIX, '');
        try {
          const pois: OfflinePOI[] = JSON.parse(value);
          if (Array.isArray(pois)) {
            const idSet = new Set<string>();
            for (const poi of pois) {
              this.poisMap.set(poi.id, poi);
              idSet.add(poi.id);
            }
            this.regionPOIsMap.set(regionId, idSet);
          }
        } catch (e) {
          logger.warn(TAG, `Failed to parse offline POIs for region ${regionId}`, e);
        }
      }
    } catch (err) {
      logger.warn(TAG, 'Error loading offline POIs from storage:', err);
    }
  }

  private async loadAllRoutingGraphsFromStorage(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const nodeKeys = keys.filter(k => k.startsWith(ROUTING_NODES_PREFIX));
      const edgeKeys = keys.filter(k => k.startsWith(ROUTING_EDGES_PREFIX));

      for (const key of nodeKeys) {
        const value = await AsyncStorage.getItem(key);
        if (!value) continue;
        const nodes: OfflineRoutingNode[] = JSON.parse(value);
        if (Array.isArray(nodes)) {
          for (const node of nodes) {
            this.routingNodesMap.set(node.id, node);
          }
        }
      }

      for (const key of edgeKeys) {
        const value = await AsyncStorage.getItem(key);
        if (!value) continue;
        const edges: OfflineRoutingEdge[] = JSON.parse(value);
        if (Array.isArray(edges)) {
          for (const edge of edges) {
            const list = this.routingEdgesMap.get(edge.startNodeId) || [];
            list.push(edge);
            this.routingEdgesMap.set(edge.startNodeId, list);
          }
        }
      }
    } catch (err) {
      logger.warn(TAG, 'Error loading offline routing graph:', err);
    }
  }

  public async insertPOIs(
    regionId: string,
    pois: OfflinePOI[],
  ): Promise<void> {
    await this.initializeDatabase();
    const existingSet = this.regionPOIsMap.get(regionId) || new Set<string>();
    const updatedPOIsList: OfflinePOI[] = [];

    for (const poi of pois) {
      this.poisMap.set(poi.id, poi);
      existingSet.add(poi.id);
    }
    this.regionPOIsMap.set(regionId, existingSet);

    for (const poiId of existingSet) {
      const p = this.poisMap.get(poiId);
      if (p) updatedPOIsList.push(p);
    }

    try {
      await AsyncStorage.setItem(
        `${POIS_KEY_PREFIX}${regionId}`,
        JSON.stringify(updatedPOIsList),
      );
      logger.info(
        TAG,
        `Stored ${pois.length} POIs into local offline database for region ${regionId}.`,
      );
    } catch (err) {
      logger.warn(TAG, `Failed to persist POIs for region ${regionId}:`, err);
    }
  }

  public async getPOIsByCategory(
    category: string,
    userLat: number,
    userLng: number,
    radiusKm: number = 50,
  ): Promise<OfflinePOI[]> {
    await this.initializeDatabase();
    const normalizedCategory = category.toLowerCase().trim();

    const matches: OfflinePOI[] = [];
    for (const poi of this.poisMap.values()) {
      const poiCat = poi.category.toLowerCase();
      const poiSubCat = (poi.subCategory || '').toLowerCase();
      const poiName = poi.name.toLowerCase();

      const categoryMatch =
        poiCat.includes(normalizedCategory) ||
        poiSubCat.includes(normalizedCategory) ||
        poiName.includes(normalizedCategory) ||
        normalizedCategory === 'all';

      if (!categoryMatch) continue;

      const dist =
        getHaversineDistance(userLat, userLng, poi.latitude, poi.longitude) /
        1000;
      if (dist <= radiusKm) {
        matches.push(poi);
      }
    }

    matches.sort((a, b) => {
      const distA = getHaversineDistance(
        userLat,
        userLng,
        a.latitude,
        a.longitude,
      );
      const distB = getHaversineDistance(
        userLat,
        userLng,
        b.latitude,
        b.longitude,
      );
      return distA - distB;
    });

    return matches;
  }

  public async searchPOIs(
    query: string,
    userLat: number,
    userLng: number,
    limit: number = 30,
  ): Promise<OfflinePOI[]> {
    await this.initializeDatabase();
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) return [];

    const matches: OfflinePOI[] = [];
    for (const poi of this.poisMap.values()) {
      const nameMatch = poi.name.toLowerCase().includes(normalizedQuery);
      const categoryMatch = poi.category.toLowerCase().includes(normalizedQuery);
      const addressMatch = poi.address.toLowerCase().includes(normalizedQuery);

      if (nameMatch || categoryMatch || addressMatch) {
        matches.push(poi);
      }
    }

    matches.sort((a, b) => {
      const distA = getHaversineDistance(
        userLat,
        userLng,
        a.latitude,
        a.longitude,
      );
      const distB = getHaversineDistance(
        userLat,
        userLng,
        b.latitude,
        b.longitude,
      );
      return distA - distB;
    });

    return matches.slice(0, limit);
  }

  public async deletePOIsForRegion(regionId: string): Promise<void> {
    await this.initializeDatabase();
    const idSet = this.regionPOIsMap.get(regionId);
    if (idSet) {
      for (const poiId of idSet) {
        this.poisMap.delete(poiId);
      }
      this.regionPOIsMap.delete(regionId);
    }

    try {
      await AsyncStorage.removeItem(`${POIS_KEY_PREFIX}${regionId}`);
      logger.info(TAG, `Deleted POIs for region ${regionId}.`);
    } catch (err) {
      logger.warn(TAG, `Failed to delete POIs for region ${regionId}:`, err);
    }
  }

  public async insertRoutingGraph(
    regionId: string,
    nodes: OfflineRoutingNode[],
    edges: OfflineRoutingEdge[],
  ): Promise<void> {
    await this.initializeDatabase();
    for (const node of nodes) {
      this.routingNodesMap.set(node.id, node);
    }

    for (const edge of edges) {
      const list = this.routingEdgesMap.get(edge.startNodeId) || [];
      list.push(edge);
      this.routingEdgesMap.set(edge.startNodeId, list);
    }

    try {
      await AsyncStorage.setItem(
        `${ROUTING_NODES_PREFIX}${regionId}`,
        JSON.stringify(nodes),
      );
      await AsyncStorage.setItem(
        `${ROUTING_EDGES_PREFIX}${regionId}`,
        JSON.stringify(edges),
      );
      logger.info(
        TAG,
        `Inserted ${nodes.length} routing nodes and ${edges.length} edges for region ${regionId}.`,
      );
    } catch (err) {
      logger.warn(
        TAG,
        `Failed to store routing graph for region ${regionId}:`,
        err,
      );
    }
  }

  public getRoutingNodes(): OfflineRoutingNode[] {
    return Array.from(this.routingNodesMap.values());
  }

  public getRoutingEdgesForNode(nodeId: string): OfflineRoutingEdge[] {
    return this.routingEdgesMap.get(nodeId) || [];
  }

  public hasRoutingDataForRegion(regionId: string): boolean {
    for (const node of this.routingNodesMap.values()) {
      if (node.regionId === regionId) return true;
    }
    return false;
  }

  public hasRoutingDataForLocation(lat: number, lng: number): boolean {
    for (const node of this.routingNodesMap.values()) {
      const dist = getHaversineDistance(lat, lng, node.latitude, node.longitude);
      if (dist <= 15000) {
        return true;
      }
    }
    return false;
  }

  public async deleteRoutingGraphForRegion(regionId: string): Promise<void> {
    await this.initializeDatabase();
    const nodeIdsToRemove = new Set<string>();
    for (const [id, node] of this.routingNodesMap.entries()) {
      if (node.regionId === regionId) {
        nodeIdsToRemove.add(id);
      }
    }

    for (const id of nodeIdsToRemove) {
      this.routingNodesMap.delete(id);
      this.routingEdgesMap.delete(id);
    }

    try {
      await AsyncStorage.removeItem(`${ROUTING_NODES_PREFIX}${regionId}`);
      await AsyncStorage.removeItem(`${ROUTING_EDGES_PREFIX}${regionId}`);
      logger.info(TAG, `Deleted routing graph for region ${regionId}.`);
    } catch (err) {
      logger.warn(
        TAG,
        `Failed to delete routing graph for region ${regionId}:`,
        err,
      );
    }
  }

  public async clearAllData(): Promise<void> {
    await this.initializeDatabase();
    this.poisMap.clear();
    this.regionPOIsMap.clear();
    this.routingNodesMap.clear();
    this.routingEdgesMap.clear();

    try {
      const keys = await AsyncStorage.getAllKeys();
      const dbKeys = keys.filter(
        k =>
          k.startsWith(POIS_KEY_PREFIX) ||
          k.startsWith(ROUTING_NODES_PREFIX) ||
          k.startsWith(ROUTING_EDGES_PREFIX),
      );
      if (dbKeys.length > 0) {
        await Promise.all(dbKeys.map(k => AsyncStorage.removeItem(k)));
      }
      if (OfflineManager?.resetDatabase) {
        await OfflineManager.resetDatabase();
      }
      logger.info(TAG, 'All offline database records cleared.');
    } catch (err) {
      logger.warn(TAG, 'Error during clearAllData:', err);
    }
  }

  public async recreateDatabase(): Promise<void> {
    await this.clearAllData();
  }

  public isReady(): boolean {
    return this.isInitialized && this.isDatabaseValid;
  }

  public async getDatabaseStats(): Promise<{
    poiCount: number;
    routingNodeCount: number;
    routingEdgeCount: number;
    regionCount: number;
  }> {
    await this.initializeDatabase();
    let edgeCount = 0;
    for (const edges of this.routingEdgesMap.values()) {
      edgeCount += edges.length;
    }
    return {
      poiCount: this.poisMap.size,
      routingNodeCount: this.routingNodesMap.size,
      routingEdgeCount: edgeCount,
      regionCount: this.regionPOIsMap.size,
    };
  }
}

export const offlineDatabaseService = new OfflineDatabaseService();

