import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Slider } from './slider';

const meta = {
  title: 'UI/Slider',
  component: Slider,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Slider>;

export default meta;

type Story = StoryObj<typeof meta>;

function InteractiveSlider({ initialValue = 42 }: { initialValue?: number }) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="w-80 space-y-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>Playback level</span>
        <output>{value}%</output>
      </div>
      <Slider
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={setValue}
        showTooltip
        aria-label="Playback level"
      />
    </div>
  );
}

export const Interactive: Story = {
  render: () => <InteractiveSlider />,
};

export const LowValue: Story = {
  render: () => <InteractiveSlider initialValue={8} />,
};

export const Disabled: Story = {
  render: () => (
    <div className="w-80">
      <Slider value={38} disabled aria-label="Disabled playback level" />
    </div>
  ),
};

export const Neobrutalism: Story = {
  globals: {
    theme: 'neobrutalism',
  },
  render: () => <InteractiveSlider initialValue={64} />,
};
