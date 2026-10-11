# Taro Replay lifecycle contract

The native host owns one SDK and one `taroReplayIntegration({ sdk })`. Pass its
`bridge` into `installTaroReplayPageLifecycle` once, or use the bridge-only page
hook. Do not install both lifecycle paths. The adapter entry has no runtime
`@sentry/core` dependency and Taro never imports a second mini-program SDK.

## Sampling and sessions

1. Sample `replaysSessionSampleRate` once when constructing the coordinator.
2. If it misses and `replaysOnErrorSampleRate > 0`, enter `buffer` immediately.
3. In buffer mode, each exception reaching `beforeSendEvent` draws independently for error
   Replay sampling. A miss keeps buffering. `beforeErrorSampling` can veto an
   error before the draw. Core event processors, `beforeSend`, and error
   `sampleRate` have already run; this means accepted for transport, not a
   confirmed server receipt.

Only an attached visible Taro root may associate events or promote a buffer.
Native pages, background time, disabled instances and missing roots do not
record. Missing roots may retry on the next ready/show; they do not permanently
poison the coordinator. Session/error sample rates and limits reject nonfinite
values by falling back to safe defaults.

Buffer promotion freezes one playable capture and immediately continues a
session using the same Replay ID. Error `contexts.replay.replay_id` and
`tags.replayId` match Replay `error_ids`. Transaction events only associate in
session mode, while bounded trace IDs/page names may be collected in a buffer
for its eventual promotion. Feedback requires explicit `includeReplay: true`
and uses official `contexts.feedback.replay_id`; it is not an exception.

Session flush defaults to five seconds. A supporting recorder drains events
with `takeSegment()` while retaining its observer, node IDs and interactions.
The first segment has a full snapshot; later increments keep increasing
`segment_id` and a stable `replay_start_timestamp`. Old SDKs fall back to a
safe stop/restart per segment. Navigation stops the old root synchronously;
async send completion cannot recreate it. Late cleanup from an old page does
not stop the new visible root.

The default recording limit is five minutes per session. An error-promoted
session returns to error buffering at its deadline; session-sampled mode starts
a new session. Buffer recorder duration merely renews local recording, so long
visible pages still capture later mutations. The rolling buffer preserves
recent full snapshots/navigation instead of throwing away the previous page
on every new checkpoint. Age, event and byte eviction advance a playable
checkpoint including DOM, input, scroll and viewport state.

## Public controls

| Method                                | Behavior                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flush()`                             | Sends a session segment and waits for delivery; no-op in buffer.                                                                                                                 |
| `sendBufferedReplay()`                | Explicitly sends a visible playable buffer without an error draw and continues session recording.                                                                                |
| `start()` / `startBuffering()`        | Explicitly starts the chosen mode after stopping or when sampling disabled; an already active mode is unchanged.                                                                 |
| `stop({ flush: true })`               | Releases recording immediately and sends the remaining session segment. Buffer is discarded.                                                                                     |
| `stop({ flush: false })`              | Releases recording and cancels adapter queue/retries.                                                                                                                            |
| `reset()`                             | Discards identity-sensitive capture and adapter queue, creates a fresh sampled Replay, and waits for a new visible attach. Call before clearing authentication state/navigation. |
| `destroy()` / integration `cleanup()` | Permanently releases the instance, hooks, timers, captures and subscribers. Repeated integration setup destroys the prior instance.                                              |
| `refreshEnabled()`                    | Evaluates `enabled`; false immediately releases recording and adapter queue. A later enable needs explicit start/reset.                                                          |
| `getReplayId()` / `getSnapshot()`     | Exposes current Replay identity and recording/delivery diagnostics.                                                                                                              |

Mutation storms stop with `mutation-limit`. Session mode offers its safe prior
capture to delivery; buffer mode retains it locally. Both report
`recording: false` and wait for another visible attach rather than immediately
repeating expensive serialization. An initial checkpoint that cannot fit the
budget similarly stops without a restart loop.

## Privacy and delivery

Text, inputs and media are masked by default. Trusted static image mappings
are deliberate bounded exceptions; remote or user-provided resources are not
implicitly trusted. URLs omit query/hash/userinfo; breadcrumbs exclude
sensitive fields; `metadata.user` requires `allowUser: true`. Device metadata
uses model/brand, actual operating system and WeChat version separately, never
a device identifier. Metadata inherits environment, release and dist.

A serialized queue holds at most four segments / 2 MiB including the in-flight
segment. Thrown send failures use bounded retry (two retries, one/two seconds
by default) with unchanged Replay/segment IDs. Explicit HTTP errors are not
retried; a failed baseline drops queued dependent increments. The adapter
always uses the current `Client.sendEnvelope` to preserve SDK consent,
rate-limits and offline transport. `{}`/undefined outcomes are `handed-off`,
not a falsely confirmed upload; only concrete 2xx increments `acceptedSegments`.

Reset/stop/kill switch invalidate pending completions, cancel timers and discard
not-yet-sent adapter queue items. They cannot retract requests or offline data
already handed to the client. Diagnostics expose pending bytes/segments,
accepted/handoff/dropped counts, retries and the last status/code.

See [official alignment and local verification](./official-alignment.md).
