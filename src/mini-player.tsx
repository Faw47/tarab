import './mini-player.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProviders } from './app/providers';
import { DesktopMiniWindowSurface } from './components/player/DesktopMiniWindowSurface';
import { AppErrorBoundary } from './components/shared/AppErrorBoundary';
import { initLogger } from './platform/logger';
import './index.css';

void initLogger().catch(console.error);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Mini player root element missing.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppProviders>
        <DesktopMiniWindowSurface />
      </AppProviders>
    </AppErrorBoundary>
  </React.StrictMode>,
);
