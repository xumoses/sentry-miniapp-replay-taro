import type { Event } from '@sentry/core';
import { describe, expect, test, vi } from 'vite-plus/test';

import { ReplayCoordinator } from '../src/coordinator/ReplayCoordinator';
import { makeRuntime, makeSdk } from './fixtures';

describe('ReplayCoordinator', () => {
  test('uses strict sampling boundaries', () => {
    const fixture = makeSdk();
    const random = vi.fn(() => 0.5);
    const coordinator = new ReplayCoordinator({
      sdk: fixture.sdk,
      client: fixture.sdk.getClient()!,
      replaysSessionSampleRate: 0.5,
      replaysOnErrorSampleRate: 0.5,
      random,
    });

    expect(coordinator.getSnapshot().state).toBe('disabled');
    expect(random).toHaveBeenCalledTimes(2);
  });

  test('makes one stable prioritized sampling decision', () => {
    const fixture = makeSdk();
    const random = vi.fn().mockReturnValueOnce(0.9).mockReturnValueOnce(0.2).mockReturnValue(0.1);
    const coordinator = new ReplayCoordinator({
      sdk: fixture.sdk,
      client: fixture.sdk.getClient()!,
      replaysSessionSampleRate: 0.5,
      replaysOnErrorSampleRate: 0.5,
      random,
    });

    expect(coordinator.getSnapshot().state).toBe('buffer');
    coordinator.attachRoot(makeRuntime());
    coordinator.detachRoot();
    coordinator.attachRoot(makeRuntime());
    expect(random).toHaveBeenCalledTimes(34);
    expect(coordinator.getSnapshot().replayId).toMatch(/^[0-9a-f]{32}$/);
  });

  test('disabled mode creates no observer, hook, or upload', () => {
    const fixture = makeSdk();
    const runtime = makeRuntime();
    const coordinator = new ReplayCoordinator({
      sdk: fixture.sdk,
      client: fixture.sdk.getClient()!,
      enabled: false,
      replaysSessionSampleRate: 1,
    });

    expect(coordinator.attachRoot(runtime)).toBe(false);
    expect(runtime.document.getElementById).not.toHaveBeenCalled();
    expect(fixture.sendEnvelope).not.toHaveBeenCalled();
  });

  test('buffer never uploads without an accepted error', async () => {
    const fixture = makeSdk();
    const coordinator = new ReplayCoordinator({
      sdk: fixture.sdk,
      client: fixture.sdk.getClient()!,
      replaysOnErrorSampleRate: 1,
      random: () => 0.5,
    });
    coordinator.attachRoot(makeRuntime());
    coordinator.detachRoot();
    await coordinator.flush();

    expect(coordinator.getSnapshot().state).toBe('buffer');
    expect(fixture.sendEnvelope).not.toHaveBeenCalled();
  });

  test('full-session root switches send ordered segments with one replay id', async () => {
    const fixture = makeSdk();
    const coordinator = new ReplayCoordinator({
      sdk: fixture.sdk,
      client: fixture.sdk.getClient()!,
      replaysSessionSampleRate: 1,
      random: () => 0.25,
    });
    coordinator.attachRoot(makeRuntime());
    const replayId = coordinator.getSnapshot().replayId;
    coordinator.detachRoot();
    await vi.waitFor(() => expect(fixture.sendEnvelope).toHaveBeenCalledTimes(1));
    coordinator.attachRoot(makeRuntime());
    coordinator.detachRoot();
    await vi.waitFor(() => expect(fixture.sendEnvelope).toHaveBeenCalledTimes(2));

    const first = fixture.sendEnvelope.mock.calls[0]![0] as any;
    const second = fixture.sendEnvelope.mock.calls[1]![0] as any;
    expect(first[1][0][1]).toMatchObject({ replay_id: replayId, segment_id: 0 });
    expect(second[1][0][1]).toMatchObject({ replay_id: replayId, segment_id: 1 });
    expect(coordinator.getSnapshot()).toMatchObject({
      state: 'session',
      replayId,
      sentReplayId: replayId,
    });
  });

  test('accepted exception promotes once and correlates both envelopes', async () => {
    const fixture = makeSdk();
    const coordinator = new ReplayCoordinator({
      sdk: fixture.sdk,
      client: fixture.sdk.getClient()!,
      replaysOnErrorSampleRate: 1,
      random: () => 0.25,
      now: () => 1_700_000_002_000,
    });
    coordinator.attachRoot(makeRuntime());
    const first: Event = {
      event_id: 'e'.repeat(32),
      exception: { values: [{ type: 'Error', value: 'boom' }] },
    };
    const second: Event = {
      event_id: 'f'.repeat(32),
      exception: { values: [{ type: 'Error', value: 'again' }] },
    };

    fixture.emitBeforeSend(first);
    fixture.emitBeforeSend(second);
    await vi.waitFor(() => expect(coordinator.getSnapshot().state).toBe('sent'));

    expect(first.contexts?.replay).toEqual({
      replay_id: coordinator.getSnapshot().replayId,
    });
    expect(second.contexts?.replay).toBeUndefined();
    expect(fixture.sendEnvelope).toHaveBeenCalledTimes(1);
    const envelope = fixture.sendEnvelope.mock.calls[0]![0] as any;
    expect(envelope[1][0][1]).toMatchObject({
      replay_id: coordinator.getSnapshot().replayId,
      replay_type: 'buffer',
      error_ids: ['e'.repeat(32)],
    });
    expect(coordinator.getSnapshot()).toMatchObject({
      sentReplayId: coordinator.getSnapshot().replayId,
      errorEventId: 'e'.repeat(32),
    });
  });

  test('non-error events cannot promote the buffer', () => {
    const fixture = makeSdk();
    const coordinator = new ReplayCoordinator({
      sdk: fixture.sdk,
      client: fixture.sdk.getClient()!,
      replaysOnErrorSampleRate: 1,
      random: () => 0.5,
    });
    coordinator.attachRoot(makeRuntime());
    fixture.emitBeforeSend({ event_id: 'a'.repeat(32), message: 'info' });

    expect(coordinator.getSnapshot().state).toBe('buffer');
    expect(fixture.sendEnvelope).not.toHaveBeenCalled();
  });

  test('native-only errors remain unassociated when no Taro root was recorded', () => {
    const fixture = makeSdk();
    const coordinator = new ReplayCoordinator({
      sdk: fixture.sdk,
      client: fixture.sdk.getClient()!,
      replaysOnErrorSampleRate: 1,
      random: () => 0.5,
    });
    const event: Event = {
      event_id: 'a'.repeat(32),
      exception: { values: [{ type: 'Error', value: 'native page' }] },
    };

    fixture.emitBeforeSend(event);

    expect(event.contexts?.replay).toBeUndefined();
    expect(coordinator.getSnapshot().state).toBe('buffer');
    expect(fixture.sendEnvelope).not.toHaveBeenCalled();
  });

  test('does not notify React subscribers for each recorded event', () => {
    const fixture = makeSdk();
    const coordinator = new ReplayCoordinator({
      sdk: fixture.sdk,
      client: fixture.sdk.getClient()!,
      replaysOnErrorSampleRate: 1,
      random: () => 0.5,
    });
    const snapshots: Array<{ eventCount: number; approximateBytes: number }> = [];
    coordinator.subscribe((snapshot) => snapshots.push(snapshot));
    coordinator.attachRoot(makeRuntime());
    const notificationsAfterAttach = snapshots.length;
    fixture.emitBreadcrumb({ category: 'ui', message: 'mutation' });

    expect(snapshots).toHaveLength(notificationsAfterAttach);
    expect(coordinator.getSnapshot()).toMatchObject({
      eventCount: 4,
      approximateBytes: expect.any(Number),
    });
  });

  test('compacts detached roots continuously and runtime kill switch tears down', () => {
    const fixture = makeSdk();
    let enabled = true;
    const coordinator = new ReplayCoordinator({
      sdk: fixture.sdk,
      client: fixture.sdk.getClient()!,
      enabled: () => enabled,
      replaysOnErrorSampleRate: 1,
      random: () => 0.5,
    });
    coordinator.attachRoot(makeRuntime());
    coordinator.detachRoot();
    coordinator.attachRoot(makeRuntime());
    coordinator.detachRoot();
    expect(coordinator.getSnapshot().eventCount).toBe(2);

    enabled = false;
    expect(coordinator.refreshEnabled()).toBe(false);
    expect(coordinator.getSnapshot()).toMatchObject({
      state: 'disabled',
      eventCount: 0,
      approximateBytes: 0,
    });
    expect(coordinator.attachRoot(makeRuntime())).toBe(false);
  });
});
