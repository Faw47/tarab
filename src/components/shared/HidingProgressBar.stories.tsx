import type { Meta, StoryObj } from '@storybook/react-vite';
import { usePlayerStore } from '../../store/player-store';
import { HidingProgressBar } from './HidingProgressBar';

interface ProgressComparisonProps {
  focused?: boolean;
}

function ProgressSurface({ label, focused }: { label: string; focused: boolean }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-white">{label}</h2>
      <div className="group relative h-52 w-[420px] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#4b342d] to-[#101b22]">
        <HidingProgressBar className={focused ? '[&_[role=slider]]:opacity-100' : undefined} />
      </div>
    </section>
  );
}

function ProgressComparison({ focused = false }: ProgressComparisonProps) {
  usePlayerStore.setState({ currentTime: 62, duration: 156 });
  return (
    <div className="flex min-h-screen flex-wrap items-center justify-center gap-10 bg-[#090907] p-10">
      <ProgressSurface label="Home hero reference" focused={focused} />
      <ProgressSurface label="Full-player card" focused={focused} />
    </div>
  );
}

const meta = {
  title: 'Shared/Hiding Progress Bar Comparison',
  component: ProgressComparison,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
} satisfies Meta<typeof ProgressComparison>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Resting: Story = {
  args: { focused: false },
};

export const Revealed: Story = {
  args: { focused: true },
};
