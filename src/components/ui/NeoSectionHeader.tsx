import { memo } from 'react';

interface NeoSectionHeaderProps {
  emoji: string;
  label: string;
}

export const NeoSectionHeader = memo(({ emoji, label }: NeoSectionHeaderProps) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '16px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '2px solid #000',
    paddingBottom: '6px',
    marginBottom: '12px'
  }}>
    <span style={{ width: 10, height: 10, background: '#000', display: 'inline-block', flexShrink: 0 }} />
    <span style={{ fontSize: 14 }}>{emoji}</span>
    {label}
  </div>
));

NeoSectionHeader.displayName = 'NeoSectionHeader';
