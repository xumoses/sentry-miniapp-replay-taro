import type { Breadcrumb } from '@sentry/core';

import { sendReplayCapture } from './envelope';
import { sanitizeBreadcrumb, sanitizeRecord, sanitizeUrl } from './privacy';
import type {
  CreateTaroReplayOptions,
  TaroReplayCapture,
  TaroReplayContext,
  TaroReplayControllerView,
  TaroReplayHandle,
  TaroReplayMetadata,
} from './types';

const SYNTHETIC_ORIGIN = 'https://miniapp.local';

function normalizeRoute(value: string | undefined): string {
  const route = sanitizeUrl(value || 'unknown').replace(/^\/+/, '');
  return route || 'unknown';
}

function normalizePlatform(value: string | undefined): string {
  const key = (value || 'unknown').toLowerCase();
  const names: Record<string, string> = {
    weapp: 'wechat',
    wechat: 'wechat',
    alipay: 'alipay',
    swan: 'baidu',
    tt: 'bytedance',
    jd: 'jingdong',
    qq: 'qq',
  };
  return names[key] || key;
}

function safely<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function mergeMetadata(
  defaults: TaroReplayMetadata,
  custom: TaroReplayMetadata | undefined,
  allowUser: boolean,
): TaroReplayMetadata {
  const customWithoutUser = custom ? { ...custom } : undefined;
  if (customWithoutUser) delete customWithoutUser.user;
  const safeCustom = customWithoutUser
    ? (sanitizeRecord(customWithoutUser as Record<string, unknown>) as TaroReplayMetadata)
    : undefined;
  const result: TaroReplayMetadata = {
    ...defaults,
    ...safeCustom,
    ...(defaults.tags || safeCustom?.tags
      ? { tags: { ...defaults.tags, ...safeCustom?.tags } }
      : {}),
    ...(defaults.contexts || safeCustom?.contexts
      ? { contexts: { ...defaults.contexts, ...safeCustom?.contexts } }
      : {}),
  };
  if (allowUser && custom?.user) result.user = sanitizeRecord(custom.user);
  else delete result.user;
  return result;
}

function shouldSendCapture(options: CreateTaroReplayOptions, reason: string | null): boolean {
  if (reason === 'page-unload' || reason === 'dispose') return options.sendOnDispose === true;
  if (reason === 'duration') return options.sendOnDurationStop !== false;
  return options.sendOnManualStop !== false;
}

export function createTaroReplay(options: CreateTaroReplayOptions): TaroReplayHandle {
  let controller: ReturnType<typeof options.sdk.startTaroDomReplayPoc> | undefined;
  let lastCapture: TaroReplayCapture | undefined;
  let detachBreadcrumb: (() => void) | undefined;
  let finalization: Promise<void> | undefined;
  let terminal = false;

  const reportError = (error: unknown): void => {
    options.onError?.(error);
  };

  const detach = (): void => {
    detachBreadcrumb?.();
    detachBreadcrumb = undefined;
  };

  const finalize = (capture: TaroReplayCapture): Promise<void> => {
    lastCapture = capture;
    terminal = true;
    detach();
    if (finalization) return finalization;

    finalization = (async () => {
      try {
        await options.onCapture?.(capture);
      } catch (error) {
        reportError(error);
      }

      if (!shouldSendCapture(options, capture.stopReason)) return;
      const client = options.sdk.getClient();
      if (!client || typeof client.sendEnvelope !== 'function') {
        throw new Error(
          '[sentry-miniapp-replay-taro] Cannot send Replay without an initialized client',
        );
      }
      await sendReplayCapture(client, capture);
    })();
    void finalization.catch(reportError);
    return finalization;
  };

  const start = (): boolean => {
    if (controller) return !terminal;
    if (terminal) return false;

    try {
      const instance = options.runtime.getCurrentInstance();
      const rootId = instance.router?.$taroPath || instance.router?.path;
      const route = normalizeRoute(rootId);
      const root = rootId
        ? options.runtime.document.getElementById(rootId) ||
          options.runtime.document.getElementById(route)
        : null;
      if (!root) {
        throw new Error(
          `[sentry-miniapp-replay-taro] Mounted Taro root not found for route "${route}"`,
        );
      }

      const client = options.sdk.getClient();
      const clientOptions = client?.getOptions?.();
      const platform = normalizePlatform(safely(() => options.runtime.getEnv?.()));
      const windowInfo = safely(() => options.runtime.getWindowInfo?.()) || {};
      const account = safely(() => options.runtime.getAccountInfoSync?.());
      const appBase = safely(() => options.runtime.getAppBaseInfo?.());
      const href = sanitizeUrl(options.href?.(route) || `${SYNTHETIC_ORIGIN}/${route}`);
      const context: TaroReplayContext = {
        route,
        href,
        platform,
        ...(clientOptions?.environment ? { environment: clientOptions.environment } : {}),
        ...(clientOptions?.release ? { release: clientOptions.release } : {}),
      };
      const metadata = mergeMetadata(
        {
          ...(clientOptions?.environment ? { environment: clientOptions.environment } : {}),
          ...(clientOptions?.release ? { release: clientOptions.release } : {}),
          sdk: {
            name: options.sdk.SDK_NAME || 'sentry.javascript.miniapp',
            version: options.sdk.SDK_VERSION || 'unknown',
          },
          tags: {
            'replay.adapter': 'taro',
            'miniapp.platform': platform,
            'page.route': route,
            ...(options.frameworkVersion ? { 'taro.version': options.frameworkVersion } : {}),
            ...(account?.miniProgram?.envVersion
              ? { 'miniapp.env_version': account.miniProgram.envVersion }
              : {}),
            ...(account?.miniProgram?.version
              ? { 'miniapp.version': account.miniProgram.version }
              : {}),
            ...(appBase?.SDKVersion ? { 'miniapp.base_library': appBase.SDKVersion } : {}),
          },
          contexts: {
            miniapp: {
              type: 'miniapp',
              platform,
              route,
              ...(account?.miniProgram?.envVersion
                ? { environment: account.miniProgram.envVersion }
                : {}),
              ...(account?.miniProgram?.version ? { version: account.miniProgram.version } : {}),
              ...(appBase?.SDKVersion ? { base_library: appBase.SDKVersion } : {}),
            },
          },
        },
        safely(() => options.getMetadata?.(context)),
        options.privacy?.allowUser === true,
      );
      const stylesheet = safely(() => options.runtime.getReplayStyles?.(context.route));

      controller = options.sdk.startTaroDomReplayPoc({
        root,
        MutationObserver: options.runtime.MutationObserver,
        href,
        ...(windowInfo.windowWidth === undefined ? {} : { width: windowInfo.windowWidth }),
        ...(windowInfo.windowHeight === undefined ? {} : { height: windowInfo.windowHeight }),
        ...(stylesheet === undefined ? {} : { stylesheet }),
        maskAllText: options.privacy?.maskAllText !== false,
        maskInputValues: options.privacy?.maskInputValues !== false,
        ...(options.replayId ? { replayId: options.replayId } : {}),
        ...options.limits,
        metadata,
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
        onStop: (capture) => {
          void finalize(capture);
        },
      });

      if (controller.getCapture().stopReason) {
        void finalize(controller.getCapture());
        return false;
      }

      if (options.captureBreadcrumbs !== false && client?.on) {
        detachBreadcrumb = client.on('beforeAddBreadcrumb', (breadcrumb: Breadcrumb) => {
          controller?.addBreadcrumb(
            sanitizeBreadcrumb(breadcrumb, {
              maskMessage: options.privacy?.maskAllText !== false,
            }),
          );
        });
      }

      const navigation: Breadcrumb = {
        category: 'navigation',
        type: 'navigation',
        data: { to: href },
      };
      if (options.sdk.addBreadcrumb) options.sdk.addBreadcrumb(navigation);
      else controller.addBreadcrumb(navigation);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  const stop = async (reason = 'manual'): Promise<TaroReplayCapture | undefined> => {
    if (!controller) return lastCapture;
    const capture = terminal ? lastCapture || controller.getCapture() : controller.stop(reason);
    if (!terminal) await finalize(capture);
    else if (finalization) await finalization;
    return lastCapture || capture;
  };

  const getController = (): TaroReplayControllerView | undefined => {
    if (!controller) return undefined;
    return {
      get replayId() {
        return controller?.getCapture().replayId || lastCapture?.replayId || '';
      },
      getCapture: () => controller?.getCapture() || lastCapture!,
    };
  };

  const dispose = (): void => {
    detach();
    if (controller && !terminal) controller.stop('page-unload');
  };

  return { start, stop, getController, dispose };
}
