import { memo } from 'react';

interface NeoSectionHeaderProps {
  emoji: string;
  label: string;
}

export const NeoSectionHeader = memo(({ emoji, label }: NeoSectionHeaderProps) => (
  <div className="mb-3 flex items-center gap-1.5 border-b-2 border-black pb-1.5 text-base font-bold uppercase tracking-[0.06em] text-[var(--type-primary)]">
    <span className="inline-block h-2.5 w-2.5 shrink-0 bg-[var(--type-primary)]" />
    <span className="text-sm">{emoji}</span>
    {label}
  </div>
));

NeoSectionHeader.displayName = 'NeoSectionHeader';
