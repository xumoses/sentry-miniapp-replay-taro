import { document, MutationObserver } from '@tarojs/runtime';
import Taro, { useReady, useUnload } from '@tarojs/taro';
import { useEffect, useState } from 'react';

import type { ReplayCoordinatorSnapshot, TaroReplayBridge } from '../coordinator/types';
import type { TaroReplayRuntime } from '../types';

function createRuntime(): TaroReplayRuntime {
  const taro = Taro as unknown as {
    getCurrentInstance(): ReturnType<TaroReplayRuntime['getCurrentInstance']>;
    getWindowInfo?(): ReturnType<NonNullable<TaroReplayRuntime['getWindowInfo']>>;
    getSystemInfoSync?(): { windowWidth?: number; windowHeight?: number };
    getEnv?(): string;
    getAccountInfoSync?(): ReturnType<NonNullable<TaroReplayRuntime['getAccountInfoSync']>>;
    getAppBaseInfo?(): ReturnType<NonNullable<TaroReplayRuntime['getAppBaseInfo']>>;
  };
  return {
    document,
    MutationObserver: MutationObserver as unknown as TaroReplayRuntime['MutationObserver'],
    getCurrentInstance: () => taro.getCurrentInstance(),
    getWindowInfo: () => taro.getWindowInfo?.() || taro.getSystemInfoSync?.() || {},
    getEnv: () => taro.getEnv?.() || 'unknown',
    getAccountInfoSync: () => taro.getAccountInfoSync?.() || {},
    getAppBaseInfo: () => taro.getAppBaseInfo?.() || {},
  };
}

export interface UseTaroReplayRootOptions {
  bridge?: TaroReplayBridge;
}

/** Attaches only the mounted Taro root to the native process-wide coordinator. */
export function useTaroReplayRoot({ bridge }: UseTaroReplayRootOptions): ReplayCoordinatorSnapshot {
  const [snapshot, setSnapshot] = useState<ReplayCoordinatorSnapshot>(
    () =>
      bridge?.getSnapshot() || {
        state: 'disabled',
        eventCount: 0,
        approximateBytes: 0,
      },
  );
  useReady(() => bridge?.attachRoot(createRuntime()));
  useUnload(() => bridge?.detachRoot());
  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      bridge.detachRoot();
    };
  }, [bridge]);
  return snapshot;
}

export type { ReplayCoordinatorSnapshot, TaroReplayBridge } from '../coordinator/types';
