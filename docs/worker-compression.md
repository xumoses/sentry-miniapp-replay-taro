# WeChat Replay compression and buffer ownership

This optional adapter uses the same recording format as Sentry JavaScript
10.66.0. It does not use browser `Worker`, Blob URLs, `CompressionStream`, or
HTTP `Content-Encoding`. The main thread owns collection, privacy filtering,
segment ordering and the initialized Sentry client's transport.

## Host setup

Resolve `@xumoses/sentry-miniapp-replay-taro/worker` in the host build and copy
that standalone JavaScript file into the mini-program worker directory. Its banner retains the bundled fflate MIT license;
`dist/worker/fflate.LICENSE` is also supplied for third-party notices. For example, package it as `workers/sentry-replay.js` and configure:

```json
{ "workers": "workers" }
```

```ts
const replay = taroReplayIntegration({
  sdk: Sentry,
  compression: { workerPath: 'workers/sentry-replay.js' },
});
```

The worker export is a build asset: resolve/copy it, never import or execute it
on the main thread. It is an ES2015 IIFE with fflate bundled and no external
module requirements. `workerPath` is relative to the mini-program root, not
relative to an npm module or Taro page. The host must include it in the
mini-program package before opening developer tools or uploading a release.

Compression is opt-in because a WeChat application can own only one worker at
a time, and this package cannot safely replace another feature's worker.
`createWorker(path)` may be injected by a host with its own worker factory.
The returned worker is exclusively owned and terminated by this integration;
never return a worker shared with another feature. Missing platform support or
a busy worker slot falls back to the supported uncompressed recording format.

## Protocol and failure behavior

The already sanitized rrweb events are JSON serialized and sent to the worker.
The worker uses its own UTF-8 encoder so supplementary Unicode characters
remain correct even without a native `TextEncoder`, then produces an independent
zlib stream for each events array. The
recording payload is the uncompressed ASCII `{"segment_id":N}\n` header followed
by those binary zlib bytes. The `replay_recording.length` is the exact sum in
bytes. Envelope metadata and all ordinary Sentry events stay uncompressed.
The transport receives `Uint8Array`; no direct upload or alternate network
path is introduced. A supporting mini-program SDK must preserve binary
envelopes in both online requests and offline persistence.

Messages use only JSON-safe primitives, including base64 for the compressed
reply. This also works on WeChat versions before typed-array worker messages
were added. Base64 exists only between threads: it is decoded before envelope
serialization and is not sent to Sentry. Every message carries a protocol
version and request ID. Unexpected, stale and mismatched replies are ignored.

Startup and each compression operation have separate two-second deadlines
(configurable `timeoutMs`, bounded to 50–10000ms). Exceptions, malformed output,
worker errors and process recycling terminate the worker and use raw JSON for
the remaining segments until an explicit lifecycle reset. Incompressible small
segments use raw JSON but keep a healthy worker. Reset, consent revocation,
stop and cleanup release the worker; late replies cannot revive old recordings.
Queued segments remain serialized and retries reuse the same prepared bytes.

`bridge.getSnapshot().delivery.compression` exposes `state`,
`compressedSegments`, `fallbackSegments`, `inputBytes` and `outputBytes`.
The byte totals cover events JSON, excluding the small segment header and
envelope metadata. Diagnostics contain no recorded values. `ready` plus a
positive compressed segment count proves local worker use; only real Sentry
Playback proves backend acceptance and rendering.

## Recording budgets and checkpoints

Compression lowers transfer and offline persistence size. It does not make the
in-memory recorder budget unlimited. The existing 512 KiB / 500-event recorder
budget, 30-second rolling error buffer, and separate 2 MiB / four-segment
pending queue defaults are unchanged. Queue byte accounting remains conservative
and uses the uncompressed capture, including an in-flight segment.

With the matching SDK, a session recorder calls `onBufferFull` synchronously
before a normal event would cross its current budget. The coordinator drains
that segment and the recorder retries the pending event. Existing observer,
node IDs and privacy state survive; one oversized event or checkpoint still
stops safely. Slow uploads continue to hit the bounded delivery queue rather
than growing memory indefinitely. Detached history and the current root share the recording budget. If the new
root or later increments exhaust that combined budget, older page history is
discarded as a whole while the current root retains its playable checkpoint.
Resource pressure can therefore shorten the previous-page error window.
Rolling error buffers still rebase and evict
older events locally and never upload just because they become full.

Error/feedback/manual buffer promotion uses `promoteToSession` when supported:
the prepared, playable buffer is queued once, then the same recorder continues
with increments. It does not immediately repeat the page snapshot, CSS or
Canvas frames. Older SDKs retain their recorder-replacement fallback.
Navigation and required privacy/viewport checkpoints remain full snapshots;
dropping these merely to save bytes would break rendering or masking.

Compiled CSS belongs to the host build. Only transformations proven to preserve
selector order, dynamic states, keyframes and media queries are safe. This
adapter does not remove selectors based on one observed DOM snapshot.

## Primary references

- [Sentry 10.66.0 streaming zlib compressor](https://github.com/getsentry/sentry-javascript/blob/10.66.0/packages/replay-worker/src/Compressor.ts)
- [Recording header preparation](https://github.com/getsentry/sentry-javascript/blob/10.66.0/packages/replay-internal/src/util/prepareRecordingData.ts)
- [Replay envelope binary length](https://github.com/getsentry/sentry-javascript/blob/10.66.0/packages/replay-internal/src/util/createReplayEnvelope.ts)
- [Official WeChat Worker API types](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)
