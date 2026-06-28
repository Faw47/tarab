import { Eye, HardDrive, Layout, ListMusic, Monitor } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';

import {
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
} from '../../../components/settings/primitives';
import { liquidGlassSettingsTextInputClassName } from '../../../lib/liquid-glass-settings-ui';
import { cn } from '../../../lib/utils';
import {
  listAudioOutputDevices,
  setAudioOutputDevice,
  type AudioOutputDeviceInfo,
} from '../../../lib/tauri-commands';
import { useSettingsStore } from '../../../store/settings-store';

/* --- PLAYBACK ------------------------------------------------------------ */

export const PlaybackSettingsForm = memo(() => {
  const gapless = useSettingsStore((s) => s.gapless);
  const crossfadeSeconds = useSettingsStore((s) => s.crossfadeSeconds);
  const shuffleHistorySize = useSettingsStore((s) => s.shuffleHistorySize);
  const smartShuffleEnabled = useSettingsStore((s) => s.smartShuffleEnabled);

  const setGapless = useSettingsStore((s) => s.setGapless);
  const setCrossfadeSeconds = useSettingsStore((s) => s.setCrossfadeSeconds);
  const setShuffleHistorySize = useSettingsStore((s) => s.setShuffleHistorySize);
  const setSmartShuffleEnabled = useSettingsStore((s) => s.setSmartShuffleEnabled);
  
  const outputDevice = useSettingsStore((s) => s.outputDevice);
  const setOutputDevice = useSettingsStore((s) => s.setOutputDevice);

  const [devices, setDevices] = useState<AudioOutputDeviceInfo[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listAudioOutputDevices()
      .then((list) => {
        if (cancelled) return;
        setDevices(list);
        setDevicesError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setDevicesError(err instanceof Error ? err.message : 'Failed to list audio output devices');
        setDevices([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (devices.length === 0) return;
    const ids = new Set(devices.map((d) => d.id));
    if (outputDevice !== 'system' && !ids.has(outputDevice)) setOutputDevice('system');
  }, [devices, outputDevice, setOutputDevice]);

  const handleOutputDeviceChange = async (deviceId: string) => {
    setOutputDevice(deviceId);
    try {
      await setAudioOutputDevice(deviceId);
    } catch {
      // Keep the stored preference even if this device cannot be applied immediately.
    }
  };

  const outputDevices = useMemo(() => {
    const seen = new Set<string>();
    return devices.filter((device) => {
      if (seen.has(device.id)) return false;
      seen.add(device.id);
      return true;
    });
  }, [devices]);

  return (
    <>
      <SettingsSection
        title="Transition"
        description="Control how track boundaries behave during continuous playback."
        icon={<ListMusic size={16} />}
      >
        <SettingsSwitch
          label="Gapless playback"
          checked={gapless}
          onChange={setGapless}
          description="Eliminate silence between tracks when possible."
        />
        <SettingsRow
          label="Crossfade"
          description="Blend the outgoing and incoming track for smoother transitions."
          control={
            <SettingsSlider
              label="Crossfade duration"
              min={0}
              max={12}
              step={1}
              value={crossfadeSeconds}
              valueLabel={`${crossfadeSeconds}s`}
              onChange={setCrossfadeSeconds}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Queue and Shuffle"
        description="Tune shuffle memory without changing library data."
      >
        <SettingsRow
          label="Shuffle history pool"
          description="How many recently played tracks to remember before repeating them in shuffle mode."
          control={
            <SettingsSlider
              label="Shuffle history pool size"
              min={5}
              max={300}
              step={5}
              value={shuffleHistorySize}
              valueLabel={`${shuffleHistorySize} tracks`}
              onChange={setShuffleHistorySize}
            />
          }
        />
        <SettingsSwitch
          label="Smart shuffle"
          checked={smartShuffleEnabled}
          onChange={setSmartShuffleEnabled}
          description="Bias Shuffle All toward less-played tracks and titles not heard in 7+ days."
        />
      </SettingsSection>

      <SettingsSection
        title="Output Device"
        description="Choose where Tarab sends audio."
        icon={<HardDrive size={16} />}
      >
        <SettingsRow
          label="Output device"
          description={devicesError ?? 'Use the system default device or a detected output target.'}
          control={
            <SettingsSelect
              value={outputDevice}
              onChange={(e) => void handleOutputDeviceChange(e.target.value)}
              aria-label="Select audio output device"
            >
              {outputDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SettingsSelect>
          }
        />
      </SettingsSection>
    </>
  );
});
PlaybackSettingsForm.displayName = 'PlaybackSettingsForm';

/* --- DESKTOP ------------------------------------------------------------- */

export const DesktopIntegrationForm = memo(() => {
  const isNeobrutalism = useSettingsStore((s) => s.theme === 'neobrutalism');
  const desktopStatusIconEnabled = useSettingsStore((s) => s.desktopStatusIconEnabled);
  const desktopMediaKeysEnabled = useSettingsStore((s) => s.desktopMediaKeysEnabled);
  const desktopMiniWindowEnabled = useSettingsStore((s) => s.desktopMiniWindowEnabled);
  const hideToStatusIconOnClose = useSettingsStore((s) => s.hideToStatusIconOnClose);
  const globalShortcutsEnabled = useSettingsStore((s) => s.globalShortcutsEnabled);
  const shortcuts = useSettingsStore((s) => s.shortcuts);
  const autostartEnabled = useSettingsStore((s) => s.autostartEnabled);

  const setDesktopStatusIconEnabled = useSettingsStore((s) => s.setDesktopStatusIconEnabled);
  const setDesktopMediaKeysEnabled = useSettingsStore((s) => s.setDesktopMediaKeysEnabled);
  const setDesktopMiniWindowEnabled = useSettingsStore((s) => s.setDesktopMiniWindowEnabled);
  const setHideToStatusIconOnClose = useSettingsStore((s) => s.setHideToStatusIconOnClose);
  const setGlobalShortcutsEnabled = useSettingsStore((s) => s.setGlobalShortcutsEnabled);
  const setShortcut = useSettingsStore((s) => s.setShortcut);
  const setAutostartEnabled = useSettingsStore((s) => s.setAutostartEnabled);

  const [draftPlayPause, setDraftPlayPause] = useState(shortcuts.playPause);
  const [draftNext, setDraftNext] = useState(shortcuts.next);
  const [draftPrevious, setDraftPrevious] = useState(shortcuts.previous);

  useEffect(() => {
    setDraftPlayPause(shortcuts.playPause);
    setDraftNext(shortcuts.next);
    setDraftPrevious(shortcuts.previous);
  }, [shortcuts]);

  const handleCommitPlayPause = useCallback(() => {
    setShortcut('playPause', draftPlayPause);
  }, [draftPlayPause, setShortcut]);

  const handleCommitNext = useCallback(() => {
    setShortcut('next', draftNext);
  }, [draftNext, setShortcut]);

  const handleCommitPrevious = useCallback(() => {
    setShortcut('previous', draftPrevious);
  }, [draftPrevious, setShortcut]);

  useEffect(() => {
    const syncAutostart = async () => {
      try {
        const currentlyEnabled = await isEnabled();
        if (currentlyEnabled !== autostartEnabled) {
          if (autostartEnabled) await enable();
          else await disable();
        }
      } catch (e) {
        console.error('Failed to sync autostart', e);
      }
    };
    void syncAutostart();
  }, [autostartEnabled]);

  const shortcutInputClassName = cn(
    'w-full max-w-[14rem] outline-none transition-colors',
    isNeobrutalism
      ? 'rounded-none border-2 border-black bg-white px-2 py-1.5 text-xs text-black'
      : liquidGlassSettingsTextInputClassName('px-2 py-1.5 text-xs font-medium'),
  );

  return (
    <SettingsSection
      title="Tray, Media Keys, and Shortcuts"
      description="Configure the system integrations Tarab can control outside the main window."
      icon={<Monitor size={16} />}
    >
      <SettingsSwitch
        label="Open at login"
        description="Start Tarab automatically when you log in."
        checked={autostartEnabled}
        onChange={setAutostartEnabled}
      />
      <SettingsSwitch
        label="Status icon"
        description="Show a system status icon with playback controls."
        checked={desktopStatusIconEnabled}
        onChange={setDesktopStatusIconEnabled}
      />
      <SettingsSwitch
        label="Media keys"
        description="Handle hardware media keys and OS transport actions."
        checked={desktopMediaKeysEnabled}
        onChange={setDesktopMediaKeysEnabled}
      />
      <SettingsSwitch
        label="Custom global shortcuts"
        description="Configure custom system-wide key combinations."
        checked={globalShortcutsEnabled}
        onChange={setGlobalShortcutsEnabled}
      />

      {globalShortcutsEnabled ? (
        <>
          <SettingsRow
            label="Play/Pause shortcut"
            control={
              <input
                type="text"
                value={draftPlayPause}
                onChange={(e) => setDraftPlayPause(e.target.value)}
                onBlur={handleCommitPlayPause}
                className={shortcutInputClassName}
              />
            }
          />
          <SettingsRow
            label="Next shortcut"
            control={
              <input
                type="text"
                value={draftNext}
                onChange={(e) => setDraftNext(e.target.value)}
                onBlur={handleCommitNext}
                className={shortcutInputClassName}
              />
            }
          />
          <SettingsRow
            label="Previous shortcut"
            control={
              <input
                type="text"
                value={draftPrevious}
                onChange={(e) => setDraftPrevious(e.target.value)}
                onBlur={handleCommitPrevious}
                className={shortcutInputClassName}
              />
            }
          />
        </>
      ) : null}

      <SettingsSwitch
        label="Mini window"
        description="Allow compact always-on-top mini player window."
        checked={desktopMiniWindowEnabled}
        onChange={setDesktopMiniWindowEnabled}
      />
      <SettingsSwitch
        label="Hide on close"
        description="Hide to status icon instead of quitting."
        checked={hideToStatusIconOnClose}
        onChange={setHideToStatusIconOnClose}
      />
    </SettingsSection>
  );
});
DesktopIntegrationForm.displayName = 'DesktopIntegrationForm';

/* --- APPEARANCE ---------------------------------------------------------- */

export const AppearanceSettingsForm = memo(() => {
  const theme = useSettingsStore((s) => s.theme);
  const lyricsEnabled = useSettingsStore((s) => s.lyricsEnabled);
  const backgroundEnabled = useSettingsStore((s) => s.backgroundEnabled);
  const reducedEffects = useSettingsStore((s) => s.reducedEffects);
  const debugLiquidControlGlass = useSettingsStore((s) => s.debugLiquidControlGlass);
  const compactMode = useSettingsStore((s) => s.compactMode);
  const fullscreenPlayerLayout = useSettingsStore((s) => s.fullscreenPlayerLayout);
  const navMode = useSettingsStore((s) => s.navMode);

  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLyricsEnabled = useSettingsStore((s) => s.setLyricsEnabled);
  const setBackgroundEnabled = useSettingsStore((s) => s.setBackgroundEnabled);
  const setReducedEffects = useSettingsStore((s) => s.setReducedEffects);
  const setDebugLiquidControlGlass = useSettingsStore((s) => s.setDebugLiquidControlGlass);
  const setCompactMode = useSettingsStore((s) => s.setCompactMode);
  const setFullscreenPlayerLayout = useSettingsStore((s) => s.setFullscreenPlayerLayout);
  const setNavMode = useSettingsStore((s) => s.setNavMode);

  return (
    <>
      <SettingsSection
        title="Theme and Effects"
        description="Keep the visual system aligned with the active app theme."
        icon={<Eye size={16} />}
      >
        <SettingsRow
          label="App theme"
          description="Switch between Tarab's glass and neobrutalist modes."
          control={
            <SettingsSegmentedControl
              ariaLabel="App theme"
              value={theme}
              onChange={(nextTheme) => setTheme(nextTheme)}
              options={[
                { value: 'liquid-glass', label: 'Liquid' },
                { value: 'neobrutalism', label: 'Neo' },
              ]}
            />
          }
        />
        <SettingsSwitch label="Show lyrics" checked={lyricsEnabled} onChange={setLyricsEnabled} />
        <SettingsSwitch
          label="Animated background"
          checked={backgroundEnabled}
          onChange={setBackgroundEnabled}
          description="Use blurred cover art as a reactive background."
        />
        <SettingsSwitch
          label="Reduced effects"
          checked={reducedEffects}
          onChange={setReducedEffects}
          description="Reduce heavier motion and visual effects."
        />
        {theme === 'liquid-glass' ? (
          <SettingsSwitch
            label="Debug liquid tab glass"
            checked={debugLiquidControlGlass}
            onChange={setDebugLiquidControlGlass}
            description="Exaggerate GPU tab pill refraction and glare. URL: ?debugLiquidGlass=1"
          />
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Layout"
        description="Adjust density, player layout, and app navigation."
        icon={<Layout size={16} />}
      >
        <SettingsSwitch label="Compact mode" checked={compactMode} onChange={setCompactMode} />
        <SettingsSwitch
          label="Fullscreen layout"
          checked={fullscreenPlayerLayout}
          onChange={setFullscreenPlayerLayout}
          description="Use a two-column fullscreen player view."
        />
        <SettingsRow
          label="Navigation style"
          control={
            <SettingsSegmentedControl
              ariaLabel="Navigation style"
              value={navMode}
              onChange={(nextMode) => setNavMode(nextMode)}
              options={[
                { value: 'iconRail', label: 'Rail' },
                { value: 'topNav', label: 'Top Bar' },
              ]}
            />
          }
        />
      </SettingsSection>
    </>
  );
});
AppearanceSettingsForm.displayName = 'AppearanceSettingsForm';
