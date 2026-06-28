import { memo } from 'react';

import { SettingsSection, SettingsSwitch } from '../primitives';
import { useSettingsStore } from '../../../store/settings-store';

export const LibraryAutomationSection = memo(function LibraryAutomationSection() {
  const autoWatch = useSettingsStore((s) => s.autoWatch);
  const autoLyrics = useSettingsStore((s) => s.autoLyrics);
  const setAutoWatch = useSettingsStore((s) => s.setAutoWatch);
  const setAutoLyrics = useSettingsStore((s) => s.setAutoLyrics);
  const lyricsEnabled = useSettingsStore((s) => s.lyricsEnabled);

  return (
    <SettingsSection
      title="Watchers"
      description="Automation that keeps library metadata current after folders are added."
      className="md:col-span-2"
    >
      <SettingsSwitch
        label="Auto-watch library folders"
        checked={autoWatch}
        onChange={setAutoWatch}
        description="Continuously scan watched folders and update the library index when files change."
      />
      <SettingsSwitch
        label="Auto-fetch lyrics"
        checked={autoLyrics}
        onChange={setAutoLyrics}
        description={
          lyricsEnabled
            ? 'Automatically fetch missing lyrics when available.'
            : 'Enable Lyrics in Appearance to display them.'
        }
      />
    </SettingsSection>
  );
});

LibraryAutomationSection.displayName = 'LibraryAutomationSection';
