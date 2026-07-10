import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConfirmDialog } from './ConfirmDialog';
import { InputDialog } from './InputDialog';

const noop = () => {};

const meta = {
  title: 'UI/Dialogs',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => (
    <div className="min-h-96 bg-[var(--background)] p-8 text-[var(--foreground)]">
      <ConfirmDialog
        title="Remove selected tracks?"
        message="This removes the tracks from the current playlist."
        confirmLabel="Remove"
        onConfirm={noop}
        onCancel={noop}
      />
    </div>
  ),
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const ConfirmDefault: Story = {};

export const ConfirmDanger: Story = {
  render: () => (
    <div className="min-h-96 bg-[var(--background)] p-8 text-[var(--foreground)]">
      <ConfirmDialog
        title="Delete files from disk?"
        message="This cannot be undone."
        detail="C:\\Music\\Albums\\Selected Track.flac"
        confirmLabel="Delete"
        variant="danger"
        onConfirm={noop}
        onCancel={noop}
      />
    </div>
  ),
};

export const TextInput: Story = {
  render: () => (
    <div className="min-h-96 bg-[var(--background)] p-8 text-[var(--foreground)]">
      <InputDialog
        title="Rename playlist"
        label="Playlist name"
        initialValue="Late night finds"
        placeholder="Playlist name"
        submitLabel="Rename"
        onSubmit={noop}
        onCancel={noop}
      />
    </div>
  ),
};

export const EmptyInputDisabled: Story = {
  render: () => (
    <div className="min-h-96 bg-[var(--background)] p-8 text-[var(--foreground)]">
      <InputDialog
        title="Create playlist"
        label="Playlist name"
        placeholder="Playlist name"
        submitLabel="Create"
        onSubmit={noop}
        onCancel={noop}
      />
    </div>
  ),
};

export const DangerNeobrutalism: Story = {
  globals: {
    theme: 'neobrutalism',
  },
  render: ConfirmDanger.render,
};
