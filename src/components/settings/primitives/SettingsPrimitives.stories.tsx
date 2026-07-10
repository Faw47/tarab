import type { Meta, StoryObj } from '@storybook/react-vite';
import { HardDrive, Shuffle } from 'lucide-react';
import { useState } from 'react';
import {
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
} from './SettingsPrimitives';

const meta = {
  title: 'Settings/Primitives',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;

type Story = StoryObj;

export const SectionHeaderWithIcon: Story = {
  render: function SectionHeaderWithIconStory() {
    const [enabled, setEnabled] = useState(true);
    const [pool, setPool] = useState(50);

    return (
      <div className="grid gap-6 md:grid-cols-2">
        <SettingsSection
          title="Queue and Shuffle"
          description="Tune shuffle memory without changing library data."
          icon={<Shuffle size={16} />}
        >
          <SettingsRow
            label="Shuffle history pool"
            description="How many recently played tracks to remember before repeating them."
            control={
              <SettingsSlider
                label="Shuffle history pool size"
                min={5}
                max={300}
                step={5}
                value={pool}
                valueLabel={`${pool} tracks`}
                onChange={setPool}
              />
            }
          />
          <SettingsSwitch
            label="Smart shuffle"
            description="Bias Shuffle All toward less-played tracks."
            checked={enabled}
            onChange={setEnabled}
          />
        </SettingsSection>

        <SettingsSection
          title="Output Device"
          description="Choose where Tarab sends audio."
          icon={<HardDrive size={16} />}
        >
          <SettingsRow
            label="Output device"
            description="Use the system default device or a detected output target."
            control={
              <SettingsSelect value="system" aria-label="Select audio output device">
                <option value="system">System default</option>
                <option value="headphones">Studio headphones</option>
              </SettingsSelect>
            }
          />
        </SettingsSection>
      </div>
    );
  },
};
