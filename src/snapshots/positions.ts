import { writeSnapshot } from "../redis.js";
import { getRaceState } from "../state.js";

interface RacePositionSnapshot {
  id: string;
  raceId: string;
  trackerId: string;
  distanceMeters: number; // integer, multiple of 50
  passedAt: string;       // ISO timestamp
}

export async function writePositionsSnapshot(raceId: string): Promise<void> {
  const race = getRaceState(raceId);
  if (!race) return;

  const positions: RacePositionSnapshot[] = [];

  for (const [trackerId, tracker] of race.trackers) {
    const checkpoint = Math.floor(tracker.lastDistanceMeters / 50) * 50;
    if (checkpoint <= 0) continue;

    positions.push({
      id: `${raceId}-${trackerId}-${checkpoint}`,
      raceId,
      trackerId,
      distanceMeters: checkpoint,
      passedAt: tracker.checkpoints.get(checkpoint) ?? tracker.lastPositionTime,
    });
  }

  await writeSnapshot(raceId, "positions", positions, 15);
}
