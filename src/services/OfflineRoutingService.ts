import { RouteDetails, NavigationStep } from './routingService';
import { logger } from '../utils/logger';
import {
  getHaversineDistance,
  formatDistance,
  formatDuration,
} from '../utils/locationUtils';
import { offlineDatabaseService } from './OfflineDatabaseService';

const TAG = 'OfflineRoutingService';

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

    if (!startNodeId || !endNodeId || minStartDist > 30000 || minEndDist > 30000) {
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

    const openSet = new Set<string>();

    gScore.set(startNodeId, 0);
    const targetNode = nodes.find(n => n.id === endNodeId)!;
    const initialH = getHaversineDistance(
      startLat,
      startLng,
      targetNode.latitude,
      targetNode.longitude,
    );
    fScore.set(startNodeId, initialH);
    openSet.add(startNodeId);

    while (openSet.size > 0) {
      let current: string | null = null;
      let lowestF = Infinity;

      for (const nodeId of openSet) {
        const score = fScore.get(nodeId) ?? Infinity;
        if (score < lowestF) {
          lowestF = score;
          current = nodeId;
        }
      }

      if (!current) break;

      if (current === endNodeId) {
        // Path found! Construct route details.
        const pathNodeIds: string[] = [endNodeId];
        let curr = endNodeId;

        while (cameFrom.has(curr)) {
          const prev = cameFrom.get(curr)!;
          pathNodeIds.unshift(prev.parentNodeId);
          curr = prev.parentNodeId;
        }

        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const routeCoords: [number, number][] = [[startLng, startLat]];
        let totalDistMeters = 0;

        for (let i = 0; i < pathNodeIds.length; i++) {
          const n = nodeMap.get(pathNodeIds[i]);
          if (n) {
            routeCoords.push([n.longitude, n.latitude]);
            if (i > 0) {
              const prevN = nodeMap.get(pathNodeIds[i - 1])!;
              totalDistMeters += getHaversineDistance(
                prevN.latitude,
                prevN.longitude,
                n.latitude,
                n.longitude,
              );
            }
          }
        }
        routeCoords.push([endLng, endLat]);
        totalDistMeters += getHaversineDistance(
          routeCoords[routeCoords.length - 2][1],
          routeCoords[routeCoords.length - 2][0],
          endLat,
          endLng,
        );

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

      openSet.delete(current);
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

          const neighborNode = nodes.find(n => n.id === neighborId);
          const h = neighborNode
            ? getHaversineDistance(
                neighborNode.latitude,
                neighborNode.longitude,
                targetNode.latitude,
                targetNode.longitude,
              )
            : 0;
          fScore.set(neighborId, tentativeG + h);
          openSet.add(neighborId);
        }
      }
    }

    logger.warn(TAG, 'No offline path found between nodes.');
    return null;
  }
}

export const offlineRoutingService = new OfflineRoutingService();
export default offlineRoutingService;

