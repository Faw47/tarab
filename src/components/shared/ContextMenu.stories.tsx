import type { Meta, StoryObj } from '@storybook/react-vite';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

const items: ContextMenuItem[] = [
  { id: 'play-next', label: 'Play next', onClick: () => {} },
  { id: 'add-to-queue', label: 'Add to queue', onClick: () => {} },
  { id: 'edit-tags', label: 'Edit tags', onClick: () => {} },
  { id: 'delete', label: 'Delete from disk', danger: true, onClick: () => {} },
];

const meta = {
  title: 'Shared/ContextMenu',
  component: ContextMenu,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof ContextMenu>;

export default meta;

type Story = StoryObj<typeof ContextMenu>;

export const Open: Story = {
  args: {
    position: { x: 32, y: 32 },
    items,
    onClose: () => {},
  },
  render: (args) => (
    <div className="relative min-h-72 bg-[var(--background)] p-8 text-[var(--foreground)]">
      <ContextMenu {...args} />
    </div>
  ),
};

export const DenseDanger: Story = {
  args: {
    position: { x: 32, y: 32 },
    items: [
      ...items,
      { id: 'reveal', label: 'Reveal in library', onClick: () => {} },
      { id: 'remove', label: 'Remove from queue', danger: true, onClick: () => {} },
    ],
    onClose: () => {},
  },
  render: Open.render,
};

export const Empty: Story = {
  args: {
    position: { x: 32, y: 32 },
    items: [],
    onClose: () => {},
  },
  render: Open.render,
};

export const Neobrutalism: Story = {
  globals: {
    theme: 'neobrutalism',
  },
  args: Open.args,
  render: Open.render,
};
