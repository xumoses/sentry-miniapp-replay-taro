import type { Integration } from '@sentry/core';

import type { SentryMiniappReplaySdk, SentryReplayClient } from '../types';
import { ReplayCoordinator } from './ReplayCoordinator';
import type {
  ReplayCoordinatorOptions,
  ReplayCoordinatorSnapshot,
  TaroReplayBridge,
} from './types';

export interface TaroReplayIntegrationOptions extends Omit<
  ReplayCoordinatorOptions,
  'client' | 'replaysSessionSampleRate' | 'replaysOnErrorSampleRate'
> {
  sdk: SentryMiniappReplaySdk;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
}

export interface TaroReplayIntegration extends Integration {
  readonly bridge: TaroReplayBridge;
}

export function taroReplayIntegration(
  options: TaroReplayIntegrationOptions,
): TaroReplayIntegration {
  let coordinator: ReplayCoordinator | undefined;
  const listeners = new Set<(snapshot: ReplayCoordinatorSnapshot) => void>();
  const coordinatorSubscriptions = new Map<
    (snapshot: ReplayCoordinatorSnapshot) => void,
    () => void
  >();
  const unavailable = (): ReplayCoordinatorSnapshot => ({
    state: 'disabled',
    eventCount: 0,
    approximateBytes: 0,
  });
  const bridge: TaroReplayBridge = {
    attachRoot: (runtime) => coordinator?.attachRoot(runtime) === true,
    detachRoot: () => coordinator?.detachRoot(),
    flush: () => coordinator?.flush() || Promise.resolve(),
    refreshEnabled: () => coordinator?.refreshEnabled() === true,
    getSnapshot: () => coordinator?.getSnapshot() || unavailable(),
    subscribe: (listener) => {
      listeners.add(listener);
      const detach = coordinator?.subscribe(listener);
      if (detach) coordinatorSubscriptions.set(listener, detach);
      if (!coordinator) listener(unavailable());
      return () => {
        listeners.delete(listener);
        coordinatorSubscriptions.get(listener)?.();
        coordinatorSubscriptions.delete(listener);
      };
    },
  };

  return {
    name: 'TaroReplay',
    bridge,
    setup(client) {
      const clientOptions = client.getOptions() as {
        replaysSessionSampleRate?: number;
        replaysOnErrorSampleRate?: number;
      };
      const sessionRate =
        options.replaysSessionSampleRate ?? clientOptions.replaysSessionSampleRate;
      const errorRate = options.replaysOnErrorSampleRate ?? clientOptions.replaysOnErrorSampleRate;
      coordinator = new ReplayCoordinator({
        ...options,
        client: client as SentryReplayClient,
        ...(sessionRate === undefined ? {} : { replaysSessionSampleRate: sessionRate }),
        ...(errorRate === undefined ? {} : { replaysOnErrorSampleRate: errorRate }),
      });
      for (const listener of listeners) {
        coordinatorSubscriptions.set(listener, coordinator.subscribe(listener));
      }
    },
  };
}
