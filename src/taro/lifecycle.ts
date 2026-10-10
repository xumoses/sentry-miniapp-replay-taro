import { document, hooks, MutationObserver } from '@tarojs/runtime';
import Taro from '@tarojs/taro';

import type { TaroReplayBridge } from '../coordinator/types';
import type { TaroReplayRuntime } from '../types';

type PageLifecycle = (...args: unknown[]) => unknown;
type PageLifecycleConfig = Record<string, unknown> & {
  onReady?: PageLifecycle;
  onShow?: PageLifecycle;
  onHide?: PageLifecycle;
  onUnload?: PageLifecycle;
};
type TaroPageInstance = {
  $taroPath?: string;
  route?: string;
  __route__?: string;
};

const installedBridges = new WeakSet<object>();
const readyPages = new WeakSet<object>();
const visiblePages = new WeakSet<object>();
const attachedPages = new WeakSet<object>();
const scheduledPages = new WeakSet<object>();

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function createRuntime(
  page: unknown,
  getReplayStyles?: TaroReplayRuntime['getReplayStyles'],
  getReplayImageSources?: TaroReplayRuntime['getReplayImageSources'],
): TaroReplayRuntime {
  const taro = Taro as unknown as {
    getCurrentInstance(): ReturnType<TaroReplayRuntime['getCurrentInstance']>;
    getWindowInfo?(): ReturnType<NonNullable<TaroReplayRuntime['getWindowInfo']>>;
    getSystemInfoSync?(): { windowWidth?: number; windowHeight?: number };
    getEnv?(): string;
    getAccountInfoSync?(): ReturnType<NonNullable<TaroReplayRuntime['getAccountInfoSync']>>;
    getAppBaseInfo?(): ReturnType<NonNullable<TaroReplayRuntime['getAppBaseInfo']>>;
    nextTick?(callback: () => void): void;
  };
  const pageInstance = isObject(page) ? (page as TaroPageInstance) : undefined;
  const pagePath = pageInstance?.$taroPath || pageInstance?.route || pageInstance?.__route__;
  return {
    document,
    MutationObserver: MutationObserver as unknown as TaroReplayRuntime['MutationObserver'],
    getCurrentInstance: () =>
      pagePath
        ? {
            router: {
              ...(pageInstance?.$taroPath ? { $taroPath: pageInstance.$taroPath } : {}),
              path: pageInstance?.route || pageInstance?.__route__ || pagePath,
            },
          }
        : taro.getCurrentInstance(),
    getWindowInfo: () => taro.getWindowInfo?.() || taro.getSystemInfoSync?.() || {},
    ...(getReplayStyles ? { getReplayStyles } : {}),
    ...(getReplayImageSources ? { getReplayImageSources } : {}),
    getEnv: () => taro.getEnv?.() || 'unknown',
    getAccountInfoSync: () => taro.getAccountInfoSync?.() || {},
    getAppBaseInfo: () => taro.getAppBaseInfo?.() || {},
  };
}

function wrapLifecycle(
  original: PageLifecycle | undefined,
  replayLifecycle: (page: unknown) => void,
): PageLifecycle {
  return function wrappedLifecycle(this: unknown, ...args: unknown[]): unknown {
    const result = original?.apply(this, args);
    try {
      replayLifecycle(this);
    } catch {
      // Replay is diagnostic-only and must never alter Taro page navigation.
    }
    return result;
  };
}

/** Instruments every Taro page created after installation without changing page components. */
export function installTaroReplayPageLifecycle({
  bridge,
  getReplayStyles,
  getReplayImageSources,
}: {
  bridge?: TaroReplayBridge;
  getReplayStyles?: TaroReplayRuntime['getReplayStyles'];
  getReplayImageSources?: TaroReplayRuntime['getReplayImageSources'];
}): void {
  if (!bridge || installedBridges.has(bridge)) return;
  installedBridges.add(bridge);

  hooks.tap('modifyPageObject', (pageConfig: PageLifecycleConfig) => {
    const scheduleAttach = (page: unknown) => {
      if (!isObject(page)) {
        bridge.attachRoot(createRuntime(page, getReplayStyles, getReplayImageSources));
        return;
      }
      if (
        !readyPages.has(page) ||
        !visiblePages.has(page) ||
        attachedPages.has(page) ||
        scheduledPages.has(page)
      ) {
        return;
      }
      scheduledPages.add(page);
      const attach = () => {
        scheduledPages.delete(page);
        if (!visiblePages.has(page) || attachedPages.has(page)) return;
        attachedPages.add(page);
        try {
          bridge.attachRoot(createRuntime(page, getReplayStyles, getReplayImageSources));
        } catch {
          // Replay is diagnostic-only and must never alter Taro page navigation.
        }
      };
      const taro = Taro as unknown as { nextTick?(callback: () => void): void };
      if (taro.nextTick) taro.nextTick(attach);
      else setTimeout(attach, 0);
    };
    const show = (page: unknown) => {
      if (isObject(page)) visiblePages.add(page);
      scheduleAttach(page);
    };
    const ready = (page: unknown) => {
      if (isObject(page)) {
        readyPages.add(page);
        visiblePages.add(page);
      }
      scheduleAttach(page);
    };
    const detach = (page: unknown, unload = false) => {
      if (isObject(page)) {
        visiblePages.delete(page);
        scheduledPages.delete(page);
        if (unload) readyPages.delete(page);
        if (!attachedPages.delete(page)) return;
      }
      bridge.detachRoot();
    };
    pageConfig.onReady = wrapLifecycle(pageConfig.onReady, ready);
    pageConfig.onShow = wrapLifecycle(pageConfig.onShow, show);
    pageConfig.onHide = wrapLifecycle(pageConfig.onHide, detach);
    pageConfig.onUnload = wrapLifecycle(pageConfig.onUnload, (page) => detach(page, true));
  });
}

export type { TaroReplayBridge } from '../coordinator/types';
