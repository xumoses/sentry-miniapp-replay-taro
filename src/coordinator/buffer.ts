import { utf8ByteLength } from '../envelope';
import type { TaroReplayEvent } from '../types';

export interface ReplayBufferBounds {
  now: number;
  windowMs: number;
  maxEvents: number;
  maxBytes: number;
}

function eventBytes(event: TaroReplayEvent): number {
  return utf8ByteLength(JSON.stringify(event));
}

/**
 * Retains the newest Meta + FullSnapshot checkpoint and a bounded tail.
 * The result remains playable even after time/count/byte eviction.
 */
export function boundReplayEvents(
  events: TaroReplayEvent[],
  bounds: ReplayBufferBounds,
): TaroReplayEvent[] {
  const cutoff = bounds.now - Math.max(0, bounds.windowMs);
  let fullSnapshotIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === 2) {
      fullSnapshotIndex = index;
      break;
    }
  }
  if (fullSnapshotIndex < 0) return [];
  let metaIndex = fullSnapshotIndex - 1;
  while (metaIndex >= 0 && events[metaIndex]?.type !== 4) metaIndex--;
  const checkpoints = [...(metaIndex >= 0 ? [events[metaIndex]!] : []), events[fullSnapshotIndex]!];
  const tail = events
    .slice(fullSnapshotIndex + 1)
    .filter((event) => event.type !== 4 && event.type !== 2 && event.timestamp >= cutoff);
  const bounded = [...checkpoints, ...tail];
  let bytes = bounded.reduce((sum, event) => sum + eventBytes(event), 0);
  while (
    bounded.length > Math.max(2, bounds.maxEvents) ||
    (bytes > bounds.maxBytes && bounded.length > 2)
  ) {
    const removed = bounded.splice(2, 1)[0];
    if (removed) bytes -= eventBytes(removed);
  }
  return bounded;
}
