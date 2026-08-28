import {
  OfflineDatabaseService,
  offlineDatabaseService,
  OfflinePOI,
  OfflineRoutingNode,
  OfflineRoutingEdge,
} from '../../src/services/OfflineDatabaseService';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('OfflineDatabaseService', () => {
  beforeEach(async () => {
    await offlineDatabaseService.clearAllData();
  });

  test('initializes database and reports ready status', async () => {
    await offlineDatabaseService.initializeDatabase();
    expect(offlineDatabaseService.isReady()).toBe(true);
  });

  test('migrates v3 by removing only legacy routing graph records', async () => {
    const getItemMock = jest.mocked(AsyncStorage.getItem);
    const getAllKeysMock = jest.mocked(AsyncStorage.getAllKeys);
    jest.mocked(AsyncStorage.removeItem).mockClear();
    jest.mocked(AsyncStorage.setItem).mockClear();
    getItemMock.mockResolvedValueOnce('3');
    getAllKeysMock
      .mockResolvedValueOnce([
        '@navigo_offline_pois_region_1',
        '@navigo_offline_rnodes_region_1',
        '@navigo_offline_redges_region_1',
      ])
      .mockResolvedValueOnce(['@navigo_offline_pois_region_1'])
      .mockResolvedValueOnce([]);

    const service = new OfflineDatabaseService();
    await service.initializeDatabase();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      '@navigo_offline_rnodes_region_1',
    );
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      '@navigo_offline_redges_region_1',
    );
    expect(AsyncStorage.removeItem).not.toHaveBeenCalledWith(
      '@navigo_offline_pois_region_1',
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@navigo_offline_db_version',
      '4',
    );
  });

  test('inserts and queries offline POIs by category and distance', async () => {
    const testPois: OfflinePOI[] = [
      {
        id: 'poi_1',
        name: 'Gourmet Cafe',
        category: 'cafe',
        subCategory: 'coffee',
        latitude: 25.396,
        longitude: 68.358,
        address: 'Main Market, Hyderabad',
        regionId: 'region_1',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'poi_2',
        name: 'City Hospital',
        category: 'hospital',
        latitude: 25.400,
        longitude: 68.360,
        address: 'Hospital Road, Hyderabad',
        regionId: 'region_1',
        createdAt: new Date().toISOString(),
      },
    ];

    await offlineDatabaseService.insertPOIs('region_1', testPois);

    const cafes = await offlineDatabaseService.getPOIsByCategory('cafe', 25.396, 68.358);
    expect(cafes.length).toBe(1);
    expect(cafes[0].name).toBe('Gourmet Cafe');

    const searchResults = await offlineDatabaseService.searchPOIs('Hospital', 25.396, 68.358);
    expect(searchResults.length).toBe(1);
    expect(searchResults[0].name).toBe('City Hospital');
  });

  test('inserts and queries routing graph nodes and edges', async () => {
    const nodes: OfflineRoutingNode[] = [
      { id: 'node_1', regionId: 'region_1', latitude: 25.396, longitude: 68.358 },
      { id: 'node_2', regionId: 'region_1', latitude: 25.400, longitude: 68.360 },
    ];
    const edges: OfflineRoutingEdge[] = [
      {
        id: 'edge_1',
        regionId: 'region_1',
        startNodeId: 'node_1',
        endNodeId: 'node_2',
        startLat: 25.396,
        startLng: 68.358,
        endLat: 25.400,
        endLng: 68.360,
        distanceMeters: 500,
        weight: 500,
      },
    ];

    await offlineDatabaseService.insertRoutingGraph('region_1', nodes, edges);

    expect(offlineDatabaseService.getRoutingNodes().length).toBe(2);
    expect(offlineDatabaseService.getRoutingEdgesForNode('node_1').length).toBe(1);
    expect(offlineDatabaseService.hasRoutingDataForRegion('region_1')).toBe(true);
    expect(offlineDatabaseService.hasRoutingDataForLocation(25.396, 68.358)).toBe(true);
  });

  test('deletes POIs and routing graph for a specific region', async () => {
    const testPois: OfflinePOI[] = [
      {
        id: 'poi_del',
        name: 'Delete Me',
        category: 'fuel',
        latitude: 25.396,
        longitude: 68.358,
        address: 'Street 1',
        regionId: 'region_del',
        createdAt: new Date().toISOString(),
      },
    ];
    await offlineDatabaseService.insertPOIs('region_del', testPois);
    await offlineDatabaseService.deletePOIsForRegion('region_del');

    const results = await offlineDatabaseService.getPOIsByCategory('fuel', 25.396, 68.358);
    expect(results.length).toBe(0);
  });

  test('replaces stale region data when an offline map is updated', async () => {
    await offlineDatabaseService.insertPOIs('region_update', [
      {
        id: 'old_poi',
        name: 'Old Place',
        category: 'cafe',
        latitude: 25.396,
        longitude: 68.358,
        address: 'Old Road',
        regionId: 'region_update',
        createdAt: new Date().toISOString(),
      },
    ]);
    await offlineDatabaseService.insertPOIs('region_update', [
      {
        id: 'new_poi',
        name: 'New Place',
        category: 'hospital',
        latitude: 25.397,
        longitude: 68.359,
        address: 'New Road',
        regionId: 'region_update',
        createdAt: new Date().toISOString(),
      },
    ]);

    expect(
      await offlineDatabaseService.searchPOIs(
        'Old Place',
        25.396,
        68.358,
      ),
    ).toHaveLength(0);
    expect(
      await offlineDatabaseService.searchPOIs(
        'New Place',
        25.396,
        68.358,
      ),
    ).toHaveLength(1);

    const firstNodes: OfflineRoutingNode[] = [
      {
        id: 'old_node',
        regionId: 'region_update',
        latitude: 25.396,
        longitude: 68.358,
      },
    ];
    const replacementNodes: OfflineRoutingNode[] = [
      {
        id: 'new_node',
        regionId: 'region_update',
        latitude: 25.397,
        longitude: 68.359,
      },
    ];
    await offlineDatabaseService.insertRoutingGraph(
      'region_update',
      firstNodes,
      [],
    );
    await offlineDatabaseService.insertRoutingGraph(
      'region_update',
      replacementNodes,
      [],
    );

    expect(offlineDatabaseService.getRoutingNode('old_node')).toBeNull();
    expect(offlineDatabaseService.getRoutingNode('new_node')).toEqual(
      replacementNodes[0],
    );
  });
});
