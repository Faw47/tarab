export const isApplePlatform = (): boolean => {
  if (typeof navigator === 'undefined') return false;

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = `${nav.platform} ${nav.userAgent} ${nav.userAgentData?.platform ?? ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(platform);
};

export const getCommandPaletteShortcutLabel = (isMac = isApplePlatform()): string =>
  isMac ? '⌘K' : 'Ctrl+K';

export const getDirectionalShortcutLabel = (
  direction: 'next' | 'previous',
  isMac = isApplePlatform(),
): string => `${isMac ? '⌘' : 'Ctrl+'}${direction === 'next' ? '→' : '←'}`;
