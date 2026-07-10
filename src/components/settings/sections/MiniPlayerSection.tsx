import { Monitor } from 'lucide-react';
import { memo } from 'react';
import { useSettingsStore } from '../../../store/settings-store';
import { SettingsSection, SettingsSwitch } from '../primitives';

export const MiniPlayerSection = memo(function MiniPlayerSection() {
  const miniPlayerVolumeVisible = useSettingsStore((s) => s.miniPlayerVolumeVisible);
  const miniPlayerCollapsed = useSettingsStore((s) => s.miniPlayerCollapsed);
  const setMiniPlayerVolumeVisible = useSettingsStore((s) => s.setMiniPlayerVolumeVisible);
  const setMiniPlayerCollapsed = useSettingsStore((s) => s.setMiniPlayerCollapsed);

  return (
    <SettingsSection
      title="Mini Player"
      description="Tune the compact always-on-top player surface."
      icon={<Monitor size={16} />}
    >
      <SettingsSwitch
        label="Show volume controls"
        checked={miniPlayerVolumeVisible}
        onChange={setMiniPlayerVolumeVisible}
        description="Show a volume control inside the mini player window."
      />
      <SettingsSwitch
        label="Collapse mini player"
        checked={miniPlayerCollapsed}
        onChange={setMiniPlayerCollapsed}
        description="Hide the mini player panel and show the compact pill widget instead."
      />
    </SettingsSection>
  );
});

MiniPlayerSection.displayName = 'MiniPlayerSection';
