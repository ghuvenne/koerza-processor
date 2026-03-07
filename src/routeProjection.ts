import { Pool } from "pg";
import {
  processRoute,
  buildSpatialIndex,
  projectPositionOnRouteForward,
  type ProcessedRoute,
  type SpatialSegmentIndex,
} from "./lib/gpxUtils.js";
import { getOrCreateRaceState } from "./state.js";

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

interface RaceRouteCache {
  route: ProcessedRoute;
  spatialIndex: SpatialSegmentIndex;
}

const routeCache = new Map<string, RaceRouteCache>();

async function loadRouteForRace(raceId: string): Promise<RaceRouteCache | null> {
  try {
    // Column name may vary: gpx_data, route_gpx, gpx, etc.
    const result = await pool.query(
      `SELECT gpx_data, on_route_distance_meters FROM races WHERE id = $1 LIMIT 1`,
      [raceId],
    );

    if (result.rows.length === 0) {
      console.warn(`[RouteProjection] No race found for id=${raceId}`);
      return null;
    }

    const row = result.rows[0];
    const gpxStr = typeof row.gpx_data === "string" ? row.gpx_data : JSON.stringify(row.gpx_data);
    const route = processRoute(gpxStr);
    if (!route) {
      console.warn(`[RouteProjection] Could not parse GPX for race=${raceId}`);
      return null;
    }

    // Store route length in hot state so gaps can use it
    const raceState = getOrCreateRaceState(raceId);
    raceState.routeLength = row.on_route_distance_meters ?? route.totalDistance;

    const spatialIndex = buildSpatialIndex(route, 500);
    const cache: RaceRouteCache = { route, spatialIndex };
    routeCache.set(raceId, cache);

    console.log(
      `[RouteProjection] Loaded route for race=${raceId}: ${(route.totalDistance / 1000).toFixed(1)}km, ${route.points.length} points`,
    );
    return cache;
  } catch (err: any) {
    console.error(`[RouteProjection] Failed to load route for race=${raceId}:`, err.message);
    return null;
  }
}

export async function projectPosition(
  raceId: string,
  lat: number,
  lon: number,
  previousDistanceMeters: number,
  pelotonDistances?: number[],
): Promise<number | null> {
  let cache = routeCache.get(raceId);
  if (!cache) {
    cache = (await loadRouteForRace(raceId)) ?? undefined;
    if (!cache) return null;
  }

  const result = projectPositionOnRouteForward(
    lat,
    lon,
    cache.route,
    previousDistanceMeters,
    25, // 25m on-route threshold
    cache.spatialIndex,
    pelotonDistances,
  );

  return result.distanceAlongRoute;
}
