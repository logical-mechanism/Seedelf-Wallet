// Typed request/response messages between the UI and the service worker.
// The service worker owns every secret; the UI only ever asks it to do work.

import type { NetworkName } from "../networks";

export interface Status {
  version: string;
  network: NetworkName;
  networks: NetworkName[];
}

/** Development preview for chunk 4: derive a phrase's keys in the worker. */
export interface Preview {
  phrase: string;
  generated: boolean;
  receiveAddress: string;
  changeAddress: string;
  stakeAddress: string;
  seedelfPublicValue: string;
  millis: number;
}

/** Every request the service worker answers: its payload and its result. */
export interface Requests {
  status: { payload: Record<never, never>; result: Status };
  preview: { payload: { phrase?: string }; result: Preview };
}

export type RequestName = keyof Requests;

export type Message = {
  [K in RequestName]: { type: K } & Requests[K]["payload"];
}[RequestName];

export type Reply<K extends RequestName> =
  | { ok: true; value: Requests[K]["result"] }
  | { ok: false; error: string };

export function isMessage(value: unknown): value is Message {
  const type = (value as { type?: unknown } | null)?.type;
  return type === "status" || type === "preview";
}
