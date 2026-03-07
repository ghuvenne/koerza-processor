export interface TrackerHotState {
  trackerId: string;
  lastDistanceMeters: number;
  lastPositionTime: string;
  distanceOffsetMeters: number;
  status: string | null;
  hiddenFromPublic: boolean;
  averageSpeedKmh: number | null;
  totalSpeedSum: number;
  speedSampleCount: number;
  checkpoints: Map<number, string>; // distanceMeters -> ISO passedAt
}

export interface RaceHotState {
  raceId: string;
  trackers: Map<string, TrackerHotState>;
  routeLength: number | null;
  isActive: boolean;
}

const races = new Map<string, RaceHotState>();

export function getRaceState(raceId: string): RaceHotState | undefined {
  return races.get(raceId);
}

export function getOrCreateRaceState(raceId: string): RaceHotState {
  let state = races.get(raceId);
  if (!state) {
    state = { raceId, trackers: new Map(), routeLength: null, isActive: true };
    races.set(raceId, state);
  }
  return state;
}

export function updateTrackerState(
  raceId: string,
  trackerId: string,
  distanceMeters: number,
  positionTime: string,
  speedKmh?: number,
): TrackerHotState {
  const race = getOrCreateRaceState(raceId);
  let tracker = race.trackers.get(trackerId);

  if (!tracker) {
    tracker = {
      trackerId,
      lastDistanceMeters: 0,
      lastPositionTime: positionTime,
      distanceOffsetMeters: 0,
      status: null,
      hiddenFromPublic: false,
      averageSpeedKmh: null,
      totalSpeedSum: 0,
      speedSampleCount: 0,
      checkpoints: new Map(),
    };
    race.trackers.set(trackerId, tracker);
  }

  // Fill in checkpoint timestamps for every 50m interval crossed
  if (distanceMeters > tracker.lastDistanceMeters) {
    const startCheckpoint = Math.ceil((tracker.lastDistanceMeters + 1) / 50) * 50;
    const endCheckpoint = Math.floor(distanceMeters / 50) * 50;
    for (let cp = startCheckpoint; cp <= endCheckpoint; cp += 50) {
      if (!tracker.checkpoints.has(cp)) {
        tracker.checkpoints.set(cp, positionTime);
      }
    }
  }

  // Update running speed average
  if (speedKmh !== undefined && speedKmh > 0) {
    tracker.totalSpeedSum += speedKmh;
    tracker.speedSampleCount += 1;
    tracker.averageSpeedKmh = tracker.totalSpeedSum / tracker.speedSampleCount;
  } else if (distanceMeters > tracker.lastDistanceMeters) {
    const prevTime = new Date(tracker.lastPositionTime).getTime();
    const currTime = new Date(positionTime).getTime();
    const dtSeconds = (currTime - prevTime) / 1000;
    const dMeters = distanceMeters - tracker.lastDistanceMeters;
    if (dtSeconds > 0 && dMeters > 0) {
      const computedKmh = (dMeters / dtSeconds) * 3.6;
      if (computedKmh > 0 && computedKmh < 200) {
        tracker.totalSpeedSum += computedKmh;
        tracker.speedSampleCount += 1;
        tracker.averageSpeedKmh = tracker.totalSpeedSum / tracker.speedSampleCount;
      }
    }
  }

  tracker.lastDistanceMeters = distanceMeters;
  tracker.lastPositionTime = positionTime;

  return tracker;
}
