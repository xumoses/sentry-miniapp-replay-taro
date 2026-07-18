# @xumoses/sentry-miniapp-replay-taro

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
- one Replay segment sent after a manual stop or duration limit;
- an injected SDK namespace from either the community `sentry-miniapp` package
  or the internally renamed `@xumoses/sentry-miniapp` package.

It does not currently support native Mini Program DOM, Vue/uni-app, mini games,
Canvas, WebView, nodes inside native components, continuous multi-page
sessions, multiple segments, pre-error buffering, full offline rrweb playback,
or every event type offered by browser Session Replay. Other Mini Program
platforms and Taro versions have not been systematically validated.

## Installation

```sh
pnpm add @xumoses/sentry-miniapp-replay-taro@beta
```

The host application must also install Taro, React, `@sentry/core`, and one of
these SDK namespaces:

```sh
pnpm add sentry-miniapp
# or
pnpm add @xumoses/sentry-miniapp@beta
```

## React usage

Initialize the SDK as usual, then inject its complete namespace into the hook.
The adapter does not hard-code the host package name, so the same integration
works with the community and renamed packages.

```tsx
import { Button, View } from '@tarojs/components';
import * as Sentry from 'sentry-miniapp';
import { useTaroReplay } from '@xumoses/sentry-miniapp-replay-taro/react';

export default function CheckoutPage() {
  const replay = useTaroReplay({
    sdk: Sentry,
    limits: { maxDurationMs: 30_000 },
  });

  return (
    <View>
      <Button onClick={() => void replay.stop('manual')}>
        Stop and send Replay
      </Button>
    </View>
  );
}
```

The hook starts after Taro's `useReady` by resolving the current `$taroPath`
page root. It disposes observers during `useUnload`. A missing page root is a
safe no-op and does not prevent the page from running.

For a non-React integration, import `createTaroReplay` from the main entry point
and provide an explicit Taro runtime adapter. The main entry does not statically
depend on `@tarojs/taro` or `@tarojs/runtime`.

## Privacy defaults

The defaults minimize captured data:

- `maskAllText: true` masks all visible text;
- `maskInputValues: true` keeps input values out of the capture;
- `allowUser: false` discards user data from custom metadata;
- sensitive breadcrumb fields are filtered, while URL query strings, fragments,
  and userinfo are removed;
- duration, event-count, and byte-size limits bound every recording.

Only set `privacy.maskAllText: false` when every value rendered by the page is
known synthetic test data. Do not copy that option into a real user flow.

## Transport path

Production delivery uses the current Sentry client's `Client.sendEnvelope()`.
It therefore follows the host SDK's transport, rate limiting, offline queue,
and user-consent path. The adapter does not parse the DSN or send a side-channel
`fetch` request from the Mini Program directly to Sentry.

Manual stops and duration limits send by default. Page unload stops and cleans
up the recorder without starting an asynchronous network request by default.
These choices can be adjusted with `sendOnManualStop`, `sendOnDurationStop`, and
`sendOnDispose`; validate lifecycle behavior on the target platform before
enabling unload delivery.

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
