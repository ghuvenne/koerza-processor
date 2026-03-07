import { Pool } from "pg";
import { writeSnapshot } from "../redis.js";

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

interface AlertSnapshot {
  id: string;
  raceId: string;
  type: string;
  lat: string;           // decimal string e.g. "51.0500000"
  lng: string;           // decimal string e.g. "3.7303000"
  address: string | null;
  description: string | null;
  isPush: boolean;
  isActive: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export async function writeAlertsSnapshot(raceId: string): Promise<void> {
  try {
    const result = await pool.query<AlertSnapshot>(
      `SELECT
         id,
         race_id      AS "raceId",
         type,
         lat,
         lng,
         address,
         description,
         is_push      AS "isPush",
         is_active    AS "isActive",
         created_at   AS "createdAt",
         resolved_at  AS "resolvedAt"
       FROM organizer_alerts
       WHERE race_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [raceId],
    );
    await writeSnapshot(raceId, "alerts", result.rows, 30);
  } catch (err: any) {
    console.error(`[Alerts] Failed for race=${raceId}:`, err.message);
  }
}
