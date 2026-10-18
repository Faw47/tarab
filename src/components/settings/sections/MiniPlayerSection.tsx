import { Monitor } from 'lucide-react';
import { memo } from 'react';
import { useSettingsStore } from '../../../store/settings-store';
import { SettingsSection, SettingsSwitch } from '../primitives';

export const MiniPlayerSection = memo(function MiniPlayerSection() {
  const miniPlayerVolumeVisible = useSettingsStore((s) => s.miniPlayerVolumeVisible);
  const miniPlayerCollapsed = useSettingsStore((s) => s.miniPlayerCollapsed);
  const setMiniPlayerVolumeVisible = useSettingsStore((s) => s.setMiniPlayerVolumeVisible);
  const setMiniPlayerCollapsed = useSettingsStore((s) => s.setMiniPlayerCollapsed);
  const isNeobrutalism = useSettingsStore((s) => s.theme === 'neobrutalism');

  // These settings shape the in-app player bar at the bottom of the window, not the separate
  // always-on-top mini window (Desktop settings).
  return (
    <SettingsSection
      title="Now Playing Bar"
      description="The player bar at the bottom of the window. The Liquid theme hides it on Home, which has its own player."
      icon={<Monitor size={16} />}
    >
      <SettingsSwitch
        label="Show volume controls"
        checked={miniPlayerVolumeVisible}
        onChange={setMiniPlayerVolumeVisible}
        description="Show a volume control in the player bar."
      />
      {isNeobrutalism ? null : (
        <SettingsSwitch
          label="Collapse to a floating pill"
          checked={miniPlayerCollapsed}
          onChange={setMiniPlayerCollapsed}
          description="Replace the player bar with a small floating pill."
        />
      )}
    </SettingsSection>
  );
});

MiniPlayerSection.displayName = 'MiniPlayerSection';
