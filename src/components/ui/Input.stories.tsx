import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './Input';

const meta = {
  title: 'UI/Input',
  component: Input,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="grid w-80 gap-3">
      <label className="grid gap-1 text-sm">
        <span>Playlist name</span>
        <Input aria-label="Playlist name" placeholder="My playlist" />
      </label>
      <Input aria-label="Filled value" defaultValue="Night Routes" />
      <Input aria-label="Disabled value" defaultValue="Unavailable" disabled />
    </div>
  ),
};

export const Neobrutalism: Story = {
  render: () => (
    <label className="grid w-80 gap-1 text-sm font-bold uppercase">
      <span>Playlist name</span>
      <Input theme="neobrutalism" aria-label="Playlist name" placeholder="MY PLAYLIST" />
    </label>
  ),
};
