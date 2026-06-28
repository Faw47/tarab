import { memo } from 'react';

import { Subtitles } from 'lucide-react';

import {
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
} from '../primitives';
import { useSettingsStore } from '../../../store/settings-store';

export const FullscreenPlayerSection = memo(function FullscreenPlayerSection() {
  const fullscreenHideCoverArt = useSettingsStore((s) => s.fullscreenHideCoverArt);
  const setFullscreenHideCoverArt = useSettingsStore((s) => s.setFullscreenHideCoverArt);

  const fullscreenLyricSize = useSettingsStore((s) => s.fullscreenLyricSize);
  const setFullscreenLyricSize = useSettingsStore((s) => s.setFullscreenLyricSize);

  const fullscreenLyricAlignment = useSettingsStore((s) => s.fullscreenLyricAlignment);
  const setFullscreenLyricAlignment = useSettingsStore((s) => s.setFullscreenLyricAlignment);

  const fullscreenBackgroundAnimation = useSettingsStore((s) => s.fullscreenBackgroundAnimation);
  const setFullscreenBackgroundAnimation = useSettingsStore((s) => s.setFullscreenBackgroundAnimation);

  const fullscreenBackgroundBlur = useSettingsStore((s) => s.fullscreenBackgroundBlur);
  const setFullscreenBackgroundBlur = useSettingsStore((s) => s.setFullscreenBackgroundBlur);

  return (
    <SettingsSection
      title="Fullscreen Player"
      description="Tune cover treatment, lyrics, and background motion."
      icon={<Subtitles size={16} />}
      className="md:col-span-2"
    >
      <SettingsSwitch
        label="Hide cover art"
        checked={fullscreenHideCoverArt}
        onChange={setFullscreenHideCoverArt}
        description="Remove the cover-art panel in fullscreen mode."
      />
      <SettingsRow
        label="Lyric size"
        control={
          <SettingsSlider
            label="Fullscreen lyric size"
            min={1}
            max={100}
            step={1}
            value={fullscreenLyricSize}
            valueLabel={`${fullscreenLyricSize}px`}
            onChange={setFullscreenLyricSize}
          />
        }
      />
      <SettingsRow
        label="Lyric alignment"
        control={
          <SettingsSelect
            value={fullscreenLyricAlignment}
            onChange={(e) => setFullscreenLyricAlignment(e.target.value as 'left' | 'center' | 'right')}
            aria-label="Fullscreen lyric alignment"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </SettingsSelect>
        }
      />
      <SettingsRow
        label="Background animation"
        control={
          <SettingsSelect
            value={fullscreenBackgroundAnimation}
            onChange={(e) => setFullscreenBackgroundAnimation(e.target.value as 'pan' | 'pulse' | 'none')}
            aria-label="Fullscreen background animation"
          >
            <option value="pan">Pan</option>
            <option value="pulse">Pulse</option>
            <option value="none">None</option>
          </SettingsSelect>
        }
      />
      <SettingsRow
        label="Background blur"
        control={
          <SettingsSlider
            label="Fullscreen background blur"
            min={0}
            max={50}
            step={1}
            value={fullscreenBackgroundBlur}
            valueLabel={`${fullscreenBackgroundBlur}px`}
            onChange={setFullscreenBackgroundBlur}
          />
        }
      />
    </SettingsSection>
  );
});

FullscreenPlayerSection.displayName = 'FullscreenPlayerSection';
