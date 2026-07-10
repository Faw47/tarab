import { useHotkeys } from 'react-hotkeys-hook';

interface HotkeysBootstrapProps {
  onSearch?: () => void;
}

function isTextEntryTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable]') !== null
  );
}

export function HotkeysBootstrap({ onSearch }: HotkeysBootstrapProps) {
  useHotkeys(
    'slash',
    (e) => {
      if (isTextEntryTarget(e.target)) return;
      e.preventDefault();
      onSearch?.();
    },
    {
      scopes: ['global'],
    },
    [onSearch],
  );

  return null;
}
