import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  AppearanceSettingsForm,
  DesktopIntegrationForm,
  PlaybackSettingsForm,
} from './SettingsForms';

const meta = {
  title: 'Settings/Forms',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;

type Story = StoryObj;

export const Playback: Story = {
  render: () => (
    <div className="grid gap-6 md:grid-cols-2">
      <PlaybackSettingsForm />
    </div>
  ),
};

export const Appearance: Story = {
  render: () => (
    <div className="grid gap-6 md:grid-cols-2">
      <AppearanceSettingsForm />
    </div>
  ),
};

export const DesktopIntegrations: Story = {
  render: () => (
    <div className="grid gap-6 md:grid-cols-2">
      <DesktopIntegrationForm />
    </div>
  ),
};
