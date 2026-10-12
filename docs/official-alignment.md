# Official Replay alignment and local verification

This adapter maps the applicable Sentry Replay behavior onto visible Taro
virtual DOM. It does not claim browser feature parity or server acceptance
from unit tests. The protocol remains compatible with the installed
`@sentry/core` 10.66.0; no major dependency or package version change is required.

## Capability matrix

| Capability                   | Implementation / deliberate boundary                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session/error sampling       | Session decision once; positive error rate always buffers; each accepted error in buffer mode draws independently, and a miss keeps buffering.                                                                                                                                                   |
| Continuous visible recording | One root observer; navigation ownership tokens; hidden/native roots stop; late transport/cleanup cannot revive an old root.                                                                                                                                                                      |
| Error buffer                 | Default 30 seconds (browser default is longer); up to 500 events / 512 KiB. Recent checkpoints survive navigation; older events fold into DOM/input/scroll/viewport baseline. Resource pressure may shorten the time window.                                                                     |
| Session segments             | Default five-second flush; supporting SDK drains without replacing observer; constant replay start with monotonic segment IDs. Five-minute session cap defaults to renewal/error-buffer return.                                                                                                  |
| Manual controls              | start, startBuffering, stop, reset, destroy, getReplayId; ordinary buffer flush stays a no-op to preserve the integration's privacy contract; explicit sendBufferedReplay forces promotion.                                                                                                      |
| Exceptions                   | Associate only accepted visible events. Replay error_ids and event context/tags share the Replay ID; a metadata-only breadcrumb keeps errors after an empty drain deliverable.                                                                                                                   |
| Transactions                 | Visible session transactions receive Replay context/tag; validated trace IDs and sanitized names populate official trace_ids/segment_names. Buffer transactions do not trigger sending.                                                                                                          |
| User feedback                | Explicit includeReplay true promotes/flushes the visible recording and sets contexts.feedback.replay_id synchronously before core serializes it. False does not promote. Feedback is not added to error_ids.                                                                                     |
| Input and interaction        | SDK supplies masked input/change, tap/click/touch, element scroll; Taro page scroll and resize bridge to document scroll/viewport events. Native component internals remain unavailable.                                                                                                         |
| Privacy                      | Mask text/input/media by default; maskAllInputs alias, custom maskAttributes (replaces default title/placeholder/aria-label list), explicit trusted static image map. Strip URL credentials/query/hash and sensitive breadcrumb fields.                                                          |
| Metadata                     | Inherit environment/release/dist. Resolve cached client technical contexts before sending so errors and Replay agree; keep developer-tools simulator data separate from the real host. Explicit custom fields win; disabled system collection stays disabled; scope identity is never inherited. |
| Delivery reliability         | Bounded serialized queue; stable-ID retries only for thrown failures; no HTTP-error retry; downstream broken chains dropped; accepted vs unconfirmed handoff diagnostics.                                                                                                                        |
| Resource limits              | Finite normalized duration/event/byte/batch-mutation/queue/retry limits. Mutation storm pauses until another visible attach; oversized initial checkpoint never loops.                                                                                                                           |
| Identity and shutdown        | reset discards local identity boundary and waits for next root; stop/kill/cleanup remove recording hooks/timers; pending completions cannot overwrite later states.                                                                                                                              |
| Logs and metrics             | No fabricated Replay server fields. Direct log/metric Replay correlation is not implemented by this adapter; core event/feedback hooks only cover their documented event types.                                                                                                                  |
| Browser-only facilities      | No iframe/automatic Canvas/WebView/native DOM recording, browser PerformanceObserver or web-vitals/rage-click parity, browser storage sticky sessions, cross-tab sessions.                                                                                                                       |

Optional [WeChat worker compression](./worker-compression.md) follows the official zlib recording protocol. Supporting SDKs drain before session-buffer overflow and promote error buffers without an immediate duplicate snapshot; existing byte limits stay unchanged.

## Official sources and version boundary

Reviewed source anchors for the existing 10.66.0 protocol:

- [Replay modes and sampling](https://github.com/getsentry/sentry-javascript/blob/10.66.0/packages/replay-internal/src/replay.ts): buffer/session, deferred error sampling, public controls and promotion.
- [Replay integration](https://github.com/getsentry/sentry-javascript/blob/10.66.0/packages/replay-internal/src/integration.ts): start/startBuffering/stop/getReplayId, privacy defaults and recording options.
- [Replay request fields](https://github.com/getsentry/sentry-javascript/blob/10.66.0/packages/replay-internal/src/util/sendReplayRequest.ts): replay_start_timestamp, error_ids, trace_ids, segment_names, and HTTP failures.
- [Replay delivery](https://github.com/getsentry/sentry-javascript/blob/10.66.0/packages/replay-internal/src/util/sendReplay.ts): bounded retries for transport exceptions, excluding explicit status failures.

The official current development implementation was also checked on 2026-10-11
for [feedback listeners](https://github.com/getsentry/sentry-javascript/blob/develop/packages/replay-internal/src/util/addGlobalListeners.ts)
and [event correlation](https://github.com/getsentry/sentry-javascript/blob/develop/packages/replay-internal/src/coreHandlers/handleGlobalEvent.ts).
These moving references are supplementary, not a claim that all current
browser features exist in 10.66.0. The installed 10.66.0 core's synchronous
`beforeSendFeedback` hook and feedback shape are verified using a real local
`Client`, `Scope`, and `captureFeedback` in the contract suite.

The browser can react after accepted network responses. This adapter triggers
from core `beforeSendEvent`, after processors/beforeSend/sampling and before
transport. This preserves the existing mini-program/offline integration:
accepted for transport does not mean Sentry ingestion succeeded. No direct
network bypass is introduced. Core may return an empty response after internal
queueing or transport failure; such outcomes are only reported as handed-off.

## Local checks

Run the ordinary checks with synthetic example.test addresses and an in-memory
transport; no Sentry credentials or online ingestion are involved:

```sh
pnpm test
pnpm run check
pnpm run build
pnpm run verify:beta-release
```

The optional candidate SDK contract suite imports the local recorder source,
so unpublished recorder changes can be tested without changing dependencies:

```sh
TARO_REPLAY_SDK_SOURCE=/path/to/sdk/src/replay-poc.ts pnpm test
```

It covers six-minute buffering with a later real mutation, incremental
segments without a second observer, pending duration sends during navigation,
page scroll/viewport output, mutation-limit pauses in both modes, and errors
after draining to zero events. Core feedback/transaction tests use the real
installed core with a synthetic transport. The rest cover finite limits,
sampling retries, cancellation, queue ordering, broken chains, privacy,
checkpoint eviction and Taro/React lifecycle ownership.

Passing these checks proves local behavior only. npm publication, actual
mini-program device performance, Sentry ingestion/playback, and trial-release
acceptance are separate follow-up gates. Candidate-only recorder APIs require
a matching future SDK release; older SDKs safely fall back where documented.

## Explicit Canvas extension

`recordCanvas` defaults to false in the integration and direct recorder options. A host
may supply synchronous PNG/JPEG pixels only for a marked Canvas/View inside the current
recording root. `bridge.recordCanvas(id, readFrame)` performs route ownership checks before
the SDK invokes the reader, and checks again if ownership changes during the call. Older
SDKs without this method are safe no-ops. This extension is separate from ordinary media
URL sanitization; it does not turn off `blockAllMedia`.

Explicit pixel capture cannot automatically mask text, credentials or personal data in
the image. The SDK remains responsible for per-node privacy markers, allowed raster
formats, payload limits and rate limiting. The host should subscribe to recording state
to recapture an already-drawn chart after attach/restart, and release its subscription
on unmount. Recorder replacement may retain the Replay ID; process every recording
notification and throttle duplicate notifications in the host. Successful frame capture
deliberately does not notify subscribers again.

`test/canvas.test.ts` covers disabled/stopped/hidden/reset roots, optional old-SDK support,
foreign/detached/replaced roots, ownership changes and subscription-based refresh through
the public bridge. `test/canvas-sdk.test.ts` runs with `TARO_REPLAY_SDK_SOURCE` to verify
actual recorder output, default media filtering, marker enforcement and rate limiting.
