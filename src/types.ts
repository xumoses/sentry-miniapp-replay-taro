import type { Breadcrumb, ReplayEnvelope, SdkInfo } from '@sentry/core';

export interface TaroReplayEvent {
  type: number;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface TaroReplayMetadata {
  environment?: string;
  release?: string;
  sdk?: SdkInfo;
  user?: Record<string, unknown>;
  tags?: Record<string, string | number | boolean>;
  contexts?: Record<string, Record<string, unknown>>;
}

export interface TaroReplayCapture {
  marker: string;
  version: number;
  replayId: string;
  href: string;
  startedAt: number;
  endedAt: number | null;
  stopReason: string | null;
  events: TaroReplayEvent[];
  metadata?: TaroReplayMetadata;
  stats: {
    eventCount: number;
    mutationCount: number;
    breadcrumbCount: number;
    networkCount: number;
    approximateBytes: number;
  };
  warnings: string[];
}

export interface TaroReplayRecorderController {
  addBreadcrumb(breadcrumb: Breadcrumb): boolean;
  getCapture(): TaroReplayCapture;
  stop(reason?: string): TaroReplayCapture;
}

export interface StartTaroReplayRecorderOptions {
  root: unknown;
  MutationObserver: new (callback: (records: unknown[]) => void) => {
    observe(target: unknown, options: Record<string, boolean>): void;
    disconnect(): void;
  };
  href?: string;
  width?: number;
  height?: number;
  maskAllText?: boolean;
  maskInputValues?: boolean;
  maxDurationMs?: number;
  maxEvents?: number;
  maxBytes?: number;
  metadata?: TaroReplayMetadata;
  onStop?: (capture: TaroReplayCapture) => void;
}

export interface SentryReplayClient {
  getDsn?(): { toString(): string } | undefined;
  getOptions?(): {
    environment?: string;
    release?: string;
  };
  on?(
    hook: 'beforeAddBreadcrumb',
    callback: (breadcrumb: Breadcrumb) => void,
  ): (() => void) | undefined;
  sendEnvelope(envelope: ReplayEnvelope): PromiseLike<unknown>;
}

/** Structural interface accepted from either sentry-miniapp or @xumoses/sentry-miniapp. */
export interface SentryMiniappReplaySdk {
  SDK_NAME?: string;
  SDK_VERSION?: string;
  getClient(): SentryReplayClient | undefined;
  addBreadcrumb?(breadcrumb: Breadcrumb): void;
  startTaroDomReplayPoc(options: StartTaroReplayRecorderOptions): TaroReplayRecorderController;
}

export interface TaroReplayRuntime {
  document: { getElementById(id: string): unknown | null };
  MutationObserver: StartTaroReplayRecorderOptions['MutationObserver'];
  getCurrentInstance(): {
    router?: {
      $taroPath?: string;
      path?: string;
    };
  };
  getWindowInfo?(): {
    windowWidth?: number;
    windowHeight?: number;
  };
  getEnv?(): string;
  getAccountInfoSync?(): {
    miniProgram?: {
      envVersion?: string;
      version?: string;
    };
  };
  getAppBaseInfo?(): {
    SDKVersion?: string;
  };
}

export interface TaroReplayContext {
  route: string;
  href: string;
  platform: string;
  environment?: string;
  release?: string;
}

export interface TaroReplayPrivacyOptions {
  /** Default true. Disable only when every visible string is known synthetic data. */
  maskAllText?: boolean;
  /** Default true. */
  maskInputValues?: boolean;
  /** Default false. Custom metadata.user is discarded unless explicitly enabled. */
  allowUser?: boolean;
}

export interface TaroReplayLimitOptions {
  maxDurationMs?: number;
  maxEvents?: number;
  maxBytes?: number;
}

export interface CreateTaroReplayOptions {
  sdk: SentryMiniappReplaySdk;
  runtime: TaroReplayRuntime;
  privacy?: TaroReplayPrivacyOptions;
  limits?: TaroReplayLimitOptions;
  captureBreadcrumbs?: boolean;
  sendOnManualStop?: boolean;
  sendOnDurationStop?: boolean;
  sendOnDispose?: boolean;
  frameworkVersion?: string;
  href?: (route: string) => string;
  getMetadata?: (context: TaroReplayContext) => TaroReplayMetadata | undefined;
  onCapture?: (capture: TaroReplayCapture) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export interface TaroReplayControllerView {
  readonly replayId: string;
  getCapture(): TaroReplayCapture;
}

export interface TaroReplayHandle {
  start(): boolean;
  stop(reason?: string): Promise<TaroReplayCapture | undefined>;
  getController(): TaroReplayControllerView | undefined;
  dispose(): void;
}

export type TaroReplayState = 'idle' | 'recording' | 'stopped';

export type UseTaroReplayOptions = Omit<CreateTaroReplayOptions, 'runtime'>;

export interface UseTaroReplayResult extends TaroReplayHandle {
  readonly state: TaroReplayState;
  readonly error: Error | undefined;
}
