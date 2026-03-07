export interface RoutePoint {
  lat: number;
  lng: number;
  cumulativeDistance: number;
}

export interface ProcessedRoute {
  points: RoutePoint[];
  totalDistance: number;
}

export interface ProjectionResult {
  distanceAlongRoute: number;
  distanceFromRoute: number;
  isOnRoute: boolean;
  nearestPointIndex: number;
  isBackwardRecovery?: boolean;
}

export interface GpxWaypoint {
  lat: number;
  lng: number;
  name: string;
  description?: string;
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function parseGpxToCoordinates(gpxData: string): Array<{ lat: number; lng: number }> {
  const coords: Array<{ lat: number; lng: number }> = [];

  try {
    const parsed = JSON.parse(gpxData);
    if (parsed && Array.isArray(parsed.points)) {
      for (const point of parsed.points) {
        const lat = typeof point.lat === 'number' ? point.lat : parseFloat(point.lat);
        const lng = typeof point.lng === 'number' ? point.lng : parseFloat(point.lng);
        if (isFinite(lat) && isFinite(lng)) {
          coords.push({ lat, lng });
        }
      }
      if (coords.length > 0) {
        return coords;
      }
    }
  } catch {
  }

  const trkptRegex = /<trkpt[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["']/gi;
  let match;
  while ((match = trkptRegex.exec(gpxData)) !== null) {
    coords.push({
      lat: parseFloat(match[1]),
      lng: parseFloat(match[2])
    });
  }

  if (coords.length === 0) {
    const rptRegex = /<(?:\w+:)?rpt[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["']/gi;
    while ((match = rptRegex.exec(gpxData)) !== null) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (isFinite(lat) && isFinite(lng)) {
        coords.push({ lat, lng });
      }
    }
  }

  if (coords.length === 0) {
    const rteptRegex = /<rtept[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["']/gi;
    while ((match = rteptRegex.exec(gpxData)) !== null) {
      coords.push({
        lat: parseFloat(match[1]),
        lng: parseFloat(match[2])
      });
    }
  }

  return coords;
}

export function processRoute(gpxData: string | null | undefined): ProcessedRoute | null {
  if (!gpxData) return null;

  const coords = parseGpxToCoordinates(gpxData);
  if (coords.length === 0) return null;

  const points: RoutePoint[] = [];
  let cumulativeDistance = 0;

  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      cumulativeDistance += haversineDistance(
        coords[i - 1].lat, coords[i - 1].lng,
        coords[i].lat, coords[i].lng
      );
    }
    points.push({
      lat: coords[i].lat,
      lng: coords[i].lng,
      cumulativeDistance
    });
  }

  return {
    points,
    totalDistance: cumulativeDistance
  };
}

export function projectPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): { projX: number; projY: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return { projX: ax, projY: ay, t: 0 };
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  return {
    projX: ax + t * dx,
    projY: ay + t * dy,
    t
  };
}

export function parseGpxWaypoints(gpxData: string): GpxWaypoint[] {
  const waypoints: GpxWaypoint[] = [];

  try {
    const parsed = JSON.parse(gpxData);
    if (parsed && Array.isArray(parsed.waypoints)) {
      for (const wpt of parsed.waypoints) {
        const lat = typeof wpt.lat === 'number' ? wpt.lat : parseFloat(wpt.lat);
        const lng = typeof wpt.lng === 'number' ? wpt.lng : parseFloat(wpt.lng);
        if (isFinite(lat) && isFinite(lng) && wpt.name) {
          waypoints.push({
            lat,
            lng,
            name: wpt.name,
            description: wpt.description || wpt.desc || undefined
          });
        }
      }
      if (waypoints.length > 0) {
        return waypoints;
      }
    }
  } catch {
  }

  const wptRegex = /<wpt[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/wpt>/gi;
  let match;
  while ((match = wptRegex.exec(gpxData)) !== null) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    const content = match[3];

    const nameMatch = /<name>([^<]*)<\/name>/i.exec(content);
    const name = nameMatch ? nameMatch[1].trim() : '';

    const descMatch = /<desc>([^<]*)<\/desc>/i.exec(content);
    const cmtMatch = /<cmt>([^<]*)<\/cmt>/i.exec(content);
    const description = descMatch ? descMatch[1].trim() : (cmtMatch ? cmtMatch[1].trim() : undefined);

    if (isFinite(lat) && isFinite(lng) && name) {
      waypoints.push({ lat, lng, name, description });
    }
  }

  return waypoints;
}

export function projectPositionOnRoute(
  lat: number,
  lng: number,
  route: ProcessedRoute,
  onRouteThresholdMeters: number = 50
): ProjectionResult {
  if (route.points.length === 0) {
    return {
      distanceAlongRoute: 0,
      distanceFromRoute: Infinity,
      isOnRoute: false,
      nearestPointIndex: 0
    };
  }

  if (route.points.length === 1) {
    const dist = haversineDistance(lat, lng, route.points[0].lat, route.points[0].lng);
    return {
      distanceAlongRoute: 0,
      distanceFromRoute: dist,
      isOnRoute: dist <= onRouteThresholdMeters,
      nearestPointIndex: 0
    };
  }

  let minDistance = Infinity;
  let bestDistanceAlongRoute = 0;
  let bestSegmentIndex = 0;

  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i];
    const b = route.points[i + 1];

    const proj = projectPointOnSegment(lng, lat, a.lng, a.lat, b.lng, b.lat);
    const distToProj = haversineDistance(lat, lng, proj.projY, proj.projX);

    if (distToProj < minDistance) {
      minDistance = distToProj;
      const segmentLength = b.cumulativeDistance - a.cumulativeDistance;
      bestDistanceAlongRoute = a.cumulativeDistance + proj.t * segmentLength;
      bestSegmentIndex = i;
    }
  }

  return {
    distanceAlongRoute: bestDistanceAlongRoute,
    distanceFromRoute: minDistance,
    isOnRoute: minDistance <= onRouteThresholdMeters,
    nearestPointIndex: bestSegmentIndex
  };
}
