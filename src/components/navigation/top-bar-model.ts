import { getNavigationLabel } from './navigation-model';

export { TOP_BAR_PRIMARY_VIEWS, TOP_BAR_SECONDARY_VIEWS } from './navigation-model';

export interface TopBarProcessingTask {
  label: string;
  progress?: number;
}

export function getTopBarLabel(view: string): string | null {
  return getNavigationLabel(view);
}

export interface TopBarStatus {
  label: string;
  shortLabel: string;
  progressText: string | null;
  progressValue: number | null;
}

export const TOP_BAR_SHORTCUT = {
  shortcutLabel: '/',
  ariaShortcut: 'Slash',
} as const;

const clampProgress = (value: number): number => Math.min(100, Math.max(0, value));

export function getTopBarStatus({
  isScanning,
  scanProgress,
  activeProcessing,
  scanningLabel = 'Scanning library',
  workingShortLabel = 'Working',
}: {
  isScanning: boolean;
  scanProgress: number;
  activeProcessing?: TopBarProcessingTask;
  scanningLabel?: string;
  workingShortLabel?: string;
}): TopBarStatus | null {
  if (isScanning) {
    const progressValue = scanProgress > 0 ? clampProgress(Math.round(scanProgress)) : null;
    return {
      label: activeProcessing?.label ?? scanningLabel,
      shortLabel: 'Scanning',
      progressText: progressValue == null ? null : `${progressValue}%`,
      progressValue,
    };
  }

  if (activeProcessing) {
    const progressValue =
      typeof activeProcessing.progress === 'number'
        ? clampProgress(Math.round(activeProcessing.progress))
        : null;
    return {
      label: activeProcessing.label,
      shortLabel: workingShortLabel,
      progressText: progressValue == null ? null : `${progressValue}%`,
      progressValue,
    };
  }

  return null;
}

export function shouldShowShuffle(currentView: string, onShuffleAll?: () => void): boolean {
  return onShuffleAll != null && (currentView === 'library' || currentView === 'search');
}
