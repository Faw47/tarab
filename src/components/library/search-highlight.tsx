import type { ReactNode } from 'react';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toTerms = (query: string): string[] => {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 2);

  return Array.from(new Set(tokens)).sort((left, right) => right.length - left.length);
};

export function renderHighlightedText(
  value: string | null | undefined,
  query: string,
  markClassName: string,
): ReactNode {
  const text = value ?? '';
  if (!text) return '';

  const terms = toTerms(query);
  if (terms.length === 0) return text;

  const matcher = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'ig');
  const parts = text.split(matcher);
  if (parts.length <= 1) return text;

  return parts.map((part, index) => {
    if (!part) return null;
    const isMatch = terms.includes(part.toLowerCase());
    if (!isMatch) return <span key={`${index}-${part}`}>{part}</span>;
    return (
      <mark key={`${index}-${part}`} className={markClassName}>
        {part}
      </mark>
    );
  });
}
