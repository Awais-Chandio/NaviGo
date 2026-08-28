import { RouteDetails, NavigationStep } from './routingService';
import { logger } from '../utils/logger';
import {
  getHaversineDistance,
  formatDistance,
  formatDuration,
} from '../utils/locationUtils';
import { offlineDatabaseService } from './OfflineDatabaseService';

const TAG = 'OfflineRoutingService';
const MAX_ENDPOINT_SNAP_DISTANCE_METERS = 2000;

interface QueueEntry {
  nodeId: string;
  score: number;
}

class MinPriorityQueue {
  private heap: QueueEntry[] = [];

  public get size(): number {
    return this.heap.length;
  }

  public push(entry: QueueEntry): void {
    this.heap.push(entry);
    let index = this.heap.length - 1;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex].score <= entry.score) break;
      this.heap[index] = this.heap[parentIndex];
      index = parentIndex;
    }
    this.heap[index] = entry;
  }

  public pop(): QueueEntry | null {
    if (this.heap.length === 0) return null;
    const first = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length === 0) return first;

    let index = 0;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      if (leftIndex >= this.heap.length) break;
      const smallerChildIndex =
        rightIndex < this.heap.length &&
        this.heap[rightIndex].score < this.heap[leftIndex].score
          ? rightIndex
          : leftIndex;
      if (this.heap[smallerChildIndex].score >= last.score) break;
      this.heap[index] = this.heap[smallerChildIndex];
      index = smallerChildIndex;
    }
    this.heap[index] = last;
    return first;
  }
}

export class OfflineRoutingService {
  public isAvailable(): boolean {
    const nodes = offlineDatabaseService.getRoutingNodes();
    return nodes.length > 0;
  }

  public isAvailableForLocation(lat: number, lng: number): boolean {
    return offlineDatabaseService.hasRoutingDataForLocation(lat, lng);
  }

  public async calculateOfflineRoute(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
  ): Promise<RouteDetails | null> {
    await offlineDatabaseService.initializeDatabase();
    const nodes = offlineDatabaseService.getRoutingNodes();

    if (nodes.length === 0) {
      logger.warn(
        TAG,
        'No offline road graph is installed; refusing to create a straight-line driving route.',
      );
      return null;
    }

    // Find nearest start and end nodes
    let startNodeId: string | null = null;
    let endNodeId: string | null = null;
    let minStartDist = Infinity;
    let minEndDist = Infinity;

    for (const node of nodes) {
      const dStart = getHaversineDistance(
        startLat,
        startLng,
        node.latitude,
        node.longitude,
      );
      if (dStart < minStartDist) {
        minStartDist = dStart;
        startNodeId = node.id;
      }

      const dEnd = getHaversineDistance(
        endLat,
        endLng,
        node.latitude,
        node.longitude,
      );
      if (dEnd < minEndDist) {
        minEndDist = dEnd;
        endNodeId = node.id;
      }
    }

    if (
      !startNodeId ||
      !endNodeId ||
      minStartDist > MAX_ENDPOINT_SNAP_DISTANCE_METERS ||
      minEndDist > MAX_ENDPOINT_SNAP_DISTANCE_METERS
    ) {
      logger.warn(
        TAG,
        'Start or destination is too far from any downloaded offline road graph.',
      );
      return null;
    }

    // A* Pathfinding Algorithm
    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();
    const cameFrom = new Map<
      string,
      { parentNodeId: string; edgeName?: string; dist: number }
    >();

    const openQueue = new MinPriorityQueue();

    gScore.set(startNodeId, 0);
    const targetNode = offlineDatabaseService.getRoutingNode(endNodeId);
    if (!targetNode) return null;
    const initialH = getHaversineDistance(
      startLat,
      startLng,
      targetNode.latitude,
      targetNode.longitude,
    );
    fScore.set(startNodeId, initialH);
    openQueue.push({ nodeId: startNodeId, score: initialH });

    while (openQueue.size > 0) {
      const entry = openQueue.pop();
      if (!entry) break;
      const current = entry.nodeId;
      if (entry.score !== fScore.get(current)) continue;

      if (current === endNodeId) {
        // Path found! Construct route details.
        const pathNodeIds: string[] = [endNodeId];
        let curr = endNodeId;

        while (cameFrom.has(curr)) {
          const prev = cameFrom.get(curr)!;
          pathNodeIds.unshift(prev.parentNodeId);
          curr = prev.parentNodeId;
        }

        const routeCoords: [number, number][] = [[startLng, startLat]];

        for (let i = 0; i < pathNodeIds.length; i++) {
          const n = offlineDatabaseService.getRoutingNode(pathNodeIds[i]);
          if (n) {
            routeCoords.push([n.longitude, n.latitude]);
          }
        }
        routeCoords.push([endLng, endLat]);
        let totalDistMeters = 0;
        for (let index = 1; index < routeCoords.length; index++) {
          totalDistMeters += getHaversineDistance(
            routeCoords[index - 1][1],
            routeCoords[index - 1][0],
            routeCoords[index][1],
            routeCoords[index][0],
          );
        }

        // Average driving speed ~40 km/h (11.1 m/s)
        const durationSeconds = Math.max(10, Math.round(totalDistMeters / 11.1));

        const steps: NavigationStep[] = [
          {
            instruction: 'Head towards destination',
            distance: Math.round(totalDistMeters * 0.5),
            duration: Math.round(durationSeconds * 0.5),
            type: 'depart',
            maneuver: 'straight',
            formattedDistance: formatDistance(Math.round(totalDistMeters * 0.5)),
            location: [startLng, startLat],
          },
          {
            instruction: 'Arrive at destination',
            distance: Math.round(totalDistMeters * 0.5),
            duration: Math.round(durationSeconds * 0.5),
            type: 'arrive',
            maneuver: 'arrive',
            formattedDistance: formatDistance(Math.round(totalDistMeters * 0.5)),
            location: [endLng, endLat],
          },
        ];

        return {
          id: `offline_route_${Date.now()}`,
          name: 'Offline Driving Route (Fastest)',
          tag: 'Fastest',
          coordinates: routeCoords,
          distanceMeters: Math.round(totalDistMeters),
          durationSeconds,
          formattedDistance: formatDistance(Math.round(totalDistMeters)),
          formattedDuration: formatDuration(durationSeconds),
          steps,
        };
      }

      const outgoingEdges = offlineDatabaseService.getRoutingEdgesForNode(current);

      for (const edge of outgoingEdges) {
        const neighborId = edge.endNodeId;
        const tentativeG = (gScore.get(current) ?? Infinity) + edge.weight;

        if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
          cameFrom.set(neighborId, {
            parentNodeId: current,
            edgeName: edge.name,
            dist: edge.distanceMeters,
          });
          gScore.set(neighborId, tentativeG);

          const neighborNode = offlineDatabaseService.getRoutingNode(neighborId);
          const h = neighborNode
            ? getHaversineDistance(
                neighborNode.latitude,
                neighborNode.longitude,
                targetNode.latitude,
                targetNode.longitude,
              )
            : 0;
          const nextScore = tentativeG + h;
          fScore.set(neighborId, nextScore);
          openQueue.push({ nodeId: neighborId, score: nextScore });
        }
      }
    }

    logger.warn(TAG, 'No offline path found between nodes.');
    return null;
  }
}

export const offlineRoutingService = new OfflineRoutingService();
export default offlineRoutingService;
