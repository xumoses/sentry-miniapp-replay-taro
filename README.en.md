# @xumoses/sentry-miniapp-replay-taro

The process-wide `ReplayCoordinator` samples sessions once and keeps an error
buffer whenever the error rate is positive. Each accepted error is sampled
independently; a miss keeps buffering. Visible Taro pages share a Replay ID,
with bounded five-second session segments and a rolling 30-second error buffer.
See [the capability matrix](./docs/official-alignment.md) and
[lifecycle contract](./docs/production-phase-one.md).

An experimental Taro React Session Replay adapter for `sentry-miniapp`. It
captures snapshots and mutations from Taro's virtual DOM and turns the capture
into a Sentry Replay envelope.

> **Experimental:** this is a `0.x` validation release. Its event format, API,
> and compatibility boundaries may change. It is not equivalent to Sentry's
> browser Replay integration.

[中文](./README.md)

## Validated scope

- Taro `4.2.x`, React 18, and the WeChat Mini Program developer tools;
- an initial snapshot, DOM mutations, and Sentry breadcrumbs for one Taro page
  root;
- continuous multi-page sessions, incremental segments, error buffering, accepted
  error/transaction correlation, and explicit feedback Replay inclusion;
- an injected SDK namespace from either the community `sentry-miniapp` package
  or the scoped fork `@xumoses/sentry-miniapp` package.

It does not currently support native Mini Program DOM, Vue/uni-app, mini games,
automatic Canvas recording, WebView, nodes inside native components, full offline rrweb playback,
or every event type offered by browser Session Replay. Other Mini Program
platforms and Taro versions have not been systematically validated.

## Installation

```sh
pnpm add @xumoses/sentry-miniapp-replay-taro@beta
```

The native host installs one supported SDK namespace and initializes it once.
Taro pages receive its Replay bridge; they must not initialize another client.
The adapter uses `@sentry/core` only for development types and tests.

```sh
pnpm add @xumoses/sentry-miniapp@beta
```

## React usage

Initialize the integration in the native host, then expose `replay.bridge`:

```ts
import * as Sentry from '@xumoses/sentry-miniapp';
import { taroReplayIntegration } from '@xumoses/sentry-miniapp-replay-taro';
const replay = taroReplayIntegration({ sdk: Sentry });
Sentry.init({
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1,
  integrations: [...Sentry.getDefaultIntegrations(), replay],
});
```

For individual page integration, use the bridge-only `useTaroReplayRoot` from
`@xumoses/sentry-miniapp-replay-taro/react/root`. Install either the global
lifecycle adapter or page hooks, not both. The older `useTaroReplay` hook is a
one-shot capture tool; it stops on hide/unload and does not resume a session.

For app-wide coverage, install the lifecycle adapter once from
`@xumoses/sentry-miniapp-replay-taro/taro/lifecycle`. It attaches every Taro
page on ready/show and detaches on hide/unload, so native pages and background
time are not recorded. Lifecycle failures are swallowed and never alter page
navigation.

Pass the host's `getReplayStyles` function when installing the lifecycle adapter:

```ts
import { installTaroReplayPageLifecycle } from '@xumoses/sentry-miniapp-replay-taro/taro/lifecycle';
import { getReplayStyles } from './replayStyles.generated';
import { getReplayImageSources } from './replayImages.generated';

installTaroReplayPageLifecycle({
  bridge: getNativeTaroReplayBridge(),
  getReplayStyles,
  getReplayImageSources,
});
```

The host build owns `replayStyles.generated`. Taro's virtual DOM contains nodes,
classes, and inline styles, but no compiled WXSS. After styles are compiled, the
host must resolve shared and page WXSS imports in their original order and map
selectors to the recorder's serialized HTML tags. `getReplayStyles(route)`
receives the page route without query strings or fragments and returns that
browser CSS. The adapter forwards it as `stylesheet` to an SDK that supports
stylesheet injection. That SDK embeds it in full snapshots and converts `rpx`
using the recorded viewport width. The local candidate introducing this support
is `@xumoses/sentry-miniapp@1.13.1-beta.5`; older SDKs ignore the option.

This release also accepts optional `getReplayImageSources(route)` for trusted
static images referenced by that route. Image recording requires
`@xumoses/sentry-miniapp@1.13.1-beta.6`. The host build owns
`replayImages.generated`: exact static resource paths map to size-bounded
PNG/JPEG/GIF/WebP data URIs, forwarded as `staticImageSources` to the SDK. The candidate SDK additionally supports strictly audited static SVG; enable it
only with the matching SDK release. Exclude remote URLs, runtime user images
and unaudited SVG. The map does not permit arbitrary data
URIs or change privacy masking. A missing or throwing getter is a safe no-op;
local mini-program image paths may remain unavailable in browser playback.

Missing styles, an `undefined` result, or a throwing getter leave structural
recording available, while external styling cannot be reproduced. Native
component internals, platform default controls, and fonts still need comparison
in Sentry and on target devices.

The page hook starts after Taro's `useReady`, resumes on `useDidShow`, and
records only the current `$taroPath` root. It disposes observers during
`useDidHide` and `useUnload`. A missing page root is a safe no-op and does not
prevent the page from running.

For a non-React integration, import `createTaroReplay` from the main entry point
and provide an explicit Taro runtime adapter. The main entry does not statically
depend on `@tarojs/taro` or `@tarojs/runtime`.
Explicit runtime adapters may provide the same optional `getReplayStyles(route)`
and `getReplayImageSources(route)` functions for compiled CSS and trusted static
images.

## Privacy defaults

The defaults minimize captured data:

- `maskAllText: true` masks all visible text;
- `maskAllInputs` (or legacy `maskInputValues`) defaults to masking input values;
- `blockAllMedia: true` blocks media; explicitly trusted static images remain a
  bounded exception;
- `maskAttributes` replaces the default title/placeholder/aria-label list; include
  these names explicitly when adding custom masked attributes;
- `allowUser: false` discards user data from custom metadata;
- sensitive breadcrumb fields are filtered, while URL query strings, fragments,
  and userinfo are removed;
- duration, event-count, and byte-size limits bound every recording.

Only set `privacy.maskAllText: false` when every value rendered by the page is
known synthetic test data. Do not copy that option into a real user flow.

Replay waits for the supporting client's cached `getRuntimeContexts()` before
sending, sharing technical device, OS, browser, app, runtime and miniapp host
defaults with error events. Recording still starts synchronously. In developer
tools, the SDK bounds the Client Hints wait to 200ms; emulated phone data belongs
to `miniapp_simulator`, never the host OS. Missing trustworthy details remain
unknown or name-only. Normal devices continue to use miniapp platform APIs.

Explicit `getMetadata().contexts` fields override matching defaults. Replay never
inherits scope users or arbitrary scope contexts. SDK `enableSystemInfo: false`
also disables Replay system metadata collection; viewport dimensions required for
recording remain available. Older SDKs without the shared provider use a
conservative platform fallback and report an unknown host OS in developer tools.
Explicit custom metadata remains subject to the existing privacy filters.

## Optional Replay network headers

Request and response headers are off by default. A supporting SDK is required.
Pass the same four options to SDK initialization and `taroReplayIntegration`
(or `createTaroReplay`):

```ts
const networkDetails = {
  networkDetailAllowUrls: [/^https:\/\/api\.example\.com\/v1(?:\/|$)/],
  networkDetailDenyUrls: [/\/private(?:\/|$)/],
  networkRequestHeaders: ['x-request-id'],
  networkResponseHeaders: ['x-request-id'],
};

Sentry.init({
  dsn: 'https://public@example.com/1',
  ...networkDetails,
  integrations: [taroReplayIntegration({ sdk: Sentry, ...networkDetails })],
});
```

- Rules match URLs after removing userinfo, query and fragment. Only origin/path
  conditions apply; query/fragment conditions are unsupported. Strings use substring
  matching, so prefer a regular expression anchored to the complete trusted origin.
  Deny rules win; an empty allowlist records no headers. Caller RegExp state is unchanged.
- Allowed URLs include `content-type`, `content-length` and `accept` by default.
  Request/response lists add names for that direction, matched case-insensitively
  without wildcards. Authentication, cookie, token, password and secret header names
  are always excluded, even when explicitly listed. Audit custom names and values
  before allowing them: a name allowlist cannot identify secrets in arbitrary values.
- Each direction permits at most 20 headers, 128 ASCII characters per name,
  1024 UTF-8 bytes per value and 4096 UTF-8 bytes for names plus values in total.
  Oversized entries are skipped rather than truncated. Bodies remain unrecorded.
- Configuration is copied when each entry point is created. Caller array/RegExp
  changes cannot widen it later, including recorder replacement, buffer rollover
  and error promotion. Recreate the integration to change policy.
- The supporting SDK delivers headers through a temporary breadcrumb hint for Replay,
  without adding them to ordinary error breadcrumbs. The adapter does not mutate the
  breadcrumb or hint. Manually supplied `data.request_headers`/`data.response_headers`
  are filtered again; generic `headers`, nested sensitive data and bodies stay filtered.

Older SDKs may ignore the options. After publishing compatible versions, verify
Replay network details, error breadcrumbs and privacy on the target device separately.

## Transport path

Production delivery uses the current Sentry client's `Client.sendEnvelope()`.
It therefore follows the host SDK's transport, rate limiting, offline queue,
and user-consent path. The adapter does not parse the DSN or send a side-channel
`fetch` request from the Mini Program directly to Sentry.

A regular `flush()` does nothing in buffer mode. A sampled accepted exception,
explicit `sendBufferedReplay()`, or feedback with `includeReplay: true` promotes
a playable buffer. Feedback uses `contexts.feedback.replay_id` and is never
counted in `error_ids`. Transactions contribute `trace_ids`/`segment_names` and
carry Replay context plus `tags.replayId` during session recording.

Call `bridge.reset()` before clearing authentication state: it discards current
capture and waits for the next visible page attach. `stop()` stops explicitly;
`start()` and `startBuffering()` start manually. `destroy()` and integration
`cleanup()` release hooks, observers and timers. Call `refreshEnabled()` when a
runtime kill switch changes.

Delivery is bounded to four segments / 2 MiB by default. Thrown send failures
retry twice; explicit HTTP failures do not retry. `getSnapshot().delivery`
distinguishes accepted 2xx from an unconfirmed SDK handoff, rejection and
cancellation. `recording` reflects the live recorder, including resource-limit
pauses. Already handed-off network/offline requests cannot be retracted.

## Local capture viewer

The published package includes a development-only, in-memory capture viewer:

```sh
pnpm dlx --package=@xumoses/sentry-miniapp-replay-taro@beta sentry-miniapp-replay-taro-viewer
# open http://127.0.0.1:4178
```

Select or paste a recorder capture JSON to inspect its summary, events, and raw
payload. The server listens only on `127.0.0.1`, writes nothing to disk, and
limits both each upload and total in-memory storage. It is not a production
ingestion service and must not be exposed through a LAN or public proxy. It is
an inspection tool rather than a promise of complete visual playback. See
[`examples/taro-react`](./examples/taro-react/README.md) for an integration
example.

## Versioning

This package currently publishes only the `beta` dist-tag and uses
`x.y.z-beta.N` versions; it never publishes `latest` or a stable version.
Before `1.0.0`, minor releases may change the API or envelope structure.
Re-test privacy masking, page lifecycle behavior, payload size, and Sentry
ingestion in the WeChat developer tools and on target devices after upgrading.

## License

[MIT](./LICENSE)

## Explicit Canvas pixel bridge

With a supporting SDK, opt in using `taroReplayIntegration({ sdk, recordCanvas: true })`.
The default is off. Give the target Taro Canvas or its containing View a unique `id`
and `data-sentry-canvas={true}`. After drawing, call
`bridge.recordCanvas?.(id, () => readPngOrJpegDataUri())` with a host-supplied synchronous
reader returning a PNG/JPEG data URI or `undefined`. Do not export pixels before calling
the bridge: it must first check the visible recording root.

Hidden, stopped, reset, disabled, stale-root and older-SDK calls return false without
reading pixels. The SDK separately enforces explicit masking/blocking, one-second rate
limits and byte budgets. The existing `bridge.subscribe` reports recording after each
root attach or recorder restart, so the host can capture a chart that was already drawn.
Retry on every recording notification even when the Replay ID is unchanged, and throttle
duplicate notifications in the host. Successful frame capture does not emit another
subscription notification.

Pixels cannot be automatically redacted. Text/input masking does not change text inside
an image; mark only charts whose complete rendered content is approved for capture.
Ordinary image and CSS URL filtering stays enabled, without changing `blockAllMedia`.
This is explicit frame capture, not drawing-command instrumentation, continuous video,
or access to native component DOM.
