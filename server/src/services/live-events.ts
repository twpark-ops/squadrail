import { EventEmitter } from "node:events";
import type { LiveEvent, LiveEventType } from "@squadrail/shared";
import { logger } from "../middleware/logger.js";

type LiveEventPayload = Record<string, unknown>;
type LiveEventListener = (event: LiveEvent) => void;
type LiveEventSink = (event: LiveEvent) => void | Promise<void>;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);
const sinks = new Set<LiveEventSink>();

let nextEventId = 0;

function toLiveEvent(input: {
  companyId: string;
  type: LiveEventType;
  payload?: LiveEventPayload;
}): LiveEvent {
  nextEventId += 1;
  return {
    id: nextEventId,
    companyId: input.companyId,
    type: input.type,
    createdAt: new Date().toISOString(),
    payload: input.payload ?? {},
  };
}

export function publishLiveEvent(input: {
  companyId: string;
  type: LiveEventType;
  payload?: LiveEventPayload;
}) {
  const event = toLiveEvent(input);
  emitter.emit(input.companyId, event);
  for (const sink of sinks) {
    void Promise.resolve(sink(event)).catch((error) => {
      logger.warn(
        {
          err: error,
          companyId: event.companyId,
          type: event.type,
        },
        "live event sink failed",
      );
    });
  }
  return event;
}

export function subscribeCompanyLiveEvents(companyId: string, listener: LiveEventListener) {
  emitter.on(companyId, listener);
  return () => emitter.off(companyId, listener);
}

export function registerLiveEventSink(listener: LiveEventSink) {
  sinks.add(listener);
  return () => sinks.delete(listener);
}
