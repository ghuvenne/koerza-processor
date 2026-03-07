import { haversineDistance, projectPointOnSegment, projectPositionOnRoute, processRoute, parseGpxToCoordinates, type RoutePoint, type ProcessedRoute, type ProjectionResult } from "../shared/gpxUtils.js";

export { haversineDistance, parseGpxToCoordinates, processRoute, projectPointOnSegment, projectPositionOnRoute, type RoutePoint, type ProcessedRoute, type ProjectionResult } from "../shared/gpxUtils.js";

export interface SpatialSegmentIndex {
  cellSize: number;
  cells: Map<string, number[]>;
}

export function buildSpatialIndex(route: ProcessedRoute, cellSizeMeters: number = 500): SpatialSegmentIndex {
  const cellSize = cellSizeMeters / 111000;
  const cells = new Map<string, number[]>();

  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i];
    const b = route.points[i + 1];

    const minLat = Math.min(a.lat, b.lat);
    const maxLat = Math.max(a.lat, b.lat);
    const minLng = Math.min(a.lng, b.lng);
    const maxLng = Math.max(a.lng, b.lng);

    const startCellLat = Math.floor(minLat / cellSize);
    const endCellLat = Math.floor(maxLat / cellSize);
    const startCellLng = Math.floor(minLng / cellSize);
    const endCellLng = Math.floor(maxLng / cellSize);

    for (let clat = startCellLat; clat <= endCellLat; clat++) {
      for (let clng = startCellLng; clng <= endCellLng; clng++) {
        const key = `${clat},${clng}`;
        let arr = cells.get(key);
        if (!arr) {
          arr = [];
          cells.set(key, arr);
        }
        arr.push(i);
      }
    }
  }

  return { cellSize, cells };
}

function getNearbySegments(lat: number, lng: number, index: SpatialSegmentIndex): number[] | null {
  const cellLat = Math.floor(lat / index.cellSize);
  const cellLng = Math.floor(lng / index.cellSize);
  const segments: number[] = [];
  const seen = new Set<number>();

  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlng = -1; dlng <= 1; dlng++) {
      const key = `${cellLat + dlat},${cellLng + dlng}`;
      const cellSegments = index.cells.get(key);
      if (cellSegments) {
        for (const idx of cellSegments) {
          if (!seen.has(idx)) {
            seen.add(idx);
            segments.push(idx);
          }
        }
      }
    }
  }

  return segments.length > 0 ? segments : null;
}

export function projectPositionOnRouteForward(
  lat: number,
  lng: number,
  route: ProcessedRoute,
  previousDistanceMeters: number,
  onRouteThresholdMeters: number = 50,
  spatialIndex?: SpatialSegmentIndex,
  pelotonDistances?: number[]
): ProjectionResult {
  if (route.points.length < 2) {
    return projectPositionOnRoute(lat, lng, route, onRouteThresholdMeters);
  }

  const routeLength = route.totalDistance;
  const FORWARD_TOLERANCE = 200;

  const clampedPrevious = Math.min(previousDistanceMeters, routeLength);

  interface Match {
    distanceAlongRoute: number;
    distanceFromRoute: number;
    segmentIndex: number;
  }

  const matches: Match[] = [];

  const segmentIndices = spatialIndex ? getNearbySegments(lat, lng, spatialIndex) : null;
  const iterateOver = segmentIndices || Array.from({ length: route.points.length - 1 }, (_, i) => i);

  for (const i of iterateOver) {
    const a = route.points[i];
    const b = route.points[i + 1];

    const proj = projectPointOnSegment(lng, lat, a.lng, a.lat, b.lng, b.lat);
    const distToProj = haversineDistance(lat, lng, proj.projY, proj.projX);

    if (distToProj <= onRouteThresholdMeters * 3) {
      const segmentLength = b.cumulativeDistance - a.cumulativeDistance;
      const distanceAlongRoute = a.cumulativeDistance + proj.t * segmentLength;

      matches.push({
        distanceAlongRoute,
        distanceFromRoute: distToProj,
        segmentIndex: i
      });
    }
  }

  if (matches.length === 0) {
    if (spatialIndex) {
      return projectPositionOnRouteForward(lat, lng, route, previousDistanceMeters, onRouteThresholdMeters);
    }
    const result = projectPositionOnRoute(lat, lng, route, onRouteThresholdMeters);
    result.distanceAlongRoute = clampedPrevious;
    result.isOnRoute = false;
    return result;
  }

  const onRouteMatches = matches.filter(m => m.distanceFromRoute <= onRouteThresholdMeters);
  const candidateMatches = onRouteMatches.length > 0 ? onRouteMatches : matches;

  const forwardCandidates = candidateMatches
    .filter(m => m.distanceAlongRoute >= clampedPrevious - FORWARD_TOLERANCE)
    .sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute);

  if (forwardCandidates.length > 0) {
    const MIN_INTERSECTION_SPREAD = 2000;
    const MIN_PELOTON_SIZE = 3;

    if (
      forwardCandidates.length > 1 &&
      pelotonDistances && pelotonDistances.length >= MIN_PELOTON_SIZE
    ) {
      const lowestDist = forwardCandidates[0].distanceAlongRoute;
      const highestDist = forwardCandidates[forwardCandidates.length - 1].distanceAlongRoute;
      const spread = highestDist - lowestDist;

      if (spread >= MIN_INTERSECTION_SPREAD) {
        const sortedPeloton = [...pelotonDistances].sort((a, b) => a - b);
        const medianIdx = Math.floor(sortedPeloton.length / 2);
        const pelotonMedian = sortedPeloton[medianIdx];
        const pelotonMin = sortedPeloton[0];
        const pelotonMax = sortedPeloton[sortedPeloton.length - 1];
        const pelotonSpread = pelotonMax - pelotonMin;

        let bestCandidate = forwardCandidates[0];
        let bestScore = -Infinity;

        for (const candidate of forwardCandidates) {
          if (candidate.distanceFromRoute > onRouteThresholdMeters) continue;

          let score = 0;

          const jumpFromPrevious = Math.abs(candidate.distanceAlongRoute - clampedPrevious);
          if (jumpFromPrevious < 1000) score += 50;
          else if (jumpFromPrevious < 3000) score += 30;
          score -= jumpFromPrevious / 1000;

          const nearestPelotonDist = sortedPeloton.reduce((nearest, d) =>
            Math.abs(d - candidate.distanceAlongRoute) < Math.abs(nearest - candidate.distanceAlongRoute) ? d : nearest
          , sortedPeloton[0]);
          const distToNearest = Math.abs(candidate.distanceAlongRoute - nearestPelotonDist);

          const withinPelotonRange = candidate.distanceAlongRoute >= pelotonMin - 10000 &&
            candidate.distanceAlongRoute <= pelotonMax + Math.max(20000, pelotonSpread);

          if (distToNearest < 3000) score += 150;
          else if (distToNearest < 10000) score += 100;
          else if (distToNearest < 20000) score += 40;
          score -= distToNearest / 500;

          if (withinPelotonRange) score += 50;

          if (candidate.distanceAlongRoute >= clampedPrevious) score += 10;

          score -= candidate.distanceFromRoute;

          if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
          }
        }

        if (bestCandidate !== forwardCandidates[0]) {
          console.log(
            `[RouteProjection] Peloton-guided intersection resolution: ` +
            `prev=${(clampedPrevious/1000).toFixed(1)}km, ` +
            `candidates=[${forwardCandidates.map(c => (c.distanceAlongRoute/1000).toFixed(1)).join(', ')}]km, ` +
            `pelotonMedian=${(pelotonMedian/1000).toFixed(1)}km, ` +
            `chose=${(bestCandidate.distanceAlongRoute/1000).toFixed(1)}km (score=${bestScore.toFixed(0)}) ` +
            `instead of default=${(forwardCandidates[0].distanceAlongRoute/1000).toFixed(1)}km`
          );
        }

        return {
          distanceAlongRoute: bestCandidate.distanceAlongRoute,
          distanceFromRoute: bestCandidate.distanceFromRoute,
          isOnRoute: bestCandidate.distanceFromRoute <= onRouteThresholdMeters,
          nearestPointIndex: bestCandidate.segmentIndex
        };
      }
    }

    const best = forwardCandidates[0];
    return {
      distanceAlongRoute: best.distanceAlongRoute,
      distanceFromRoute: best.distanceFromRoute,
      isOnRoute: best.distanceFromRoute <= onRouteThresholdMeters,
      nearestPointIndex: best.segmentIndex
    };
  }

  let closestMatch: Match | null = null;
  let closestDist = Infinity;

  for (const match of candidateMatches) {
    if (match.distanceFromRoute < closestDist) {
      closestDist = match.distanceFromRoute;
      closestMatch = match;
    }
  }

  if (closestMatch && closestMatch.distanceFromRoute <= onRouteThresholdMeters) {
    return {
      distanceAlongRoute: closestMatch.distanceAlongRoute,
      distanceFromRoute: closestMatch.distanceFromRoute,
      isOnRoute: true,
      nearestPointIndex: closestMatch.segmentIndex,
      isBackwardRecovery: true
    };
  }

  if (spatialIndex) {
    return projectPositionOnRouteForward(lat, lng, route, previousDistanceMeters, onRouteThresholdMeters);
  }
  const result = projectPositionOnRoute(lat, lng, route, onRouteThresholdMeters);
  return result;
}

export function getCheckpointDistances(
  startDistance: number,
  endDistance: number,
  intervalMeters: number = 50
): number[] {
  const checkpoints: number[] = [];
  const startCheckpoint = Math.ceil(startDistance / intervalMeters) * intervalMeters;

  for (let d = startCheckpoint; d <= endDistance; d += intervalMeters) {
    checkpoints.push(d);
  }

  return checkpoints;
}
