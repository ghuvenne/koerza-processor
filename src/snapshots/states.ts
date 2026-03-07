import { writeSnapshot } from "../redis.js";
import { getRaceState } from "../state.js";

interface TrackerStateSnapshot {
  id: string;
  raceId: string;
  trackerId: string;
  status: string | null;
  dnfTime: string | null;
  hiddenFromPublic: boolean;
  lastDistanceMeters: string;       // decimal string e.g. "12500.00"
  lastPositionTime: string | null;
  distanceOffsetMeters: number;
  offsetSetAt: string | null;
  totalSpeedSum: string | null;     // decimal string e.g. "4502.35"
  speedSampleCount: number | null;
  lastProcessedPositionTime: string | null;
  averageSpeedKmh: string | null;   // decimal string e.g. "45.03"
  avgSpeedCalculatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function writeStatesSnapshot(raceId: string): Promise<void> {
  const race = getRaceState(raceId);
  if (!race) return;

  const now = new Date().toISOString();
  const states: TrackerStateSnapshot[] = [];

  for (const [trackerId, tracker] of race.trackers) {
    states.push({
      id: `${raceId}-${trackerId}`,
      raceId,
      trackerId,
      status: tracker.status,
      dnfTime: null,
      hiddenFromPublic: tracker.hiddenFromPublic,
      lastDistanceMeters: tracker.lastDistanceMeters.toFixed(2),
      lastPositionTime: tracker.lastPositionTime,
      distanceOffsetMeters: tracker.distanceOffsetMeters,
      offsetSetAt: null,
      totalSpeedSum: tracker.speedSampleCount > 0 ? tracker.totalSpeedSum.toFixed(2) : null,
      speedSampleCount: tracker.speedSampleCount > 0 ? tracker.speedSampleCount : null,
      lastProcessedPositionTime: tracker.lastPositionTime,
      averageSpeedKmh: tracker.averageSpeedKmh != null ? tracker.averageSpeedKmh.toFixed(2) : null,
      avgSpeedCalculatedAt: tracker.averageSpeedKmh != null ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  await writeSnapshot(raceId, "states", states, 15);
}
