import { type Mock, vi } from 'vitest';

import type {
  SentryMiniappReplaySdk,
  StartTaroReplayRecorderOptions,
  TaroReplayCapture,
  TaroReplayNodeLike,
  TaroReplayRecorderController,
  TaroReplayRuntime,
} from '../src/types';

export function makeCapture(overrides: Partial<TaroReplayCapture> = {}): TaroReplayCapture {
  return {
    marker: 'TARO_DOM_REPLAY_POC',
    version: 1,
    replayId: '123e4567-e89b-42d3-a456-426614174000',
    href: 'https://miniapp.local/pages/replay',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_001_000,
    stopReason: 'manual',
    events: [{ type: 4, timestamp: 1_700_000_000_000, data: { title: '你好' } }],
    metadata: {
      environment: 'test',
      release: 'demo@1.0.0',
      sdk: { name: 'sentry.javascript.miniapp', version: '1.13.1' },
      tags: { framework: 'taro' },
      contexts: { miniapp: { type: 'miniapp', platform: 'wechat' } },
    },
    stats: {
      eventCount: 1,
      mutationCount: 0,
      breadcrumbCount: 0,
      networkCount: 0,
      approximateBytes: 10,
    },
    warnings: [],
    ...overrides,
  };
}

export function makeRuntime(root: TaroReplayNodeLike | null = { nodeType: 1 }): TaroReplayRuntime {
  return {
    document: { getElementById: vi.fn(() => root) },
    MutationObserver: class {
      observe(): void {}
      disconnect(): void {}
    },
    getCurrentInstance: () => ({ router: { $taroPath: 'pages/replay?secret=yes' } }),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }),
    getEnv: () => 'WEAPP',
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop', version: '2.3.4' } }),
    getAppBaseInfo: () => ({ SDKVersion: '3.6.2' }),
  };
}

export function makeSdk(): {
  sdk: SentryMiniappReplaySdk;
  sendEnvelope: Mock;
  addRecordedBreadcrumb: Mock;
  emitBreadcrumb(breadcrumb: Parameters<TaroReplayRecorderController['addBreadcrumb']>[0]): void;
  getStartOptions(): StartTaroReplayRecorderOptions;
  getDetachCount(): number;
} {
  let startOptions: StartTaroReplayRecorderOptions | undefined;
  let breadcrumbHook:
    | ((breadcrumb: Parameters<TaroReplayRecorderController['addBreadcrumb']>[0]) => void)
    | undefined;
  let detachCount = 0;
  let capture = makeCapture({ endedAt: null, stopReason: null, events: [] });
  const sendEnvelope = vi.fn(() => Promise.resolve({ statusCode: 200 }));
  const addRecordedBreadcrumb = vi.fn(() => true);
  const controller: TaroReplayRecorderController = {
    addBreadcrumb: addRecordedBreadcrumb,
    getCapture: () => ({ ...capture, events: [...capture.events] }),
    stop: (reason = 'manual') => {
      if (!capture.stopReason) {
        capture = { ...capture, endedAt: capture.startedAt + 1_000, stopReason: reason };
        startOptions?.onStop?.(capture);
      }
      return { ...capture, events: [...capture.events] };
    },
  };
  const sdk: SentryMiniappReplaySdk = {
    SDK_NAME: 'sentry.javascript.miniapp',
    SDK_VERSION: '1.13.1',
    getClient: () => ({
      getDsn: () => ({ toString: () => 'https://public@example.test/1' }),
      getOptions: () => ({ environment: 'staging', release: 'app@2.3.4' }),
      on: (_hook, callback) => {
        breadcrumbHook = callback;
        return () => {
          detachCount++;
          breadcrumbHook = undefined;
        };
      },
      sendEnvelope,
    }),
    addBreadcrumb: (breadcrumb) => breadcrumbHook?.(breadcrumb),
    startTaroDomReplayPoc: (options) => {
      startOptions = options;
      capture = {
        ...capture,
        href: options.href || capture.href,
        ...(options.metadata ? { metadata: options.metadata } : {}),
      };
      return controller;
    },
  };

  return {
    sdk,
    sendEnvelope,
    addRecordedBreadcrumb,
    emitBreadcrumb: (breadcrumb) => breadcrumbHook?.(breadcrumb),
    getStartOptions: () => {
      if (!startOptions) throw new Error('Replay was not started');
      return startOptions;
    },
    getDetachCount: () => detachCount,
  };
}
