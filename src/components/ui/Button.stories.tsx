import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, Play, Trash2 } from 'lucide-react';
import { Button } from './button';

const meta = {
  title: 'UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const VariantMatrix: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Default</Button>
      <Button variant="primary">
        <Play size={16} fill="currentColor" />
        Play
      </Button>
      <Button variant="danger">
        <Trash2 size={16} />
        Remove
      </Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Learn more</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">
        Continue
        <ArrowRight size={16} />
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    variant: 'primary',
    disabled: true,
    children: 'Unavailable',
  },
};

export const Neobrutalism: Story = {
  globals: {
    theme: 'neobrutalism',
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Default</Button>
      <Button variant="primary">
        <Play size={16} fill="currentColor" />
        Play
      </Button>
      <Button variant="danger">
        <Trash2 size={16} />
        Remove
      </Button>
    </div>
  ),
};
