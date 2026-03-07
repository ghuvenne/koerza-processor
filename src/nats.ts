import { connect, JSONCodec, type NatsConnection } from "nats";
import type { PositionEvent } from "./types.js";

export const jc = JSONCodec<PositionEvent>();

let ncPromise: Promise<NatsConnection> | null = null;

export async function getNats(): Promise<NatsConnection> {
  if (!ncPromise) {
    ncPromise = connect({
      servers: process.env.NATS_URL!,
      token: process.env.NATS_TOKEN!,
      name: "koerza-processor",
    });
  }

  return ncPromise;
}