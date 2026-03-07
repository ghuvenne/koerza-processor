import { connect, JSONCodec, AckPolicy, DeliverPolicy } from "nats";
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

  const js = nc.jetstream();
  const jsm = await nc.jetstreamManager();

  // Create or reuse a durable consumer on the POS stream
  try {
    await jsm.consumers.add("POS", {
      durable_name: "koerza-processor",
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      filter_subject: "pos.>",
    });
  } catch (err: any) {
    // Consumer already exists — that's fine
    if (!err.message?.includes("consumer name already in use") && !err.message?.includes("already exists")) {
      throw err;
    }
  }

  const consumer = await js.consumers.get("POS", "koerza-processor");
  console.log("[NATS] JetStream consumer ready on POS stream");

  const messages = await consumer.consume();
  for await (const msg of messages) {
    try {
      const event = jc.decode(msg.data);
      await handler(event);
      msg.ack();
    } catch (err) {
      console.error("[NATS] Processing error:", err);
      msg.nak();
    }
  }
}
