import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';

export const PERF_BUDGETS = {
  startupInteractiveMs: 3500,
  searchMetadataMs: 180,
  searchLyricsMs: 900,
  ipcCallsPerSecond: 20,
  renderBurstPerSecond: 12,
} as const;

export type PerfBudgetKey = keyof typeof PERF_BUDGETS;

const isDebugPerf = () => {
  if (typeof window === 'undefined') return false;

  let storageDebugEnabled = false;
  try {
    storageDebugEnabled = window.localStorage?.getItem('DEBUG_PERF') === 'true';
  } catch {
    storageDebugEnabled = false;
  }

  return storageDebugEnabled || new URLSearchParams(window.location.search).has('debug_perf');
};

export const DEBUG_PERF_ENABLED = __DEV__ && isDebugPerf();

const safeSerializedSize = (value: unknown): number => {
  if (value == null) return 0;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
};

class PerformanceMonitor {
  private enabled: boolean;
  private renderCounts: Map<string, number> = new Map();
  private activeTimers: Map<string, number> = new Map();
  private ipcCalls: Array<{ cmd: string; time: number }> = [];
  private renderTimes: Map<string, Array<number>> = new Map();
  private lastMetricsReport = 0;
  private metricsIntervalId: ReturnType<typeof setInterval> | null = null;
  private budgetSamples: Map<PerfBudgetKey, number[]> = new Map();

  constructor() {
    this.enabled = DEBUG_PERF_ENABLED;
    if (__DEV__ && this.enabled) {
      console.log('[Perf] Performance monitor enabled');
      this.startMetricsReporting();
    }
  }

  isEnabled() {
    return this.enabled;
  }

  recordBudget(key: PerfBudgetKey, value: number) {
    if (!__DEV__) return;
    const budget = PERF_BUDGETS[key];
    const list = this.budgetSamples.get(key) ?? [];
    list.push(value);
    if (list.length > 20) list.shift();
    this.budgetSamples.set(key, list);

    if (value > budget) {
      console.warn(`[PerfBudget] ${key} ${value.toFixed(1)} exceeded budget ${budget}`);
    } else if (this.enabled) {
      console.log(`[PerfBudget] ${key} ${value.toFixed(1)} / ${budget}`);
    }
  }

  logRender(componentName: string, extra?: unknown) {
    if (!this.enabled) return;

    const count = (this.renderCounts.get(componentName) || 0) + 1;
    this.renderCounts.set(componentName, count);

    const now = Date.now();
    const times = this.renderTimes.get(componentName) ?? [];
    times.push(now);
    this.renderTimes.set(
      componentName,
      times.filter((t) => t > now - 10000),
    );

    if (count === 1 || count % 25 === 0) {
      console.log(`[Render] ${componentName} (${count})`, extra ?? '');
    }
  }

  startMeasure(label: string) {
    if (!this.enabled) return;
    this.activeTimers.set(label, performance.now());
  }

  endMeasure(label: string, thresholdMs = 0) {
    if (!this.enabled) return;
    const start = this.activeTimers.get(label);
    if (!start) return;

    const duration = performance.now() - start;
    this.activeTimers.delete(label);

    if (duration >= thresholdMs) {
      console.log(
        `%c[Time] ${label}: ${duration.toFixed(2)}ms`,
        duration > 16 ? 'color: red; font-weight: bold' : 'color: #888',
      );
    }
  }

  async measureIPC<T>(
    cmd: string,
    args?: unknown,
    originalInvoke: typeof invoke = invoke,
  ): Promise<T> {
    if (!this.enabled) return originalInvoke<T>(cmd, args as Parameters<typeof invoke>[1]);

    const start = performance.now();
    const argSize = safeSerializedSize(args);
    const now = Date.now();

    this.ipcCalls.push({ cmd, time: now });
    this.ipcCalls = this.ipcCalls.filter((call) => call.time > now - 5000);

    try {
      const result = await originalInvoke<T>(cmd, args as Parameters<typeof invoke>[1]);
      const duration = performance.now() - start;

      console.log(
        `%c[IPC] ${cmd} (%c${argSize}b%c) - ${duration.toFixed(2)}ms`,
        'color: #00aaff; font-weight: bold',
        argSize > 1000 ? 'color: red' : 'color: inherit',
        'color: #00aaff; font-weight: bold',
      );
      return result;
    } catch (err) {
      console.error(`[IPC Fail] ${cmd}`, err);
      throw err;
    }
  }

  startMetricsReporting() {
    if (!this.enabled) return;
    if (this.metricsIntervalId !== null) return;
    this.metricsIntervalId = setInterval(() => {
      const now = Date.now();
      if (now - this.lastMetricsReport < 5000) return;
      this.lastMetricsReport = now;

      const oneSecondAgo = now - 1000;
      this.ipcCalls = this.ipcCalls.filter((call) => call.time > oneSecondAgo);
      const ipcPerSecond = this.ipcCalls.length;
      if (ipcPerSecond > 0) {
        console.log(
          `%c[IPC] Frequency: ${ipcPerSecond}/sec`,
          ipcPerSecond > 10 ? 'color: red; font-weight: bold' : 'color: #00aaff',
        );
        this.recordBudget('ipcCallsPerSecond', ipcPerSecond);
      }

      this.renderTimes.forEach((times, component) => {
        const recentTimes = times.filter((t) => t > oneSecondAgo);
        if (recentTimes.length > 0) {
          const rendersPerSecond = recentTimes.length;
          this.recordBudget('renderBurstPerSecond', rendersPerSecond);
          if (rendersPerSecond > 10) {
            console.log(
              `%c[Render] ${component}: ${rendersPerSecond} renders/sec`,
              'color: red; font-weight: bold',
            );
          }
          this.renderTimes.set(component, recentTimes);
        }
      });
    }, 5000);
  }
}

export const Perf = new PerformanceMonitor();

export const recordPerfBudget = (key: PerfBudgetKey, value: number) => {
  Perf.recordBudget(key, value);
};

export const useRenderLog = (componentName: string, active = true) => {
  const renders = useRef(0);

  useEffect(() => {
    if (active && Perf.isEnabled()) {
      renders.current += 1;
      Perf.logRender(componentName, { renderCount: renders.current });
    }
  });
};
