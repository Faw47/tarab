import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import * as Sentry from '@sentry/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProviders } from './app/providers';
import { AppErrorBoundary } from './components/shared/AppErrorBoundary';
import { initLogger } from './platform/logger';
import './index.css';

performance.mark('startup:boot-script');

const markPaintMetrics = () => {
  if (!import.meta.env.DEV) return;
  try {
    const paintObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        console.info(`[startup] ${entry.name}: ${entry.startTime.toFixed(1)}ms`);
      }
    });
    paintObserver.observe({ type: 'paint', buffered: true });
  } catch {
    // Older environments may not support buffered paint entries.
  }
};

const initSentryDeferred = () => {
  if (!import.meta.env.VITE_SENTRY_DSN) return;

  const run = () => {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
      tracesSampleRate: 1.0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
  };

  const requestIdle = (globalThis as Window & typeof globalThis).requestIdleCallback;
  if (typeof requestIdle === 'function') {
    requestIdle(run, { timeout: 1500 });
    return;
  }
  setTimeout(run, 500);
};

// Initialize platform logging
initLogger().catch(console.error);
markPaintMetrics();
initSentryDeferred();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found in index.html. Ensure there is a <div id="root"></div>.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppProviders>
        <App />
      </AppProviders>
    </AppErrorBoundary>
  </React.StrictMode>,
);

performance.mark('startup:react-render-scheduled');
