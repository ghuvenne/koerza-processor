import { startConsumer } from "./nats.js";
import { updateTrackerState, getRaceState } from "./state.js";
import { projectPosition } from "./routeProjection.js";
import { writePositionsSnapshot } from "./snapshots/positions.js";
import { writeStatesSnapshot } from "./snapshots/states.js";
import { writeAlertsSnapshot } from "./snapshots/alerts.js";
import { writeGapsSnapshot } from "./snapshots/gaps.js";
import type { PositionEvent } from "./types.js";

// Throttle: write snapshots at most every 3s per race
const SNAPSHOT_INTERVAL_MS = 3000;
const ALERTS_INTERVAL_MS = 30_000;
const lastSnapshotTime = new Map<string, number>();
const lastAlertsTime = new Map<string, number>();

function shouldWrite(map: Map<string, number>, raceId: string, intervalMs: number): boolean {
  const now = Date.now();
  const last = map.get(raceId) ?? 0;
  if (now - last < intervalMs) return false;
  map.set(raceId, now);
  return true;
}

async function handlePositionEvent(event: PositionEvent): Promise<void> {
  const raceId = event.raceId;
  if (!raceId || raceId === "unknown") return;

  // Get current distance for this tracker (for forward-only projection)
  const currentRace = getRaceState(raceId);
  const previousDistance = currentRace?.trackers.get(event.trackerId)?.lastDistanceMeters ?? 0;

  // Gather peloton distances for intersection disambiguation
  const pelotonDistances = currentRace
    ? Array.from(currentRace.trackers.values()).map(t => t.lastDistanceMeters)
    : undefined;

  // Project GPS position onto route
  const distanceMeters = await projectPosition(
    raceId,
    event.lat,
    event.lon,
    previousDistance,
    pelotonDistances,
  );

  if (distanceMeters === null) {
    // Route not loaded yet or not found; skip snapshot
    return;
  }

  // Update in-memory hot state
  updateTrackerState(raceId, event.trackerId, distanceMeters, event.ts, event.speed);

  // Throttled snapshot writes
  if (shouldWrite(lastSnapshotTime, raceId, SNAPSHOT_INTERVAL_MS)) {
    const writes: Promise<void>[] = [
      writePositionsSnapshot(raceId),
      writeStatesSnapshot(raceId),
      writeGapsSnapshot(raceId),
    ];

    if (shouldWrite(lastAlertsTime, raceId, ALERTS_INTERVAL_MS)) {
      writes.push(writeAlertsSnapshot(raceId));
    }

    await Promise.allSettled(writes);
  }
}

async function main() {
  console.log("[Processor] Starting koerza-processor...");
  await startConsumer(handlePositionEvent);
}

main().catch((err) => {
  console.error("[Processor] Fatal error:", err);
  process.exit(1);
});