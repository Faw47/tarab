import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';
import type { NavView } from './navigation-model';
import { TopBar } from './TopBar';
import { TopBarNeo } from './TopBarNeo';

const meta = {
  title: 'Navigation/TopBar',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const navigate = fn();

function TopBarStoryHarness({
  theme,
  navMode = 'topNav',
  currentView = 'library',
  processing = false,
}: {
  theme: 'liquid-glass' | 'neobrutalism';
  navMode?: 'iconRail' | 'topNav';
  currentView?: NavView;
  processing?: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const commonProps = {
    navMode,
    currentView,
    onNavigate: navigate,
    searchQuery,
    onSearchChange: setSearchQuery,
    isScanning: processing,
    scanProgress: processing ? 46 : 0,
    activeProcessing: processing ? { label: 'Indexing library' } : undefined,
    onShuffleAll: fn(),
  };

  return theme === 'neobrutalism' ? <TopBarNeo {...commonProps} /> : <TopBar {...commonProps} />;
}

export const LiquidTopNav: Story = {
  render: () => <TopBarStoryHarness theme="liquid-glass" />,
};

export const LiquidIconRail: Story = {
  render: () => (
    <TopBarStoryHarness theme="liquid-glass" navMode="iconRail" currentView="settings" />
  ),
};

export const LiquidMobile: Story = {
  render: () => <TopBarStoryHarness theme="liquid-glass" currentView="queue" />,
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
};

export const LiquidSearching: Story = {
  render: () => <TopBarStoryHarness theme="liquid-glass" currentView="search" />,
};

export const LiquidProcessing: Story = {
  render: () => <TopBarStoryHarness theme="liquid-glass" processing />,
};

export const NeoTopNav: Story = {
  render: () => <TopBarStoryHarness theme="neobrutalism" />,
  globals: {
    theme: 'neobrutalism',
  },
};

export const NeoSearching: Story = {
  render: () => <TopBarStoryHarness theme="neobrutalism" currentView="search" />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  globals: { theme: 'neobrutalism' },
};

export const NeoMobileTags: Story = {
  render: () => <TopBarStoryHarness theme="neobrutalism" currentView="tags" />,
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  globals: {
    theme: 'neobrutalism',
  },
};

export const NeoMobileSettings: Story = {
  render: () => <TopBarStoryHarness theme="neobrutalism" currentView="settings" />,
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  globals: {
    theme: 'neobrutalism',
  },
};

export const NeoProcessing: Story = {
  render: () => <TopBarStoryHarness theme="neobrutalism" processing />,
  globals: {
    theme: 'neobrutalism',
  },
};
