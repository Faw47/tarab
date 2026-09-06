import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { Eye, HardDrive, Layout, ListMusic, Monitor, RefreshCw, Shuffle } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  SettingsActionButton,
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
} from '../../../components/settings/primitives';
import { Input } from '../../../components/ui';
import { liquidGlassSettingsTextInputClassName } from '../../../lib/liquid-glass-settings-ui';
import { reportError } from '../../../lib/report-error';
import { type AudioOutputDeviceInfo, listAudioOutputDevices } from '../../../lib/tauri-commands';
import { cn } from '../../../lib/utils';
import { DEFAULT_SHORTCUTS, useSettingsStore } from '../../../store/settings-store';

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
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const devicesRequestIdRef = useRef(0);

  const refreshDevices = useCallback(async () => {
    const requestId = ++devicesRequestIdRef.current;
    setIsLoadingDevices(true);
    try {
      const list = await listAudioOutputDevices();
      if (requestId !== devicesRequestIdRef.current) return;
      setDevices(list);
      setDevicesError(null);
    } catch (err) {
      if (requestId !== devicesRequestIdRef.current) return;
      setDevicesError(err instanceof Error ? err.message : 'Failed to list audio output devices');
    } finally {
      if (requestId === devicesRequestIdRef.current) setIsLoadingDevices(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    return () => {
      devicesRequestIdRef.current += 1;
    };
  }, [refreshDevices]);

  useEffect(() => {
    if (devices.length === 0) return;
    const ids = new Set(devices.map((d) => d.id));
    if (outputDevice === 'system' || ids.has(outputDevice)) return;
    const legacyMatches = devices.filter((device) => device.name === outputDevice);
    setOutputDevice(legacyMatches.length === 1 ? legacyMatches[0]!.id : 'system');
  }, [devices, outputDevice, setOutputDevice]);

  const handleOutputDeviceChange = (deviceId: string) => {
    setOutputDevice(deviceId);
  };

  const outputDevices = useMemo(() => {
    const seen = new Set<string>();
    const unique = [{ id: 'system', name: 'System default' }, ...devices].filter((device) => {
      if (seen.has(device.id)) return false;
      seen.add(device.id);
      return true;
    });
    if (devicesError && outputDevice !== 'system' && !seen.has(outputDevice)) {
      unique.push({ id: outputDevice, name: 'Saved device (unavailable)' });
    }
    const nameCounts = new Map<string, number>();
    for (const device of unique) {
      nameCounts.set(device.name, (nameCounts.get(device.name) ?? 0) + 1);
    }
    const nameOccurrences = new Map<string, number>();
    return unique.map((device) => {
      if ((nameCounts.get(device.name) ?? 0) < 2) return device;
      const occurrence = (nameOccurrences.get(device.name) ?? 0) + 1;
      nameOccurrences.set(device.name, occurrence);
      return { ...device, name: `${device.name} (${occurrence})` };
    });
  }, [devices, devicesError, outputDevice]);

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
        icon={<Shuffle size={16} />}
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
        actions={
          <SettingsActionButton
            size="sm"
            tone="ghost"
            onClick={() => void refreshDevices()}
            disabled={isLoadingDevices}
            aria-label="Refresh audio output devices"
            title="Refresh audio output devices"
          >
            <RefreshCw size={14} className={isLoadingDevices ? 'animate-spin' : undefined} />{' '}
            Refresh
          </SettingsActionButton>
        }
      >
        <SettingsRow
          label="Output device"
          description={devicesError ?? 'Use the system default device or a detected output target.'}
          control={
            <SettingsSelect
              value={outputDevice}
              onChange={(value) => void handleOutputDeviceChange(value)}
              aria-label="Select audio output device"
            >
              {outputDevices.map((d) => (
                <option
                  key={d.id}
                  value={d.id}
                  disabled={d.id === outputDevice && Boolean(devicesError)}
                >
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

  const autostartRevisionRef = useRef(0);
  const autostartDesiredRef = useRef(autostartEnabled);
  const autostartOsStateRef = useRef<boolean | null>(null);
  const autostartInitialReadRef = useRef<Promise<void>>(Promise.resolve());
  const autostartQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autostartMountedRef = useRef(false);
  const skipNextShortcutCommitRef = useRef(false);
  const [settingsHydrated, setSettingsHydrated] = useState(() =>
    useSettingsStore.persist.hasHydrated(),
  );

  const [draftPlayPause, setDraftPlayPause] = useState(shortcuts.playPause);
  const [draftNext, setDraftNext] = useState(shortcuts.next);
  const [draftPrevious, setDraftPrevious] = useState(shortcuts.previous);

  useEffect(() => {
    setDraftPlayPause(shortcuts.playPause);
    setDraftNext(shortcuts.next);
    setDraftPrevious(shortcuts.previous);
  }, [shortcuts]);

  const shouldSkipShortcutCommit = useCallback(() => {
    if (!skipNextShortcutCommitRef.current) return false;
    skipNextShortcutCommitRef.current = false;
    return true;
  }, []);

  const handleCommitPlayPause = useCallback(() => {
    if (shouldSkipShortcutCommit()) return;
    const nextValue = draftPlayPause.trim() || DEFAULT_SHORTCUTS.playPause;
    setDraftPlayPause(nextValue);
    setShortcut('playPause', nextValue);
  }, [draftPlayPause, setShortcut, shouldSkipShortcutCommit]);

  const handleCommitNext = useCallback(() => {
    if (shouldSkipShortcutCommit()) return;
    const nextValue = draftNext.trim() || DEFAULT_SHORTCUTS.next;
    setDraftNext(nextValue);
    setShortcut('next', nextValue);
  }, [draftNext, setShortcut, shouldSkipShortcutCommit]);

  const handleCommitPrevious = useCallback(() => {
    if (shouldSkipShortcutCommit()) return;
    const nextValue = draftPrevious.trim() || DEFAULT_SHORTCUTS.previous;
    setDraftPrevious(nextValue);
    setShortcut('previous', nextValue);
  }, [draftPrevious, setShortcut, shouldSkipShortcutCommit]);

  const handleShortcutInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, resetDraft: () => void) => {
      if (event.key === 'Enter') {
        event.currentTarget.blur();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        skipNextShortcutCommitRef.current = true;
        resetDraft();
        event.currentTarget.blur();
      }
    },
    [],
  );

  useEffect(() => {
    const unsubscribe = useSettingsStore.persist.onFinishHydration(() => {
      setSettingsHydrated(true);
    });
    if (useSettingsStore.persist.hasHydrated()) setSettingsHydrated(true);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    let active = true;
    autostartMountedRef.current = true;
    const readRevision = autostartRevisionRef.current;
    autostartInitialReadRef.current = isEnabled()
      .then((currentlyEnabled) => {
        if (!active) return;
        autostartOsStateRef.current = currentlyEnabled;
        if (autostartRevisionRef.current !== readRevision) return;
        autostartDesiredRef.current = currentlyEnabled;
        if (useSettingsStore.getState().autostartEnabled !== currentlyEnabled) {
          setAutostartEnabled(currentlyEnabled);
        }
      })
      .catch((error) => {
        if (!active) return;
        reportError('Failed to read open at login setting', {
          source: 'desktop-settings',
          error,
        });
      });

    return () => {
      active = false;
      autostartMountedRef.current = false;
      autostartRevisionRef.current += 1;
    };
  }, [setAutostartEnabled, settingsHydrated]);

  const handleAutostartChange = useCallback(
    (enabled: boolean) => {
      autostartDesiredRef.current = enabled;
      const revision = ++autostartRevisionRef.current;
      setAutostartEnabled(enabled);

      const applyIntent = async () => {
        await autostartInitialReadRef.current;
        if (
          !autostartMountedRef.current ||
          autostartRevisionRef.current !== revision ||
          autostartDesiredRef.current !== enabled
        ) {
          return;
        }
        if (autostartOsStateRef.current === enabled) return;

        try {
          if (enabled) await enable();
          else await disable();
          autostartOsStateRef.current = enabled;
        } catch (error) {
          let actualState = autostartOsStateRef.current;
          try {
            actualState = await isEnabled();
            autostartOsStateRef.current = actualState;
          } catch {
            // Keep the last confirmed OS state when reconciliation cannot be read back.
          }

          if (
            autostartMountedRef.current &&
            autostartRevisionRef.current === revision &&
            actualState !== null
          ) {
            autostartDesiredRef.current = actualState;
            setAutostartEnabled(actualState);
          }
          reportError('Failed to sync open at login', {
            source: 'desktop-settings',
            error,
          });
        }
      };

      autostartQueueRef.current = autostartQueueRef.current.then(applyIntent, applyIntent);
    },
    [setAutostartEnabled],
  );

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
        onChange={handleAutostartChange}
        disabled={!settingsHydrated}
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
              <Input
                type="text"
                value={draftPlayPause}
                aria-label="Play/Pause shortcut"
                onChange={(e) => setDraftPlayPause(e.target.value)}
                onBlur={handleCommitPlayPause}
                onKeyDown={(e) =>
                  handleShortcutInputKeyDown(e, () => setDraftPlayPause(shortcuts.playPause))
                }
                className={shortcutInputClassName}
              />
            }
          />
          <SettingsRow
            label="Next shortcut"
            control={
              <Input
                type="text"
                value={draftNext}
                aria-label="Next shortcut"
                onChange={(e) => setDraftNext(e.target.value)}
                onBlur={handleCommitNext}
                onKeyDown={(e) => handleShortcutInputKeyDown(e, () => setDraftNext(shortcuts.next))}
                className={shortcutInputClassName}
              />
            }
          />
          <SettingsRow
            label="Previous shortcut"
            control={
              <Input
                type="text"
                value={draftPrevious}
                aria-label="Previous shortcut"
                onChange={(e) => setDraftPrevious(e.target.value)}
                onBlur={handleCommitPrevious}
                onKeyDown={(e) =>
                  handleShortcutInputKeyDown(e, () => setDraftPrevious(shortcuts.previous))
                }
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

  const showLiquidDebugControl =
    debugLiquidControlGlass ||
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debugLiquidGlass') === '1');

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
        {theme === 'liquid-glass' && showLiquidDebugControl ? (
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
