const englishPluralRules = new Intl.PluralRules('en');

export const formatCountLabel = (
  count: number,
  singular: string,
  plural = `${singular}s`,
): string => {
  const unit = englishPluralRules.select(count) === 'one' ? singular : plural;
  return `${count.toLocaleString()} ${unit}`;
};
