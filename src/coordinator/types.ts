import type { Event } from '@sentry/core';

import type {
  SentryMiniappReplaySdk,
  SentryReplayClient,
  TaroReplayLimitOptions,
  TaroReplayPrivacyOptions,
  TaroReplayRuntime,
} from '../types';

export type ReplayCoordinatorState =
  | 'disabled'
  | 'session'
  | 'buffer'
  | 'promoted'
  | 'sent'
  | 'error';

export interface ReplayCoordinatorSnapshot {
  state: ReplayCoordinatorState;
  replayId?: string;
  errorEventId?: string;
  sentReplayId?: string;
  eventCount: number;
  approximateBytes: number;
  error?: Error;
}

export interface ReplayCoordinatorOptions {
  sdk: SentryMiniappReplaySdk;
  client: SentryReplayClient;
  enabled?: boolean | (() => boolean);
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
  random?: () => number;
  now?: () => number;
  privacy?: TaroReplayPrivacyOptions;
  limits?: TaroReplayLimitOptions;
}

export interface TaroReplayBridge {
  attachRoot(runtime: TaroReplayRuntime): boolean;
  detachRoot(): void;
  flush(): Promise<void>;
  /** Re-evaluates a runtime kill switch and tears down immediately when disabled. */
  refreshEnabled(): boolean;
  getSnapshot(): ReplayCoordinatorSnapshot;
  subscribe(listener: (snapshot: ReplayCoordinatorSnapshot) => void): () => void;
}

export interface ReplayAwareEvent extends Event {
  event_id?: string;
}
