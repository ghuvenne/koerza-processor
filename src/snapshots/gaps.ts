import { writeSnapshot } from "../redis.js";
import { getRaceState } from "../state.js";

interface GapEntry {
  leaderId: string;
  followerId: string;
  distanceMeters: number;
  timeGapSeconds: number | null;
}

export async function writeGapsSnapshot(raceId: string): Promise<void> {
  const race = getRaceState(raceId);
  if (!race || !race.isActive) {
    await writeSnapshot(raceId, "gaps", [], 15);
    return;
  }

  const FINISH_THRESHOLD = 100;

  interface TrackerWithDistance {
    trackerId: string;
    baseDist: number;
    offset: number;
    totalDist: number;
  }

  const activeTrackers: TrackerWithDistance[] = [];

  for (const [trackerId, tracker] of race.trackers) {
    if (tracker.hiddenFromPublic) continue;

    const baseDist = Math.floor(tracker.lastDistanceMeters / 50) * 50;
    const offset = tracker.distanceOffsetMeters;
    const totalDist = baseDist + offset;

    if (race.routeLength !== null && totalDist >= race.routeLength - FINISH_THRESHOLD) continue;
    if (totalDist <= 0) continue;

    activeTrackers.push({ trackerId, baseDist, offset, totalDist });
  }

  if (activeTrackers.length < 2) {
    await writeSnapshot(raceId, "gaps", [], 15);
    return;
  }

  // Sort leader first
  activeTrackers.sort((a, b) => b.totalDist - a.totalDist);

  const gaps: GapEntry[] = [];

  for (let i = 1; i < activeTrackers.length; i++) {
    const leader = activeTrackers[i - 1];
    const follower = activeTrackers[i];
    const distanceGap = leader.totalDist - follower.totalDist;

    let timeGapSeconds: number | null = null;

    if (leader.offset === follower.offset) {
      const followerTracker = race.trackers.get(follower.trackerId);
      const leaderTracker = race.trackers.get(leader.trackerId);

      if (followerTracker && leaderTracker) {
        const followerCheckpointDist = Math.floor(follower.baseDist / 50) * 50;

        if (followerCheckpointDist > 0) {
          const followerTime = followerTracker.checkpoints.get(followerCheckpointDist);
          const leaderTime = findNearestCheckpointAtOrBelow(leaderTracker.checkpoints, followerCheckpointDist);

          if (followerTime && leaderTime) {
            const diff = new Date(followerTime).getTime() - new Date(leaderTime).getTime();
            timeGapSeconds = Math.round(diff / 1000);
          }
        }
      }
    }

    gaps.push({ leaderId: leader.trackerId, followerId: follower.trackerId, distanceMeters: distanceGap, timeGapSeconds });
  }

  await writeSnapshot(raceId, "gaps", gaps, 15);
}

function findNearestCheckpointAtOrBelow(checkpoints: Map<number, string>, targetDistance: number): string | undefined {
  let bestDist = -1;
  let bestTime: string | undefined;

  for (const [dist, time] of checkpoints) {
    if (dist <= targetDistance && dist > bestDist) {
      bestDist = dist;
      bestTime = time;
    }
  }

  return bestTime;
}
