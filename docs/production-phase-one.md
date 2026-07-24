# Taro Replay production phase one

## Public interface

The native mini-program entry owns the only Sentry client:

```ts
Sentry.init({
  sampleRate: 1,
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1,
  integrations: [
    taroReplayIntegration({
      sdk: Sentry,
      enabled: () => runtimeKillSwitch(),
    }),
  ],
});
```

The integration publishes a minimal `TaroReplayBridge`. Taro code imports no
`@xumoses/sentry-miniapp` runtime and only attaches its mounted root:

```ts
useTaroReplayRoot({ bridge: getNativeTaroReplayBridge() });
```

## Logical-session state machine

`disabled` has no recorder, observer, timers, or envelopes. Otherwise one
sampling decision is made when the coordinator is constructed:

1. draw once for `replaysSessionSampleRate`;
2. when that misses, draw once for `replaysOnErrorSampleRate`;
3. enter `session`, `buffer`, or `disabled`.

`session` sends bounded segments normally. `buffer` maintains a rolling
time/event/byte bounded recording and sends nothing until a final error event
reaches the SDK client's `beforeSendEvent` hook. Promotion adds `replay_id` to
that error before its envelope is created, freezes a playable buffer, adds the
error event id to Replay `error_ids`, and sends that Replay exactly once.
Events rejected by event processors, `beforeSend`, or `sampleRate` never reach
the hook and therefore never promote.

After navigation the coordinator and replay id survive; only the root recorder
is detached and a new root is attached. Phase one exercises this on ReplayPoc.
Native pages contribute errors and breadcrumbs only and have no visual root.

## Invariants

- one Sentry client and one `Sentry.init`, both owned by native `app.js`;
- error sampling is independent and remains `sampleRate: 1` in production;
- buffer mode never uploads without an accepted error;
- buffer eviction preserves a full snapshot/checkpoint and rolls by age,
  event count, and UTF-8 bytes;
- error/replay association is bidirectional (`replay_id` / `error_ids`) and
  concurrent errors finalize once;
- defaults mask all text and inputs, remove URL query/fragment and credentials,
  exclude bodies/headers, and omit `metadata.user`;
- the kill switch is checked before attaching any observer;
- `@sentry/core` is type/test-only in the adapter and absent from runtime output.
