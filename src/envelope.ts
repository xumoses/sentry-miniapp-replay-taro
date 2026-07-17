import type { ReplayEnvelope, ReplayEvent, SdkInfo } from '@sentry/core';

import type { SentryReplayClient, TaroReplayCapture } from './types';

/** Counts UTF-8 bytes without TextEncoder, which is absent in some mini program runtimes. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export function serializeReplayRecording(capture: TaroReplayCapture): string {
  return [JSON.stringify({ segment_id: 0 }), ...capture.events.map(event => JSON.stringify(event))].join(
    '\n',
  );
}

export function createReplayEnvelope(
  capture: TaroReplayCapture,
  options: { dsn?: string; sdk?: SdkInfo } = {},
): ReplayEnvelope {
  const endedAt = capture.endedAt ?? capture.startedAt;
  const metadata = capture.metadata || {};
  // `segment_names` became required after @sentry/core 10.63. Keep it in the
  // payload while using an intersection so the adapter also compiles on 10.63.
  const replayEvent: ReplayEvent & { segment_names: string[] } = {
    event_id: capture.replayId,
    type: 'replay_event',
    timestamp: endedAt / 1_000,
    start_timestamp: capture.startedAt / 1_000,
    replay_start_timestamp: capture.startedAt / 1_000,
    replay_id: capture.replayId,
    segment_id: 0,
    replay_type: 'session',
    platform: 'javascript',
    urls: [capture.href],
    error_ids: [],
    trace_ids: [],
    segment_names: [],
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.release ? { release: metadata.release } : {}),
    ...(metadata.sdk ? { sdk: metadata.sdk } : {}),
    ...(metadata.user ? { user: metadata.user } : {}),
    ...(metadata.tags ? { tags: metadata.tags } : {}),
    ...(metadata.contexts ? { contexts: metadata.contexts } : {}),
  };
  const recording = serializeReplayRecording(capture);

  return [
    {
      event_id: capture.replayId,
      sent_at: new Date(endedAt).toISOString(),
      ...(options.dsn ? { dsn: options.dsn } : {}),
      ...(options.sdk ? { sdk: options.sdk } : {}),
    },
    [
      [{ type: 'replay_event' }, replayEvent],
      [{ type: 'replay_recording', length: utf8ByteLength(recording) }, recording],
    ],
  ];
}

export async function sendReplayCapture(
  client: SentryReplayClient,
  capture: TaroReplayCapture,
): Promise<void> {
  const dsn = client.getDsn?.()?.toString();
  const envelope = createReplayEnvelope(capture, {
    ...(dsn ? { dsn } : {}),
    ...(capture.metadata?.sdk ? { sdk: capture.metadata.sdk } : {}),
  });
  await Promise.resolve(client.sendEnvelope(envelope));
}
