export const RANKING_PREFERENCES = [
  { value: 'best-overall', label: 'Best Overall' },
  { value: 'smallest-acceptable', label: 'Smallest Acceptable' },
  { value: 'most-reliable', label: 'Most Reliable' },
  { value: 'prefer-1337x', label: 'Prefer 1337x' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'highest-quality', label: 'Highest quality' }
];

const PREFERENCE_ALIASES = {
  default: 'smallest-acceptable',
  smallest: 'smallest-acceptable',
  seeders: 'most-reliable',
  '1337x': 'prefer-1337x',
  quality: 'highest-quality'
};

const PREFERENCE_VALUES = new Set(RANKING_PREFERENCES.map(option => option.value));

export function normalizeRankingPreference(value) {
  const candidate = PREFERENCE_ALIASES[value] || value;
  return PREFERENCE_VALUES.has(candidate) ? candidate : 'smallest-acceptable';
}
