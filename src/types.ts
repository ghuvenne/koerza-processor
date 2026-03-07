import { z } from "zod";

export const PositionEventSchema = z.object({
  trackerId: z.string(),
  raceId: z.string().optional(),
  ts: z.string(),
  lat: z.number(),
  lon: z.number(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  source: z.string().optional(),
});

export type PositionEvent = z.infer<typeof PositionEventSchema>;