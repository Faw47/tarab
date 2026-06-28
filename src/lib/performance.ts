import { invoke } from '@tauri-apps/api/core';

export const PERF_BUDGETS = {
  startupInteractiveMs: 3500,
  searchMetadataMs: 180,
  searchLyricsMs: 900,
  ipcCallsPerSecond: 20,
  renderBurstPerSecond: 12,
} as const;

export type PerfBudgetKey = keyof typeof PERF_BUDGETS;

// Check for debug flag in localStorage or URL params (only in dev)
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

class PerformanceMonitor {
  private enabled: boolean;
  private renderCounts: Map<string, number> = new Map();
  private activeTimers: Map<string, number> = new Map();
  private rafCount: number = 0;
  private activeRafLoops: Set<number> = new Set();
  private ipcCalls: Array<{ cmd: string; time: number }> = [];
  private renderTimes: Map<string, Array<number>> = new Map();
  private timerLeaks: Map<
    number,
    { type: 'interval' | 'timeout'; created: number; handler: string }
  > = new Map();
  private lastMetricsReport: number = 0;
  private metricsIntervalId: ReturnType<typeof setInterval> | null = null;
  private budgetSamples: Map<PerfBudgetKey, number[]> = new Map();

  constructor() {
    this.enabled = DEBUG_PERF_ENABLED;
    if (__DEV__ && this.enabled) {
      console.log('🚀 Performance Monitor Enabled');
      (window as any).perfMonitor = this;
      this.monitorTimers();
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

  logRender(componentName: string, extra?: any) {
    if (!this.enabled) return;

    const count = (this.renderCounts.get(componentName) || 0) + 1;
    this.renderCounts.set(componentName, count);

    // Track render times for frequency calculation
    const now = Date.now();
    if (!this.renderTimes.has(componentName)) {
      this.renderTimes.set(componentName, []);
    }
    this.renderTimes.get(componentName)!.push(now);
    // Keep only last 10 seconds of render times
    const oneSecondAgo = now - 10000;
    const times = this.renderTimes.get(componentName)!;
    this.renderTimes.set(
      componentName,
      times.filter((t) => t > oneSecondAgo),
    );

    // Group console logs to reduce noise, color code by frequency
    const color = count > 100 ? '#ff0000' : count > 50 ? '#ff9900' : '#00cc00';

    console.groupCollapsed(
      `%c[Render] ${componentName} (${count})`,
      `color: ${color}; font-weight: bold`,
    );
    if (extra) console.log('Props/State:', extra);
    console.trace('Render Trigger'); // Helpful to see what triggered it
    console.groupEnd();
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

  // Wrap Tauri invoke to measure IPC cost
  async measureIPC<T>(
    cmd: string,
    args?: unknown,
    originalInvoke: typeof invoke = invoke,
  ): Promise<T> {
    if (!this.enabled) return originalInvoke(cmd, args as any);

    const start = performance.now();
    const argSize = args ? JSON.stringify(args).length : 0;
    const now = Date.now();

    // Track IPC call for frequency calculation
    this.ipcCalls.push({ cmd, time: now });
    // Keep only last 5 seconds of calls
    const fiveSecondsAgo = now - 5000;
    this.ipcCalls = this.ipcCalls.filter((call) => call.time > fiveSecondsAgo);

    try {
      const result = await originalInvoke(cmd, args as any);
      const duration = performance.now() - start;

      console.log(
        `%c[IPC] ${cmd} (%c${argSize}b%c) - ${duration.toFixed(2)}ms`,
        'color: #00aaff; font-weight: bold',
        argSize > 1000 ? 'color: red' : 'color: inherit',
        'color: #00aaff; font-weight: bold',
      );
      return result as T;
    } catch (err) {
      console.error(`[IPC Fail] ${cmd}`, err);
      throw err;
    }
  }
  // Timer Monitoring
  monitorTimers() {
    if (!this.enabled || (window as any).__timersMonitored) return;
    (window as any).__timersMonitored = true;

    const originalRaf = window.requestAnimationFrame;
    const originalCaf = window.cancelAnimationFrame;
    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;

    window.requestAnimationFrame = (cb) => {
      const id = originalRaf((time) => {
        this.rafCount++;
        this.activeRafLoops.add(id);
        cb(time);
        // Remove after a frame (loops will re-add themselves)
        setTimeout(() => this.activeRafLoops.delete(id), 0);
      });
      return id;
    };

    window.cancelAnimationFrame = (id) => {
      this.activeRafLoops.delete(id);
      originalCaf(id);
    };

    (window as any).setInterval = (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = originalSetInterval(handler as (...args: unknown[]) => void, timeout, ...args);
      this.timerLeaks.set(id as number, {
        type: 'interval',
        created: Date.now(),
        handler: String(handler).substring(0, 100),
      });
      console.log(`%c[Timer] Interval Started (${id}) - ${timeout}ms`, 'color: #aa00ff');
      return id;
    };

    (window as any).clearInterval = (id: unknown) => {
      if (id != null) {
        this.timerLeaks.delete(id as number);
        console.log(`%c[Timer] Interval Cleared (${id})`, 'color: #aa00ff');
      }
      originalClearInterval(id as Parameters<typeof clearInterval>[0]);
    };

    (window as any).setTimeout = (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = originalSetTimeout(handler as (...args: unknown[]) => void, timeout, ...args);
      this.timerLeaks.set(id as number, {
        type: 'timeout',
        created: Date.now(),
        handler: String(handler).substring(0, 100),
      });
      if (timeout !== undefined) {
        setTimeout(() => this.timerLeaks.delete(id as number), timeout + 1000);
      }
      return id;
    };

    (window as any).clearTimeout = (id: unknown) => {
      if (id != null) {
        this.timerLeaks.delete(id as number);
      }
      originalClearTimeout(id as Parameters<typeof clearTimeout>[0]);
    };
  }

  startMetricsReporting() {
    if (!this.enabled) return;
    if (this.metricsIntervalId !== null) return;
    this.metricsIntervalId = setInterval(() => {
      const now = Date.now();
      if (now - this.lastMetricsReport < 5000) return; // Report every 5s
      this.lastMetricsReport = now;

      // RAF metrics
      const activeRafCount = this.activeRafLoops.size;
      if (activeRafCount > 0) {
        console.log(
          `%c[RAF] Active loops: ${activeRafCount}, Total calls: ${this.rafCount}`,
          'color: #00ff00',
        );
      }

      // IPC frequency (calls per second)
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

      // Render frequency per component
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
          // Keep only recent times
          this.renderTimes.set(component, recentTimes);
        }
      });

      // Timer leak detection
      const leaks = Array.from(this.timerLeaks.entries()).filter(
        ([_id, info]) => now - info.created > 30000,
      ); // Older than 30s
      if (leaks.length > 0) {
        console.warn(
          `%c[Timer Leak] ${leaks.length} timers not cleaned up:`,
          'color: orange; font-weight: bold',
        );
        leaks.forEach(([id, info]) => {
          console.warn(
            `  ${info.type}(${id}) created ${Math.round((now - info.created) / 1000)}s ago`,
          );
        });
      }
    }, 5000);
  }
}

export const Perf = new PerformanceMonitor();
export const recordPerfBudget = (key: PerfBudgetKey, value: number) => {
  Perf.recordBudget(key, value);
};

// React Hook for render counting
import { useEffect, useRef } from 'react';

export const useRenderLog = (componentName: string, active = true) => {
  const renders = useRef(0);

  useEffect(() => {
    if (active && Perf.isEnabled()) {
      renders.current += 1;
      Perf.logRender(componentName, { renderCount: renders.current });
    }
  });
};
