import { connect, JSONCodec } from "nats";
import type { PositionEvent } from "./types.js";

const jc = JSONCodec<PositionEvent>();

export async function startConsumer(
  handler: (event: PositionEvent) => Promise<void>,
): Promise<void> {
  const nc = await connect({
    servers: process.env.NATS_URL!,
    token: process.env.NATS_TOKEN!,
    name: "koerza-processor",
  });

  console.log("[NATS] Connected to", process.env.NATS_URL);

  const sub = nc.subscribe("pos.>");
  console.log("[NATS] Subscribed to pos.>");

  for await (const msg of sub) {
    try {
      const event = jc.decode(msg.data);
      await handler(event);
    } catch (err) {
      console.error("[NATS] Processing error:", err);
    }
  }
}
