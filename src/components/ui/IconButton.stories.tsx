import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoreHorizontal, Pause, Play, Settings, Trash2 } from 'lucide-react';
import { IconButton } from './IconButton';

const meta = {
  title: 'UI/IconButton',
  component: IconButton,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof IconButton>;

export default meta;

type Story = StoryObj;

export const ActionSet: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton aria-label="Play" title="Play" variant="primary">
        <Play size={16} fill="currentColor" />
      </IconButton>
      <IconButton aria-label="Pause" title="Pause" variant="secondary">
        <Pause size={16} />
      </IconButton>
      <IconButton aria-label="Settings" title="Settings" variant="ghost">
        <Settings size={16} />
      </IconButton>
      <IconButton aria-label="More actions" title="More actions" variant="outline">
        <MoreHorizontal size={16} />
      </IconButton>
      <IconButton aria-label="Delete" title="Delete" variant="destructive">
        <Trash2 size={16} />
      </IconButton>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton aria-label="Small action" title="Small action" size="sm">
        <MoreHorizontal size={15} />
      </IconButton>
      <IconButton aria-label="Medium action" title="Medium action" size="md">
        <MoreHorizontal size={17} />
      </IconButton>
      <IconButton aria-label="Large action" title="Large action" size="lg">
        <MoreHorizontal size={19} />
      </IconButton>
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    'aria-label': 'Disabled action',
    title: 'Disabled action',
    disabled: true,
    children: <Settings size={16} />,
  },
};

export const Neobrutalism: Story = {
  globals: {
    theme: 'neobrutalism',
  },
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton aria-label="Play" title="Play" variant="primary">
        <Play size={16} fill="currentColor" />
      </IconButton>
      <IconButton aria-label="Settings" title="Settings" variant="secondary">
        <Settings size={16} />
      </IconButton>
      <IconButton aria-label="Delete" title="Delete" variant="destructive">
        <Trash2 size={16} />
      </IconButton>
    </div>
  ),
};
