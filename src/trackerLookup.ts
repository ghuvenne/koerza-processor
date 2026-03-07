import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const trackerToRace = new Map<string, string>(); // trackerId -> raceId

export function getRaceIdForTracker(trackerId: string): string | undefined {
  return trackerToRace.get(trackerId);
}

async function refreshLookup(): Promise<void> {
  try {
    const result = await pool.query<{ race_id: string; tracker_id: string }>(`
      SELECT r.id AS race_id, t.id AS tracker_id
      FROM races r
      JOIN tracker_groups tg ON r.tracker_group_id = tg.id
      JOIN tracker_group_members tgm ON tgm.group_id = tg.id
      JOIN trackers t ON t.id = tgm.tracker_id
      WHERE r.is_active = true
    `);

    trackerToRace.clear();
    for (const row of result.rows) {
      trackerToRace.set(row.tracker_id, row.race_id);
    }

    console.log(`[TrackerLookup] Loaded ${trackerToRace.size} tracker(s) across active races`);
  } catch (err: any) {
    console.error("[TrackerLookup] Failed to refresh:", err.message);
  }
}

export async function startTrackerLookup(): Promise<void> {
  await refreshLookup();
  setInterval(refreshLookup, 60_000);
}
