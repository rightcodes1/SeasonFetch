export const RANKING_PREFERENCES = [
  { value: 'best-overall', label: 'Best Overall', description: 'Balance quality, file size, seeders, and metadata completeness.' },
  { value: 'smallest-acceptable', label: 'Smallest Acceptable', description: 'Prioritize the smallest known file size among eligible sources.' },
  { value: 'most-reliable', label: 'Most Reliable', description: 'Prioritize the strongest known seeder evidence among eligible sources.' },
  { value: 'prefer-1337x', label: 'Prefer 1337x', description: 'Give 1337x provider evidence extra weight while retaining the other ranking signals.' },
  { value: 'balanced', label: 'Balanced', description: 'Give quality, size, seeders, and metadata completeness equal weight.' },
  { value: 'highest-quality', label: 'Highest quality', description: 'Prioritize resolution and supported quality signals among eligible sources.' }
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

export function rankingPreferenceDescription(value) {
  const preference = normalizeRankingPreference(value);
  return RANKING_PREFERENCES.find(option => option.value === preference).description;
}
