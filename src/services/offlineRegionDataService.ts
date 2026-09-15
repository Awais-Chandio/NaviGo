import type {
  OfflinePOI,
  OfflineRoutingEdge,
  OfflineRoutingNode,
} from './OfflineDatabaseService';
import type { OfflineRegion, RegionBoundingBox } from '../types/location';
import { getHaversineDistance } from '../utils/locationUtils';
import { fetchWithTimeout } from '../utils/networkUtils';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;
const OVERPASS_TIMEOUT_MS = 30000;
const MAX_ROUTING_NODES = 75000;
const MAX_ROUTING_EDGES = 250000;

type OverpassTags = Record<string, string>;

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  nodes?: number[];
  tags?: OverpassTags;
}

interface OverpassPayload {
  elements?: OverpassElement[];
}

export interface OfflineRoutingGraph {
  nodes: OfflineRoutingNode[];
  edges: OfflineRoutingEdge[];
}

function formatBounds(bounds: RegionBoundingBox): string {
  return `${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng}`;
}

export function buildOfflinePOIQuery(bounds: RegionBoundingBox): string {
  const bbox = formatBounds(bounds);
  return `
    [out:json][timeout:25];
    (
      nwr["amenity"~"restaurant|fast_food|cafe|hospital|clinic|pharmacy|atm|bank|fuel"](${bbox});
      nwr["tourism"~"hotel|motel|hostel"](${bbox});
      nwr["leisure"~"park|garden"](${bbox});
      nwr["shop"~"supermarket|convenience"](${bbox});
    );
    out center tags;
  `;
}

export function buildOfflineRoadQuery(bounds: RegionBoundingBox): string {
  const bbox = formatBounds(bounds);
  return `
    [out:json][timeout:25];
    way
      ["highway"]
      ["area"!="yes"]
      ["access"!~"^(no|private)$"]
      ["motor_vehicle"!~"^(no|private)$"]
      ["highway"!~"^(footway|path|cycleway|bridleway|steps|pedestrian|construction|proposed|raceway|corridor|elevator|platform)$"]
      (${bbox});
    out body;
    >;
    out skel qt;
  `;
}

async function fetchOverpassPayload(query: string): Promise<OverpassPayload> {
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'NaviGo-NavigationApp/1.0 (contact@navigo.app)',
        },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: OVERPASS_TIMEOUT_MS,
      });
      if (!response.ok) {
        lastError = new Error(
          `Offline data server unavailable (HTTP ${response.status}).`,
        );
        continue;
      }
      const payload: unknown = await response.json();
      if (
        !payload ||
        typeof payload !== 'object' ||
        !Array.isArray((payload as OverpassPayload).elements)
      ) {
        throw new Error('Offline data server returned an invalid response.');
      }
      return payload as OverpassPayload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Offline data servers are unavailable.');
}

function getPOICategory(
  tags: OverpassTags,
): { key: string; value: string } | null {
  for (const key of ['amenity', 'tourism', 'leisure', 'shop'] as const) {
    if (tags[key]) return { key, value: tags[key]! };
  }
  return null;
}

function formatCategoryLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function getPOIAddress(tags: OverpassTags, regionName: string): string {
  const street = [tags['addr:housenumber'], tags['addr:street']]
    .filter(Boolean)
    .join(' ');
  const locality =
    tags['addr:city'] || tags['addr:suburb'] || tags['addr:district'];
  return [street, locality].filter(Boolean).join(', ') || regionName;
}

export function parseOfflinePOIs(
  payload: OverpassPayload,
  region: Pick<OfflineRegion, 'id' | 'name'>,
): OfflinePOI[] {
  const pois: OfflinePOI[] = [];
  const seen = new Set<string>();

  for (const element of payload.elements || []) {
    if (
      typeof element.id !== 'number' ||
      typeof element.type !== 'string' ||
      !element.tags
    ) {
      continue;
    }
    const category = getPOICategory(element.tags);
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    if (
      !category ||
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }

    const id = `poi_${element.type}_${element.id}_${region.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const tags = element.tags;
    // A missing OSM name tag does not make the POI invalid: keep it with an
    // honest, category-derived label rather than discarding a real place or
    // inventing a specific name that was never in the source data.
    const name =
      tags.name ||
      tags['name:en'] ||
      tags.brand ||
      tags.operator ||
      `Unnamed ${formatCategoryLabel(category.value)}`;
    pois.push({
      id,
      name,
      category: category.value,
      categoryKey: category.key,
      subCategory: tags.cuisine || tags.shop || category.value,
      latitude,
      longitude,
      address: getPOIAddress(tags, region.name),
      phone: tags.phone || tags['contact:phone'],
      website: tags.website || tags['contact:website'],
      openingHours: tags.opening_hours,
      regionId: region.id,
      createdAt: new Date().toISOString(),
    });
  }

  return pois;
}

function isReverseOnly(tags: OverpassTags): boolean {
  return tags.oneway === '-1';
}

function isOneWay(tags: OverpassTags): boolean {
  const value = (tags.oneway || '').toLowerCase();
  return (
    value === 'yes' ||
    value === 'true' ||
    value === '1' ||
    tags.junction === 'roundabout'
  );
}

function getRoadPreference(highwayType: string): number {
  switch (highwayType) {
    case 'motorway':
    case 'trunk':
      return 1;
    case 'primary':
    case 'secondary':
      return 1.05;
    case 'tertiary':
    case 'unclassified':
      return 1.1;
    case 'residential':
    case 'living_street':
      return 1.2;
    case 'service':
      return 1.35;
    default:
      return 1.25;
  }
}

export function parseOfflineRoutingGraph(
  payload: OverpassPayload,
  regionId: string,
): OfflineRoutingGraph {
  const elements = payload.elements || [];
  const rawNodes = new Map<number, { latitude: number; longitude: number }>();
  const roadWays: Array<{
    id: number;
    nodeIds: number[];
    tags: OverpassTags;
  }> = [];

  for (const element of elements) {
    if (
      element.type === 'node' &&
      typeof element.id === 'number' &&
      typeof element.lat === 'number' &&
      Number.isFinite(element.lat) &&
      typeof element.lon === 'number' &&
      Number.isFinite(element.lon)
    ) {
      rawNodes.set(element.id, {
        latitude: element.lat,
        longitude: element.lon,
      });
    } else if (
      element.type === 'way' &&
      typeof element.id === 'number' &&
      Array.isArray(element.nodes) &&
      element.nodes.length >= 2 &&
      typeof element.tags?.highway === 'string'
    ) {
      roadWays.push({
        id: element.id,
        nodeIds: element.nodes.filter(
          (nodeId): nodeId is number => typeof nodeId === 'number',
        ),
        tags: element.tags,
      });
    }
  }

  const referencedNodeIds = new Set<number>();
  roadWays.forEach(way =>
    way.nodeIds.forEach(nodeId => {
      if (rawNodes.has(nodeId)) referencedNodeIds.add(nodeId);
    }),
  );
  if (referencedNodeIds.size > MAX_ROUTING_NODES) {
    throw new Error(
      'This area has too many roads for safe on-device routing. Download a smaller area.',
    );
  }

  const toStoredNodeId = (nodeId: number) =>
    `node_${regionId}_osm_${nodeId}`;
  const nodes: OfflineRoutingNode[] = Array.from(referencedNodeIds).map(
    nodeId => {
      const coordinate = rawNodes.get(nodeId)!;
      return {
        id: toStoredNodeId(nodeId),
        regionId,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      };
    },
  );
  const edges: OfflineRoutingEdge[] = [];

  const addEdge = (
    wayId: number,
    segmentIndex: number,
    startNodeId: number,
    endNodeId: number,
    tags: OverpassTags,
    direction: 'forward' | 'reverse',
  ) => {
    const start = rawNodes.get(startNodeId);
    const end = rawNodes.get(endNodeId);
    if (!start || !end) return;
    const distanceMeters = getHaversineDistance(
      start.latitude,
      start.longitude,
      end.latitude,
      end.longitude,
    );
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return;
    edges.push({
      id: `edge_${regionId}_osm_${wayId}_${segmentIndex}_${direction}`,
      regionId,
      startNodeId: toStoredNodeId(startNodeId),
      endNodeId: toStoredNodeId(endNodeId),
      startLat: start.latitude,
      startLng: start.longitude,
      endLat: end.latitude,
      endLng: end.longitude,
      distanceMeters,
      weight: distanceMeters * getRoadPreference(tags.highway),
      highwayType: tags.highway,
      name: tags.name || tags.ref,
    });
  };

  for (const way of roadWays) {
    for (let index = 0; index < way.nodeIds.length - 1; index++) {
      const firstNodeId = way.nodeIds[index];
      const secondNodeId = way.nodeIds[index + 1];
      if (isReverseOnly(way.tags)) {
        addEdge(
          way.id,
          index,
          secondNodeId,
          firstNodeId,
          way.tags,
          'reverse',
        );
      } else {
        addEdge(
          way.id,
          index,
          firstNodeId,
          secondNodeId,
          way.tags,
          'forward',
        );
        if (!isOneWay(way.tags)) {
          addEdge(
            way.id,
            index,
            secondNodeId,
            firstNodeId,
            way.tags,
            'reverse',
          );
        }
      }
      if (edges.length > MAX_ROUTING_EDGES) {
        throw new Error(
          'This area has too many road connections for safe on-device routing. Download a smaller area.',
        );
      }
    }
  }

  return { nodes, edges };
}

export async function fetchOfflinePOIs(
  region: OfflineRegion,
): Promise<OfflinePOI[]> {
  const payload = await fetchOverpassPayload(buildOfflinePOIQuery(region.bounds));
  return parseOfflinePOIs(payload, region);
}

export async function fetchOfflineRoutingGraph(
  region: OfflineRegion,
): Promise<OfflineRoutingGraph> {
  const payload = await fetchOverpassPayload(
    buildOfflineRoadQuery(region.bounds),
  );
  return parseOfflineRoutingGraph(payload, region.id);
}
