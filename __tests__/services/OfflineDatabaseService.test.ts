import { offlineDatabaseService, OfflinePOI, OfflineRoutingNode, OfflineRoutingEdge } from '../../src/services/OfflineDatabaseService';

describe('OfflineDatabaseService', () => {
  beforeEach(async () => {
    await offlineDatabaseService.clearAllData();
  });

  test('initializes database and reports ready status', async () => {
    await offlineDatabaseService.initializeDatabase();
    expect(offlineDatabaseService.isReady()).toBe(true);
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
});
