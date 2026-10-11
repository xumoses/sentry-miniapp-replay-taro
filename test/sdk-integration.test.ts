import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { ReplayCoordinator } from '../src/coordinator/ReplayCoordinator';
import { makeRuntime, makeSdk } from './fixtures';
import type {
  SentryMiniappReplaySdk,
  TaroReplayMutationRecordLike,
  TaroReplayRecorderController,
} from '../src/types';

// Opt-in candidate contract: no sibling path or unpublished version is baked into the package.
const sdkSource = process.env['TARO_REPLAY_SDK_SOURCE'];
const settle = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};
const error = () => ({
  event_id: 'e'.repeat(32),
  exception: { values: [{ type: 'Error', value: 'synthetic candidate test' }] },
});
async function candidate() {
  const { startTaroDomReplayPoc } = (await import(/* @vite-ignore */ sdkSource!)) as Pick<
    SentryMiniappReplaySdk,
    'startTaroDomReplayPoc'
  >;
  const f = makeSdk();
  let active = 0;
  const observers: Array<{
    connected: boolean;
    callback(records: TaroReplayMutationRecordLike[]): void;
  }> = [];
  const controllers: TaroReplayRecorderController[] = [];
  const root = {
    nodeType: 1,
    nodeName: 'view',
    childNodes: [],
    attributes: [] as Array<{ name: string; value: string }>,
  };
  const runtime = makeRuntime(root);
  runtime.MutationObserver = class {
    connected = false;
    constructor(readonly callback: (records: TaroReplayMutationRecordLike[]) => void) {
      observers.push(this);
    }
    observe() {
      this.connected = true;
      active++;
    }
    disconnect() {
      if (this.connected) active--;
      this.connected = false;
    }
  };
  f.sdk.startTaroDomReplayPoc = (options) => {
    const controller = startTaroDomReplayPoc(options);
    controllers.push(controller);
    return controller;
  };
  return {
    ...f,
    controllers,
    runtime,
    active: () => active,
    mutate: (count = 1) => {
      root.attributes.push({ name: 'class', value: 'changed-after-timeout' });
      for (const observer of observers)
        if (observer.connected)
          observer.callback(
            Array.from({ length: count }, () => ({
              type: 'attributes',
              target: root,
              attributeName: 'class',
            })),
          );
    },
  };
}
afterEach(() => vi.useRealTimers());
describe.skipIf(!sdkSource)('candidate SDK and adapter local contract', () => {
  test('captures mutations after the old five-minute buffer deadline', async () => {
    vi.useFakeTimers();
    const f = await candidate();
    const c = new ReplayCoordinator({
      sdk: f.sdk,
      client: f.sdk.getClient()!,
      replaysOnErrorSampleRate: 1,
    });
    c.attachRoot(f.runtime);
    await vi.advanceTimersByTimeAsync(360_000);
    expect(f.active()).toBe(1);
    expect(f.controllers).toHaveLength(2);
    f.mutate();
    f.emitBeforeSend(error());
    await settle();
    expect(JSON.stringify(f.sendEnvelope.mock.calls[0]![0])).toContain('changed-after-timeout');
    expect(f.active()).toBe(1);
    c.destroy();
    expect(f.active()).toBe(0);
  });
  test('drains incremental segments while preserving one observer and replay start time', async () => {
    vi.useFakeTimers();
    const f = await candidate();
    const c = new ReplayCoordinator({
      sdk: f.sdk,
      client: f.sdk.getClient()!,
      replaysSessionSampleRate: 1,
    });
    c.attachRoot(f.runtime);
    await c.flush();
    await vi.advanceTimersByTimeAsync(100);
    f.mutate();
    await c.flush();
    expect(f.active()).toBe(1);
    expect(f.controllers).toHaveLength(1);
    const envelopes = f.sendEnvelope.mock.calls.map((call) => call[0]);
    expect(envelopes).toHaveLength(2);
    const events = JSON.parse(envelopes[1][1][1][1].split('\n')[1]);
    expect(events.some((event: { type: number }) => event.type === 2)).toBe(false);
    expect(JSON.stringify(events)).toContain('changed-after-timeout');
    expect(envelopes[0][1][0][1].replay_start_timestamp).toBe(
      envelopes[1][1][0][1].replay_start_timestamp,
    );
    c.destroy();
    expect(f.active()).toBe(0);
  });
  test('duration rollover cannot resurrect a recorder after a pending send and navigation', async () => {
    vi.useFakeTimers();
    const f = await candidate();
    const c = new ReplayCoordinator({
      sdk: f.sdk,
      client: f.sdk.getClient()!,
      replaysOnErrorSampleRate: 1,
      flushIntervalMs: 600_000,
    });
    c.attachRoot(f.runtime);
    f.emitBeforeSend(error());
    await settle();
    let finish!: (value: unknown) => void;
    f.sendEnvelope.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(300_000);
    c.detachRoot();
    c.attachRoot(f.runtime);
    expect(f.active()).toBe(1);
    finish({ statusCode: 200 });
    await settle();
    expect(f.active()).toBe(1);
    c.detachRoot();
    expect(f.active()).toBe(0);
    c.destroy();
  });
  test('forwards document scroll and viewport changes into rrweb events', async () => {
    vi.useFakeTimers();
    const f = await candidate();
    const c = new ReplayCoordinator({
      sdk: f.sdk,
      client: f.sdk.getClient()!,
      replaysSessionSampleRate: 1,
    });
    c.attachRoot(f.runtime);
    c.recordPageScroll({ scrollTop: 240 });
    c.recordViewport({ width: 844, height: 390 });
    await c.flush();
    const events = JSON.parse(f.sendEnvelope.mock.calls[0]![0][1][1][1].split('\n')[1]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 3,
          data: expect.objectContaining({ source: 3, id: 1, y: 240 }),
        }),
        expect.objectContaining({
          type: 3,
          data: expect.objectContaining({ source: 4, width: 844, height: 390 }),
        }),
      ]),
    );
    c.destroy();
  });
  test.each(['session', 'buffer'] as const)(
    'mutation limit pauses %s truthfully until another visible attach',
    async (mode) => {
      vi.useFakeTimers();
      const f = await candidate();
      const c = new ReplayCoordinator({
        sdk: f.sdk,
        client: f.sdk.getClient()!,
        ...(mode === 'session' ? { replaysSessionSampleRate: 1 } : { replaysOnErrorSampleRate: 1 }),
        limits: { mutationLimit: 1 },
      });
      c.attachRoot(f.runtime);
      f.mutate(2);
      await settle();
      expect(c.getSnapshot()).toMatchObject({ state: mode, recording: false });
      expect(c.getSnapshot().error?.message).toContain('mutation limit');
      expect(f.active()).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(f.controllers).toHaveLength(1);
      expect(f.sendEnvelope.mock.calls).toHaveLength(mode === 'session' ? 1 : 0);
      c.attachRoot(f.runtime);
      expect(c.getSnapshot().recording).toBe(true);
      expect(f.active()).toBe(1);
      c.destroy();
    },
  );
  test('accepted error after an empty session drain produces an associated next segment', async () => {
    vi.useFakeTimers();
    const f = await candidate();
    const c = new ReplayCoordinator({
      sdk: f.sdk,
      client: f.sdk.getClient()!,
      replaysSessionSampleRate: 1,
    });
    c.attachRoot(f.runtime);
    await c.flush();
    expect(f.controllers[0]?.getCapture().events).toHaveLength(0);
    f.emitBeforeSend(error());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.sendEnvelope.mock.calls).toHaveLength(2);
    const second = f.sendEnvelope.mock.calls[1]![0];
    expect(second[1][0][1].error_ids).toEqual(['e'.repeat(32)]);
    expect(second[1][1][1]).toContain('sentry.error');
    expect(f.active()).toBe(1);
    c.destroy();
  });
});
