import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PlaylistEditorForm } from './PlaylistEditorForm';

const baseArgs = {
  mode: 'create' as const,
  onCancel: fn(),
  onSave: fn(),
};

const meta = {
  title: 'Playlists/PlaylistEditorForm',
  component: PlaylistEditorForm,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof PlaylistEditorForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreateManual: Story = {
  args: baseArgs,
};

export const CreateSmart: Story = {
  args: {
    ...baseArgs,
    initial: {
      name: 'Recently Added',
      playlistType: 'Smart',
      smartRules: [{ RecentlyAdded: { days: 30 } }],
    },
  },
};

export const CreateFolderSync: Story = {
  args: {
    ...baseArgs,
    initial: {
      name: 'Arabic Library',
      playlistType: 'FolderSync',
      folderPath: 'C:/Music/Arabic',
    },
  },
};

export const Neobrutalism: Story = {
  args: baseArgs,
  globals: {
    theme: 'neobrutalism',
  },
};
