import { getNats, jc } from "./nats.js";
import { redis } from "./redis.js";
import { PositionEventSchema } from "./types.js";

async function main() {
  const nc = await getNats();
  const sub = nc.subscribe("pos.>");

  console.log("Processor listening on pos.>");

  for await (const msg of sub) {
    try {
      const event = PositionEventSchema.parse(jc.decode(msg.data));

      const key = `t:${event.trackerId}`;
      const pipeline = redis.pipeline();

      pipeline.hset(key, {
        trackerId: event.trackerId,
        raceId: event.raceId ?? "",
        ts: event.ts,
        lat: event.lat,
        lon: event.lon,
        speed: event.speed ?? "",
        heading: event.heading ?? ""
      });

      pipeline.expire(key, 600);
      await pipeline.exec();

      console.log("Updated hot state", event.trackerId);
    } catch (err) {
      console.error("Processor error", err);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error", err);
  process.exit(1);
});