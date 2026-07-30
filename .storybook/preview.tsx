import type { Decorator, Preview } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import '../src/index.css';
import { type AppTheme, useSettingsStore } from '../src/store/settings-store';

const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals.theme ?? 'liquid-glass') as AppTheme;
  const isFullscreen = context.parameters.layout === 'fullscreen';
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
      }),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    useSettingsStore.setState({ theme });
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className={
          isFullscreen
            ? 'min-h-screen bg-[var(--background)] text-[var(--foreground)]'
            : 'min-h-screen bg-[var(--background)] p-6 text-[var(--foreground)]'
        }
      >
        <div className={isFullscreen ? undefined : 'mx-auto max-w-5xl'}>
          <Story />
        </div>
      </div>
    </QueryClientProvider>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      name: 'Theme',
      defaultValue: 'liquid-glass',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'liquid-glass', title: 'Liquid glass' },
          { value: 'neobrutalism', title: 'Neobrutalism' },
        ],
      },
    },
  },
  parameters: {
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
};

export default preview;
