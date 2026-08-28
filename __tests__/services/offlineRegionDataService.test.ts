import {
  buildOfflineRoadQuery,
  parseOfflinePOIs,
  parseOfflineRoutingGraph,
} from '../../src/services/offlineRegionDataService';

describe('offlineRegionDataService', () => {
  test('builds a driving-road query that excludes non-drivable ways', () => {
    const query = buildOfflineRoadQuery({
      minLat: 25.3,
      maxLat: 25.5,
      minLng: 68.2,
      maxLng: 68.4,
    });

    expect(query).toContain('["highway"]');
    expect(query).toContain('footway|path|cycleway');
    expect(query).toContain('(25.3,68.2,25.5,68.4)');
  });

  test('parses searchable POIs with stable region-scoped IDs', () => {
    const pois = parseOfflinePOIs(
      {
        elements: [
          {
            type: 'node',
            id: 10,
            lat: 25.396,
            lon: 68.3578,
            tags: {
              amenity: 'hospital',
              name: 'City Hospital',
              'addr:street': 'Main Road',
            },
          },
        ],
      },
      { id: 'hyderabad', name: 'Hyderabad' },
    );

    expect(pois).toHaveLength(1);
    expect(pois[0]).toMatchObject({
      id: 'poi_node_10_hyderabad',
      name: 'City Hospital',
      category: 'hospital',
      address: 'Main Road',
      regionId: 'hyderabad',
    });
  });

  test('creates edges from real OSM way geometry and respects one-way roads', () => {
    const graph = parseOfflineRoutingGraph(
      {
        elements: [
          { type: 'node', id: 1, lat: 25.396, lon: 68.3578 },
          { type: 'node', id: 2, lat: 25.397, lon: 68.3578 },
          { type: 'node', id: 3, lat: 25.398, lon: 68.3578 },
          {
            type: 'way',
            id: 100,
            nodes: [1, 2],
            tags: { highway: 'residential', name: 'Two Way Street' },
          },
          {
            type: 'way',
            id: 101,
            nodes: [2, 3],
            tags: { highway: 'primary', oneway: 'yes' },
          },
        ],
      },
      'region-1',
    );

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(3);
    expect(
      graph.edges.some(
        edge =>
          edge.startNodeId === 'node_region-1_osm_1' &&
          edge.endNodeId === 'node_region-1_osm_2',
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        edge =>
          edge.startNodeId === 'node_region-1_osm_3' &&
          edge.endNodeId === 'node_region-1_osm_2',
      ),
    ).toBe(false);
  });

  test('returns no graph instead of fabricating roads when OSM has none', () => {
    expect(parseOfflineRoutingGraph({ elements: [] }, 'empty')).toEqual({
      nodes: [],
      edges: [],
    });
  });
});
