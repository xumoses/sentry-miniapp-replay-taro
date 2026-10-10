import { createTaroReplay } from '../createTaroReplay';
import { sendReplayCapture, utf8ByteLength } from '../envelope';
import type {
  TaroReplayCapture,
  TaroReplayHandle,
  TaroReplayLimitOptions,
  TaroReplayRuntime,
} from '../types';
import { boundReplayEvents } from './buffer';
import type {
  ReplayAwareEvent,
  ReplayCoordinatorOptions,
  ReplayCoordinatorSnapshot,
  ReplayCoordinatorState,
  TaroReplayBridge,
} from './types';

const DEFAULT_LIMITS = {
  maxDurationMs: 5 * 60_000,
  maxEvents: 500,
  maxBytes: 512 * 1024,
  rollingWindowMs: 30_000,
};

function clampRate(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value || 0));
}

function sampled(rate: number, random: () => number): boolean {
  return rate > 0 && (rate >= 1 || random() < rate);
}

function replayId(random: () => number): string {
  let value = '';
  for (let index = 0; index < 32; index++) value += Math.floor(random() * 16).toString(16);
  return value;
}

function isErrorEvent(event: ReplayAwareEvent): boolean {
  return Boolean(event.exception?.values?.length);
}

function errorValue(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export class ReplayCoordinator implements TaroReplayBridge {
  readonly #options: ReplayCoordinatorOptions;
  readonly #listeners = new Set<(snapshot: ReplayCoordinatorSnapshot) => void>();
  readonly #random: () => number;
  #replayId?: string;
  #errorMode = false;
  #state: ReplayCoordinatorState;
  #handle: TaroReplayHandle | undefined;
  #rootRuntime: TaroReplayRuntime | undefined;
  #captures: TaroReplayCapture[] = [];
  #finalization: Promise<void> | undefined;
  #pendingErrorIds: string[] = [];
  #errorEventId: string | undefined;
  #sentReplayId: string | undefined;
  #error: Error | undefined;
  #detachErrorHook: (() => void) | undefined;
  #segmentId = 0;

  constructor(options: ReplayCoordinatorOptions) {
    this.#options = options;
    const enabled =
      typeof options.enabled === 'function' ? options.enabled() : options.enabled !== false;
    const random = options.random || Math.random;
    this.#random = random;
    if (!enabled) {
      this.#state = 'disabled';
      return;
    }
    if (sampled(clampRate(options.replaysSessionSampleRate), random)) {
      this.#state = 'session';
    } else if (sampled(clampRate(options.replaysOnErrorSampleRate), random)) {
      this.#state = 'buffer';
      this.#errorMode = true;
    } else {
      this.#state = 'disabled';
      return;
    }
    this.#replayId = replayId(random);
    this.#detachErrorHook = options.client.on?.('beforeSendEvent', (event) => {
      this.#beforeSendEvent(event);
    });
  }

  attachRoot(runtime: TaroReplayRuntime): boolean {
    if (!this.refreshEnabled()) return false;
    if (this.#state === 'disabled' || this.#state === 'sent' || this.#state === 'error') {
      return false;
    }
    this.detachRoot();
    this.#rootRuntime = runtime;
    if (this.#state === 'promoted') return true;
    return this.#startRoot(runtime);
  }

  #startRoot(runtime: TaroReplayRuntime): boolean {
    try {
      this.#handle = createTaroReplay({
        sdk: this.#options.sdk,
        runtime,
        ...(this.#replayId ? { replayId: this.#replayId } : {}),
        ...(this.#options.privacy ? { privacy: this.#options.privacy } : {}),
        limits: this.#recordingLimits(),
        sendOnManualStop: false,
        sendOnDurationStop: false,
        sendOnDispose: false,
        onCapture: (capture) => this.#onCapture(capture),
        onError: (cause) => this.#fail(cause),
      });
      const attached = this.#handle.start();
      this.#notify();
      return attached;
    } catch (cause) {
      this.#fail(cause);
      return false;
    }
  }

  #recordingLimits(): TaroReplayLimitOptions {
    const limits = { ...DEFAULT_LIMITS, ...this.#options.limits };
    if (this.#state === 'buffer') return limits;
    const { rollingWindowMs: _rollingWindowMs, ...sessionLimits } = limits;
    return sessionLimits;
  }

  detachRoot(): void {
    this.#rootRuntime = undefined;
    const handle = this.#handle;
    if (!handle) return;
    this.#handle = undefined;
    const capture = handle.getController()?.getCapture();
    if (this.#state === 'session') {
      void handle
        .stop('root-detach')
        .then((stopped) => (stopped ? this.#sendSessionCapture(stopped, false) : undefined))
        .catch((cause) => this.#fail(cause));
    } else {
      handle.dispose();
      if (capture) this.#storeBufferedCapture(capture);
    }
    this.#notify();
  }

  async flush(): Promise<void> {
    if (!this.refreshEnabled()) return;
    if (this.#state !== 'session') return;
    const capture = await this.#stopCurrent('manual');
    if (!capture) return;
    try {
      await this.#sendSessionCapture(capture, true);
    } catch (cause) {
      this.#fail(cause);
      throw cause;
    }
  }

  getSnapshot(): ReplayCoordinatorSnapshot {
    const captures = [...this.#captures];
    const current = this.#handle?.getController()?.getCapture();
    if (current) captures.push(current);
    return {
      state: this.#state,
      ...(this.#replayId ? { replayId: this.#replayId } : {}),
      ...(this.#errorEventId ? { errorEventId: this.#errorEventId } : {}),
      ...(this.#sentReplayId ? { sentReplayId: this.#sentReplayId } : {}),
      eventCount: captures.reduce((total, capture) => total + capture.events.length, 0),
      approximateBytes: captures.reduce(
        (total, capture) => total + capture.stats.approximateBytes,
        0,
      ),
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  subscribe(listener: (snapshot: ReplayCoordinatorSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.#listeners.delete(listener);
  }

  refreshEnabled(): boolean {
    const enabled =
      typeof this.#options.enabled === 'function'
        ? this.#options.enabled()
        : this.#options.enabled !== false;
    if (enabled) return this.#state !== 'disabled';
    this.#handle?.dispose();
    this.#handle = undefined;
    this.#rootRuntime = undefined;
    this.#captures = [];
    this.#pendingErrorIds = [];
    this.#detachErrorHook?.();
    this.#detachErrorHook = undefined;
    this.#state = 'disabled';
    this.#notify();
    return false;
  }

  #beforeSendEvent(event: ReplayAwareEvent): void {
    if (!this.refreshEnabled()) return;
    if (
      !this.#rootRuntime ||
      (this.#state !== 'buffer' && this.#state !== 'promoted' && this.#state !== 'session') ||
      !isErrorEvent(event) ||
      !event.event_id
    ) {
      return;
    }
    let prepared: TaroReplayCapture | undefined;
    if (this.#state === 'buffer' && !this.#finalization) {
      const current = this.#handle?.getController()?.getCapture();
      prepared = this.#mergeBufferedCaptures([...this.#captures, ...(current ? [current] : [])]);
      if (!prepared) {
        // This hook runs synchronously before the error envelope is constructed.
        // Never associate an error with a Replay that cannot contain a checkpoint.
        if (event.contexts?.replay?.replay_id === this.#replayId) {
          event.contexts = { ...event.contexts };
          delete event.contexts.replay;
        }
        const handle = this.#handle;
        this.#handle = undefined;
        handle?.dispose();
        this.#resetErrorBufferSession();
        this.#notify();
        return;
      }
    }
    this.#errorEventId = event.event_id;
    event.contexts = {
      ...event.contexts,
      replay: {
        ...event.contexts?.replay,
        replay_id: this.#replayId,
      },
    };
    this.#rememberError(event.event_id);
    if (this.#state !== 'buffer' || this.#finalization) {
      this.#notify();
      return;
    }
    this.#state = 'promoted';
    this.#notify();
    this.#finalization = this.#promote(prepared!);
    void this.#finalization
      .catch((cause) => this.#fail(cause))
      .finally(() => {
        this.#finalization = undefined;
      });
  }

  async #promote(prepared: TaroReplayCapture): Promise<void> {
    const current = await this.#stopCurrent('error');
    // Send exactly the synchronously validated baseline/tail. Async clock or
    // navigation changes must not invalidate an already-associated error.
    const capture = {
      ...prepared,
      endedAt: current?.endedAt ?? prepared.endedAt ?? (this.#options.now || Date.now)(),
      stopReason: 'error',
    };
    if (!this.refreshEnabled()) return;
    const errorIds = [...this.#pendingErrorIds];
    await sendReplayCapture(this.#options.client, capture, {
      errorIds,
      replayType: 'buffer',
      segmentId: this.#segmentId++,
    });
    this.#pendingErrorIds = this.#pendingErrorIds.filter((id) => !errorIds.includes(id));
    this.#captures = [];
    if (this.#replayId) this.#sentReplayId = this.#replayId;
    this.#state = 'session';
    if (this.#rootRuntime) this.#startRoot(this.#rootRuntime);
    this.#notify();
  }

  #rememberError(eventId: string): void {
    if (this.#pendingErrorIds.length >= 100 || this.#pendingErrorIds.includes(eventId)) return;
    this.#pendingErrorIds.push(eventId);
  }

  async #stopCurrent(reason: string): Promise<TaroReplayCapture | undefined> {
    const handle = this.#handle;
    if (!handle) return undefined;
    this.#handle = undefined;
    return handle.stop(reason);
  }

  #mergeBufferedCaptures(
    captures: readonly TaroReplayCapture[] = this.#captures,
  ): TaroReplayCapture | undefined {
    if (!captures.length) return undefined;
    const last = captures[captures.length - 1]!;
    const limits = { ...DEFAULT_LIMITS, ...this.#options.limits };
    const events = captures.flatMap((capture) => capture.events);
    const bounded = boundReplayEvents(events, {
      now: (this.#options.now || Date.now)(),
      windowMs: limits.rollingWindowMs,
      maxEvents: limits.maxEvents,
      maxBytes: limits.maxBytes,
    });
    if (!bounded.length) return undefined;
    const approximateBytes = bounded.reduce(
      (sum, event) => sum + utf8ByteLength(JSON.stringify(event)),
      0,
    );
    return {
      ...last,
      replayId: this.#replayId || last.replayId,
      startedAt: bounded[0]?.timestamp || last.startedAt,
      endedAt: last.endedAt || (this.#options.now || Date.now)(),
      stopReason: 'error',
      events: bounded,
      stats: { ...last.stats, eventCount: bounded.length, approximateBytes },
    };
  }

  #storeBufferedCapture(capture: TaroReplayCapture): void {
    this.#captures.push(capture);
    const bounded = this.#mergeBufferedCaptures();
    this.#captures = bounded ? [bounded] : [];
  }

  #fail(cause: unknown): void {
    this.#error = errorValue(cause);
    this.#handle?.dispose();
    this.#handle = undefined;
    this.#rootRuntime = undefined;
    this.#captures = [];
    this.#pendingErrorIds = [];
    this.#state = 'error';
    this.#detachErrorHook?.();
    this.#detachErrorHook = undefined;
    this.#notify();
  }

  async #onCapture(capture: TaroReplayCapture): Promise<void> {
    if (
      this.#state !== 'session' ||
      (capture.stopReason !== 'duration' && capture.stopReason !== 'limit')
    ) {
      return;
    }
    this.#handle = undefined;
    await this.#sendSessionCapture(capture, true);
  }

  async #sendSessionCapture(capture: TaroReplayCapture, terminal: boolean): Promise<void> {
    if (!this.refreshEnabled()) return;
    const segmentId = this.#segmentId++;
    const errorIds = [...this.#pendingErrorIds];
    await sendReplayCapture(this.#options.client, capture, {
      replayType: 'session',
      segmentId,
      errorIds,
    });
    this.#pendingErrorIds = this.#pendingErrorIds.filter((id) => !errorIds.includes(id));
    if (this.#replayId) this.#sentReplayId = this.#replayId;
    if (terminal) {
      if (this.#errorMode) this.#resetErrorBufferSession();
      else this.#state = 'sent';
    }
    this.#notify();
  }

  #resetErrorBufferSession(): void {
    this.#replayId = replayId(this.#random);
    this.#segmentId = 0;
    this.#state = 'buffer';
    this.#captures = [];
    this.#pendingErrorIds = [];
    this.#errorEventId = undefined;
    if (this.#rootRuntime) this.#startRoot(this.#rootRuntime);
  }

  #notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
