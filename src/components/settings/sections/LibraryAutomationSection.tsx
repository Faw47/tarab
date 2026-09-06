import { RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useSettingsStore } from '../../../store/settings-store';
import { SettingsSection, SettingsSwitch } from '../primitives';

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
      icon={<RefreshCw size={16} />}
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
            ? 'Send the track title, artist, album, and duration to LRCLIB when local lyrics are missing.'
            : 'Enable Lyrics in Appearance to display them.'
        }
      />
    </SettingsSection>
  );
});

LibraryAutomationSection.displayName = 'LibraryAutomationSection';
