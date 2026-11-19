import { useEffect, useMemo, useRef, useState } from 'react';
import { cinemeta } from './services/cinemeta.js';
import { torrentio } from './services/torrentio.js';
import AuthPanel from './components/AuthPanel.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import AccountMenu from './components/AccountMenu.jsx';
import { supabase } from './services/supabase.js';

const SERIES = [
  {
    id: 'breaking-bad',
    imdbId: 'tt0903747',
    title: 'Breaking Bad',
    year: '2008',
    seasons: 5,
    type: 'Drama · Crime',
    rating: '9.5',
    accent: 'purple',
    initials: 'BB',
    posterLabel: 'Heisenberg',
    genres: ['Crime', 'Drama', 'Thriller'],
    synopsis: 'A high school chemistry teacher turned methamphetamine manufacturer navigates a dangerous new world with his former student.',
    episodes: {
      1: [
        ['Pilot', '4.2 GB', 'selected', '1080p WEB-DL · x265', 'a1b2c3d4e5f6789012345678901234567890abcd'],
        ["Cat\'s in the Bag...", '1.1 GB', 'selected', '1080p WEB-DL · x265', 'b2c3d4e5f6789012345678901234567890abcdea'],
        ['...And the Bag\'s in the River', '—', 'unavailable', '', ''],
        ['Cancer Man', '2.4 GB', 'selected', '1080p HDTV · x264', 'c3d4e5f6789012345678901234567890abcdeab2'],
        ['Gray Matter', '890 MB', 'size-unknown', '1080p WEB-DL', 'd4e5f6789012345678901234567890abcdeab2c3'],
        ['Crazy Handful of Nothin\'', '1.7 GB', 'selected', '1080p WEB-DL · x265', 'e5f6789012345678901234567890abcdeab2c3d4'],
        ['A No-Rough-Stuff-Type Deal', '2.0 GB', 'selected', '1080p WEB-DL · x265', 'f6789012345678901234567890abcdeab2c3d4e5']
      ],
      2: [
        ['Seven Thirty-Seven', '1.8 GB', 'selected', '1080p WEB-DL · x265', 'a1b2c3d4e5f6789012345678901234567890abcd'],
        ['Grilled', '1.3 GB', 'selected', '1080p WEB-DL · x265', 'b2c3d4e5f6789012345678901234567890abcdea'],
        ['Bit by a Dead Bee', '—', 'unavailable', '', ''],
        ['Down', '1.5 GB', 'selected', '1080p WEB-DL · x265', 'c3d4e5f6789012345678901234567890abcdeab2'],
        ['Breakage', '1.8 GB', 'selected', '1080p WEB-DL · x265', 'd4e5f6789012345678901234567890abcdeab2c3'],
        ['Peekaboo', '1.9 GB', 'selected', '1080p WEB-DL · x265', 'e5f6789012345678901234567890abcdeab2c3d4'],
        ['Negro y Azul', '2.1 GB', 'selected', '1080p WEB-DL · x265', 'f6789012345678901234567890abcdeab2c3d4e5'],
        ['Better Call Saul', '1.4 GB', 'selected', '1080p WEB-DL · x265', '0123456789abcdef0123456789abcdef01234567'],
        ['4 Days Out', '—', 'unavailable', '', ''],
        ['Over', '1.6 GB', 'selected', '1080p WEB-DL · x265', '123456789abcdef0123456789abcdef012345678']
      ]
    }
  },
  {
    id: 'the-bear',
    imdbId: 'tt14452776',
    title: 'The Bear',
    year: '2022',
    seasons: 3,
    type: 'Comedy · Drama',
    rating: '8.5',
    accent: 'orange',
    initials: 'TB',
    posterLabel: 'Every second counts',
    genres: ['Comedy', 'Drama'],
    synopsis: 'A young chef returns to Chicago to run his family\'s sandwich shop, finding a chaotic kitchen and an unlikely team.',
    episodes: {
      1: [
        ['System', '1.0 GB', 'selected', '1080p WEB-DL · x265', 'ab12cd34ef56789012345678901234567890abcd'],
        ['Hands', '—', 'unavailable', '', ''],
        ['Brigade', '1.2 GB', 'selected', '1080p WEB-DL · x265', 'bc23de45f6789012345678901234567890abcde1'],
        ['Dogs', '1.1 GB', 'selected', '1080p WEB-DL · x265', 'cd34ef56a789012345678901234567890abcdef2'],
        ['Sheridan', '1.1 GB', 'selected', '1080p WEB-DL · x265', 'de45fa67b89012345678901234567890abcdef12'],
        ['Ceres', '1.3 GB', 'selected', '1080p WEB-DL · x265', 'ef56ab78c9012345678901234567890abcdef123'],
        ['Review', '—', 'unavailable', '', ''],
        ['Braciole', '1.5 GB', 'selected', '1080p WEB-DL · x265', 'f067bc89d012345678901234567890abcdef1234']
      ]
    }
  },
  {
    id: 'severance',
    imdbId: 'tt11280740',
    title: 'Severance',
    year: '2022',
    seasons: 2,
    type: 'Drama · Mystery',
    rating: '8.7',
    accent: 'blue',
    initials: 'S',
    posterLabel: 'Who are you?',
    genres: ['Drama', 'Mystery', 'Sci-Fi'],
    synopsis: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.',
    episodes: {
      1: [
        ['Good News About Hell', '1.4 GB', 'selected', '1080p WEB-DL · x265', '0a1b2c3d4e5f678901234567890123456789abcd'],
        ['Half Loop', '1.2 GB', 'selected', '1080p WEB-DL · x265', '1b2c3d4e5f678901234567890123456789abcde2'],
        ['In Perpetuity', '1.0 GB', 'selected', '1080p WEB-DL · x265', '2c3d4e5f678901234567890123456789abcdef34'],
        ['The You You Are', '—', 'unavailable', '', ''],
        ['The Grim Barbarity of Optics and Design', '1.3 GB', 'selected', '1080p WEB-DL · x265', '3d4e5f678901234567890123456789abcdef345'],
        ['Hide and Seek', '1.1 GB', 'selected', '1080p WEB-DL · x265', '4e5f678901234567890123456789abcdef3456'],
        ['Defiant Jazz', '1.5 GB', 'selected', '1080p WEB-DL · x265', '5f678901234567890123456789abcdef34567'],
        ['What\'s for Dinner?', '1.2 GB', 'selected', '1080p WEB-DL · x265', '678901234567890123456789abcdef345678']
      ]
    }
  },
  {
    id: 'succession',
    imdbId: 'tt7660850',
    title: 'Succession',
    year: '2018',
    seasons: 4,
    type: 'Drama · Satire',
    rating: '8.9',
    accent: 'red',
    initials: 'SC',
    posterLabel: 'The future is real',
    genres: ['Drama', 'Satire'],
    synopsis: 'The Roy family faces an uncertain future as their ageing patriarch begins to step back from the media empire he built.',
    episodes: {
      1: [
        ['Celebration', '1.4 GB', 'selected', '1080p WEB-DL · x265', '78901234567890abcdef0123456789abcdef0123'],
        ['Sh*t Show at the F**k Factory', '1.1 GB', 'selected', '1080p WEB-DL · x265', '8901234567890abcdef0123456789abcdef01234'],
        ['Lifeboats', '—', 'unavailable', '', ''],
        ['Sad Sack Wasp Trap', '1.2 GB', 'selected', '1080p WEB-DL · x265', '901234567890abcdef0123456789abcdef012345'],
        ['I Went to Market', '1.5 GB', 'selected', '1080p WEB-DL · x265', 'a01234567890abcdef0123456789abcdef012345'],
        ['Which Side Are You On?', '1.4 GB', 'selected', '1080p WEB-DL · x265', 'b1234567890abcdef0123456789abcdef0123456']
      ]
    }
  }
];

const STREMIO_DOWNLOAD_ORIGIN = 'http://127.0.0.1:11470';
const TORRENTIO_PREFERENCES = [
  { value: 'best-overall', label: 'Best Overall' },
  { value: 'smallest-acceptable', label: 'Smallest Acceptable' },
  { value: 'most-reliable', label: 'Most Reliable' },
  { value: '1337x', label: 'Prefer 1337x' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'quality', label: 'Highest quality' }
];
const RESOLUTION_PREFERENCES = [
  { value: '1080p', label: '1080p only' },
  { value: '720p', label: '720p only' },
  { value: '2160p', label: '4K only' },
  { value: 'any', label: 'Any resolution' }
];
const AUDIO_PREFERENCES = [
  { value: 'any', label: 'Any audio' },
  { value: 'english-dubbed-only', label: 'Explicit English Dub only' },
  { value: 'english-dubbed-or-dual', label: 'English dubbed / dual audio' }
];

function buildStremioDownloadLink(item) {
  if (!item?.hash || !Number.isInteger(item.fileIdx) || item.fileIdx < 0) return '';
  return `${STREMIO_DOWNLOAD_ORIGIN}/${encodeURIComponent(item.hash)}/${item.fileIdx}?external=1&download=1`;
}

const ICONS = {
  search: 'M11 11 20 20M13.5 6.5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  copy: 'M8 8h11v11H8zM5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1',
  chevron: 'm9 18 6-6-6-6',
  down: 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  refresh: 'M20 11a8.1 8.1 0 0 0-14.9-3.9L3 10m0-5v5h5M4 13a8.1 8.1 0 0 0 14.9 3.9L21 14m0 5v-5h-5',
  filter: 'M4 6h16M7 12h10M10 18h4',
  bolt: 'm13 2-9 12h7l-1 8 9-12h-7l1-8Z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  x: 'm6 6 12 12M18 6 6 18',
  trend: 'M4 18 10 12l4 4 6-8',
  link: 'M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1'
};

function Icon({ name, size = 16, strokeWidth = 1.8 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

function Poster({ series, large = false }) {
  return (
    <div className={`poster-art ${series.accent} ${large ? 'poster-art-large' : ''}`} aria-label={`${series.title} poster artwork`}>
      {series.poster && <img className="poster-image" src={series.poster} alt="" loading={large ? 'eager' : 'lazy'} onError={event => event.currentTarget.remove()} />}
      <div className="poster-noise" />
      <span className="poster-mark">{series.initials}</span>
      <span className="poster-caption">{series.posterLabel}</span>
      <span className="poster-edge">SEASONFETCH / 01</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const config = {
    selected: { label: 'Selected', icon: 'check' },
    'size-unknown': { label: 'Size unknown', icon: 'dots' },
    unavailable: { label: 'Unavailable', icon: 'x' },
    'provider-error': { label: 'Provider error', icon: 'x' }
  }[status] || { label: 'Unavailable', icon: 'x' };

  return (
    <span className={`status-badge ${status}`}>
      <Icon name={config.icon} size={13} />
      {config.label}
    </span>
  );
}

function getEpisodeNumber(row, index) {
  const number = typeof row?.number === 'number' ? row.number : row?.[5];
  return Number.isInteger(number) && number > 0 ? number : index + 1;
}

function getEpisodeTitle(row, number) {
  return row?.title || row?.[0] || `Episode ${number}`;
}

function App() {
  const [query, setQuery] = useState('breaking bad');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [season, setSeason] = useState(1);
  const [episodes, setEpisodes] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [searching, setSearching] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState(null);
  const [toast, setToast] = useState('');
  const [searchTouched, setSearchTouched] = useState(false);
  const [providerMode, setProviderMode] = useState('ready');
  const [geminiAnalysis, setGeminiAnalysis] = useState({});
  const [geminiLoading, setGeminiLoading] = useState({});
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const recoveryLinkDetected = window.location.hash.includes('type=recovery') || new URLSearchParams(window.location.search).has('code');
  const [showAuth, setShowAuth] = useState(recoveryLinkDetected);
  const [authMode, setAuthMode] = useState(recoveryLinkDetected ? 'reset' : 'sign-in');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const searchRequestRef = useRef(0);
  const metadataRequestRef = useRef(0);
  const scanRequestRef = useRef(0);
  const [torrentioPreference, setTorrentioPreference] = useState(() => {
    const stored = window.localStorage.getItem('seasonfetch:torrentio-preference');
    return TORRENTIO_PREFERENCES.some(option => option.value === stored) ? stored : 'default';
  });
  const [audioPreference, setAudioPreference] = useState(() => {
    const stored = window.localStorage.getItem('seasonfetch:audio-preference');
    return AUDIO_PREFERENCES.some(option => option.value === stored) ? stored : 'any';
  });
  const [resolutionPreference, setResolutionPreference] = useState(() => {
    const stored = window.localStorage.getItem('seasonfetch:resolution-preference');
    return RESOLUTION_PREFERENCES.some(option => option.value === stored) ? stored : '1080p';
  });
  const [seasonIntegrity, setSeasonIntegrity] = useState(null);

  const available = useMemo(() => episodes.filter(item => !['unavailable', 'provider-error'].includes(item.status)).length, [episodes]);
  const progress = episodes.length ? Math.round((available / episodes.length) * 100) : 0;

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setUser(data.session?.user || null);
    });
    if (recoveryLinkDetected) {
      setAuthMode('reset');
      setShowAuth(true);
    }
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      if (event === 'PASSWORD_RECOVERY' || (recoveryLinkDetected && event === 'SIGNED_IN')) {
        setAuthMode('reset');
        setShowAuth(true);
      }
      if (!session) setIsAdmin(false);
      if (!session) setProfile(null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user) return undefined;
    let active = true;
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle().then(({ data }) => {
      if (active) setProfile(data || null);
    });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!supabase || !user) return undefined;
    let active = true;
    supabase.rpc('is_admin').then(({ data, error }) => {
      if (active) setIsAdmin(!error && data === true);
    });
    return () => { active = false; };
  }, [user]);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setToast('Signed out');
    window.setTimeout(() => setToast(''), 2200);
  }

  function decorateResults(items) {
    return items.map((item, index) => {
      const local = SERIES.find(candidate => candidate.imdbId === item.imdbId);
      const title = item.title || local?.title || 'Unknown title';
      return {
        ...local,
        ...item,
        id: item.id,
        imdbId: item.imdbId || item.id,
        title,
        accent: local?.accent || ['purple', 'orange', 'blue', 'red'][index % 4],
        initials: local?.initials || title.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(),
        posterLabel: local?.posterLabel || 'Cinemeta metadata',
        episodes: local?.episodes || {}
      };
    });
  }

  useEffect(() => {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) {
      setSearchSuggestions([]);
      setSuggestionsLoading(false);
      return undefined;
    }

    let active = true;
    setSuggestionsLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await cinemeta.search(cleanQuery);
        if (active) setSearchSuggestions(decorateResults(data.results || []).slice(0, 5));
      } catch {
        if (active) setSearchSuggestions([]);
      } finally {
        if (active) setSuggestionsLoading(false);
      }
    }, 280);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  async function searchWithGeminiAssist(cleanQuery) {
    const response = await fetch('/api/gemini/search-assist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: cleanQuery })
    });
    if (!response.ok) throw new Error('Gemini search assist failed');
    const data = await response.json();
    for (const suggestion of data.queries || []) {
      const candidateData = await cinemeta.search(suggestion);
      const candidateResults = decorateResults(candidateData.results || []);
      if (candidateResults.length) return { results: candidateResults, correctedQuery: suggestion };
    }
    return { results: [], correctedQuery: '' };
  }

  function runSearch(event, overrideQuery) {
    event?.preventDefault();
    const cleanQuery = String(overrideQuery ?? query).trim().toLowerCase();
    const requestId = ++searchRequestRef.current;
    setSearchTouched(true);
    setSearching(true);
    setNotice(null);
    setSearchSuggestions([]);
    setSelected(null);
    setEpisodes([]);
    setExpanded({});
    window.setTimeout(async () => {
      if (cleanQuery.length < 2) {
        if (requestId !== searchRequestRef.current) return;
        setResults([]);
        setSearching(false);
        setNotice('Enter at least two characters to search.');
        return;
      }

      try {
        const data = await cinemeta.search(cleanQuery);
        if (requestId !== searchRequestRef.current) return;
        let nextResults = decorateResults(data.results || []);
        let correctedQuery = '';
        if (!nextResults.length) {
          try {
            const assisted = await searchWithGeminiAssist(cleanQuery);
            if (requestId !== searchRequestRef.current) return;
            nextResults = assisted.results;
            correctedQuery = assisted.correctedQuery;
          } catch (assistError) {
            console.warn('Gemini search assist failed:', assistError);
          }
        }
        setResults(nextResults);
        setSearchSuggestions(nextResults.slice(0, 5));
        setSearching(false);
        if (correctedQuery) setNotice(`Gemini search assist matched “${correctedQuery}”.`);
        else if (!nextResults.length) setNotice('No series found. Try another title.');
      } catch (error) {
        if (requestId !== searchRequestRef.current) return;
        console.warn('Cinemeta search failed; using local preview matches.', error);
        const fallback = SERIES.filter(item => `${item.title} ${item.type}`.toLowerCase().includes(cleanQuery));
        setResults(fallback);
        setSearching(false);
        setNotice(fallback.length ? 'Cinemeta is unavailable; showing local preview matches.' : 'No series found. Try another title.');
      }
    }, 320);
  }

  async function chooseSeries(series) {
    scanRequestRef.current += 1;
    const requestId = ++metadataRequestRef.current;
    const local = SERIES.find(item => item.imdbId === series.imdbId || item.id === series.id);
    const baseSeasonCount = Number(series.seasons || local?.seasons || 1);
    const baseSeries = {
      ...local,
      ...series,
      imdbId: series.imdbId || series.id,
      seasons: baseSeasonCount,
      seasonNumbers: Array.isArray(series.seasonNumbers) && series.seasonNumbers.length
        ? series.seasonNumbers
        : Array.from({ length: baseSeasonCount }, (_, index) => index + 1),
      episodes: series.episodes || local?.episodes || {}
    };
    setSelected(baseSeries);
    setResults([]);
    setSearchSuggestions([]);
    setNotice(null);
    setSeason(1);
    setEpisodes([]);
    setExpanded({});
    setProviderMode('ready');
    setToast(`${baseSeries.title} selected`);
    window.setTimeout(() => setToast(''), 2200);

    try {
      const data = await cinemeta.getSeries(baseSeries.imdbId);
      if (requestId !== metadataRequestRef.current) return;
      const remoteEpisodes = Object.fromEntries(
        Object.entries(data.episodes || {}).map(([seasonNumber, list]) => [
          seasonNumber,
          list.map(item => ({ title: item.title, number: item.number, size: '—', status: 'unavailable', format: '', hash: '', magnet: '' }))
        ])
      );
      const seasonNumbers = Object.keys(remoteEpisodes).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
      if (seasonNumbers.length && !seasonNumbers.includes(season)) setSeason(seasonNumbers[0]);
      setSelected(current => current ? {
        ...current,
        ...data.series,
        id: current.id,
        imdbId: baseSeries.imdbId,
        episodes: Object.keys(remoteEpisodes).length ? remoteEpisodes : current.episodes,
        seasonNumbers: seasonNumbers.length ? seasonNumbers : current.seasonNumbers,
        seasons: seasonNumbers.length ? seasonNumbers.length : current.seasons
      } : current);
    } catch (error) {
      console.warn('Cinemeta metadata failed; retaining search result.', error);
    }
  }

  function changeTorrentioPreference(value) {
    scanRequestRef.current += 1;
    setTorrentioPreference(value);
    window.localStorage.setItem('seasonfetch:torrentio-preference', value);
    setEpisodes([]);
    setExpanded({});
    setProviderMode('ready');
    setNotice('Preference changed. Run Check sources to scan with it.');
  }

  function changeAudioPreference(value) {
    scanRequestRef.current += 1;
    setAudioPreference(value);
    window.localStorage.setItem('seasonfetch:audio-preference', value);
    setEpisodes([]);
    setExpanded({});
    setProviderMode('ready');
    setNotice(value === 'any' ? 'Audio filter cleared.' : 'Audio filter enabled. Run Check sources to scan English dubbed or dual-audio releases.');
  }

  function changeResolutionPreference(value) {
    scanRequestRef.current += 1;
    setResolutionPreference(value);
    window.localStorage.setItem('seasonfetch:resolution-preference', value);
    setEpisodes([]);
    setExpanded({});
    setProviderMode('ready');
    setNotice('Resolution filter changed. Run Check sources to scan with it.');
  }

  function checkSources() {
    if (!selected) return;
    const requestId = ++scanRequestRef.current;
    const scanSeriesId = selected.imdbId;
    const scanSeason = season;
    const scanPreference = torrentioPreference;
    const scanAudioPreference = audioPreference;
    const scanResolutionPreference = resolutionPreference;
    setChecking(true);
    setEpisodes([]);
    setSeasonIntegrity(null);
    setExpanded({});
    setNotice(null);
    const baseRows = selected.episodes[season] || [];

    if (!baseRows.length) {
      setChecking(false);
      setProviderMode('error');
      setNotice(`No episode metadata is available for ${season === 0 ? 'Specials' : `Season ${season}`}.`);
      return;
    }

    const episodeNumbers = baseRows.map(getEpisodeNumber);

    const makeDemoRows = () => baseRows.map((row, index) => ({
      id: `${selected.id}-${season}-${index + 1}`,
      number: episodeNumbers[index],
      title: getEpisodeTitle(row, episodeNumbers[index]),
      size: row.size || row[1] || '—',
      status: row.status || row[2] || 'unavailable',
      format: row.format || row[3] || '',
      hash: '',
      magnet: '',
      rawMagnet: '',
      preview: true,
      sourceUrl: '',
      sourceCount: row.hash || row[4] ? 1 : 0,
      sourceError: '',
      candidates: []
    }));

    const mapProviderRows = providerResults => baseRows.map((row, index) => {
      const episodeNumber = episodeNumbers[index];
      const provider = providerResults.find(item => item.episode === episodeNumber);
      const source = provider?.selected;
      const status = provider?.status === 'error' ? 'provider-error' : (provider?.status || 'unavailable');

      return {
        id: `${selected.id}-${season}-${episodeNumber}`,
        number: episodeNumber,
        title: getEpisodeTitle(row, episodeNumber),
        size: source?.sizeLabel || (status === 'unavailable' ? '—' : 'Unknown'),
        status,
        format: source?.title || '',
        hash: source?.infoHash || '',
        magnet: source?.magnet || '',
        rawMagnet: source?.rawMagnet || '',
        sourceUrl: source?.sourceUrl || source?.externalUrl || '',
        fileIdx: source?.fileIdx ?? null,
        trackerCount: source?.trackerCount || 0,
        fallbackTrackersUsed: source?.fallbackTrackersUsed || false,
        provider: source?.provider || '',
        resolution: source?.resolution || null,
        seeders: source?.seeders ?? null,
        audio: source?.audio || null,
        audioEvidence: source?.audioEvidence || 'unverified',
        selectionReason: provider?.selectionReason || '',
        releaseType: source?.releaseType || null,
        sourceCount: provider?.sources?.length || 0,
        sourceError: provider?.error || '',
        candidates: provider?.sources || []
      };
    });

    window.setTimeout(() => {
      torrentio.getSeasonSources(selected.imdbId, season, episodeNumbers, torrentioPreference, audioPreference, { resolution: scanResolutionPreference })
        .then(data => {
          if (requestId !== scanRequestRef.current || selected?.imdbId !== scanSeriesId || season !== scanSeason || torrentioPreference !== scanPreference || audioPreference !== scanAudioPreference || resolutionPreference !== scanResolutionPreference) return;
          setEpisodes(mapProviderRows(data.results || []));
          setSeasonIntegrity(data.integrity || null);
          setProviderMode(data.status === 'partial' ? 'partial' : data.status === 'error' ? 'error' : 'live');
          setChecking(false);
          if (data.status === 'partial') setNotice(`${data.providerErrors} episode source request${data.providerErrors === 1 ? '' : 's'} failed; successful Torrentio results are still shown.`);
          if (data.status === 'error') setNotice('Torrentio could not answer the episode requests. Try the scan again later.');
          setToast(`Season ${season} Torrentio scan complete`);
          window.setTimeout(() => setToast(''), 2600);
        })
        .catch(error => {
          if (requestId !== scanRequestRef.current || selected?.imdbId !== scanSeriesId || season !== scanSeason || torrentioPreference !== scanPreference || audioPreference !== scanAudioPreference) return;
          console.warn('Torrentio lookup failed; using preview data.', error);
          setEpisodes(makeDemoRows());
          setSeasonIntegrity(null);
          setProviderMode('demo');
          setChecking(false);
          setNotice('Torrentio is unavailable right now, so preview source data is shown instead.');
          setToast('Showing preview fallback data');
          window.setTimeout(() => setToast(''), 2600);
        });
    }, 760);
  }

  function copyMagnet(magnet) {
    if (!magnet) return;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(magnet).catch(() => {});
    setToast('Magnet link copied to clipboard');
    window.setTimeout(() => setToast(''), 2400);
  }

  function copyRawMagnet(item) {
    if (!item?.rawMagnet) return;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(item.rawMagnet).catch(() => {});
    setToast('Raw magnet link copied');
    window.setTimeout(() => setToast(''), 2400);
  }

  function getSeasonMagnets() {
    return episodes.filter(item => item.magnet && !item.preview).map(item => item.magnet);
  }

  function copySeasonMagnets() {
    const magnets = getSeasonMagnets();
    if (!magnets.length) {
      setNotice('No live Torrentio magnets are available for this season yet. Run Check sources first.');
      return;
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(magnets.join('\n')).catch(() => {});
    setToast(`${magnets.length} season magnet${magnets.length === 1 ? '' : 's'} copied`);
    window.setTimeout(() => setToast(''), 2400);
  }

  function downloadSeasonMagnets() {
    const magnets = getSeasonMagnets();
    if (!magnets.length) {
      setNotice('No live Torrentio magnets are available for this season yet. Run Check sources first.');
      return;
    }
    const safeTitle = String(selected?.title || 'season').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'season';
    const filename = `${safeTitle}-season-${season}-magnets.txt`;
    const url = URL.createObjectURL(new Blob([`${magnets.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast(`${magnets.length} season magnets downloaded`);
    window.setTimeout(() => setToast(''), 2400);
  }

  function copyStremioLink(item) {
    const link = buildStremioDownloadLink(item);
    if (!link) return;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).catch(() => {});
    setToast('Stremio download link copied');
    window.setTimeout(() => setToast(''), 2400);
  }

  async function checkStremioConnection() {
    try {
      await fetch(`${STREMIO_DOWNLOAD_ORIGIN}/`, { mode: 'no-cors', cache: 'no-store' });
      setToast('Stremio local server is reachable');
    } catch {
      setNotice('Stremio is not listening on port 11470. Start Stremio Desktop or Stremio Service, then try again.');
    }
    window.setTimeout(() => setToast(''), 2400);
  }

  async function analyzeWithGemini(item) {
    if (!item?.id || item.preview) return;
    setGeminiLoading(current => ({ ...current, [item.id]: true }));
    setGeminiAnalysis(current => ({ ...current, [item.id]: null }));
    const candidates = (item.candidates?.length ? item.candidates : [item]).map(candidate => ({
      title: candidate.title || candidate.format || '',
      provider: candidate.provider || '',
      resolution: candidate.resolution || '1080p',
      sizeBytes: candidate.sizeBytes ?? null,
      seeders: candidate.seeders ?? null,
      trackerCount: candidate.trackerCount || 0,
      fileIdx: candidate.fileIdx ?? null,
      preferredProvider: Boolean(candidate.preferredProvider)
    }));

    try {
      const response = await fetch('/api/gemini/explain-source', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seriesTitle: selected?.title, season, episode: item.number, candidates })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gemini request failed');
      setGeminiAnalysis(current => ({ ...current, [item.id]: data }));
    } catch (error) {
      setGeminiAnalysis(current => ({ ...current, [item.id]: { error: error.message } }));
    } finally {
      setGeminiLoading(current => ({ ...current, [item.id]: false }));
    }
  }

  function reset() {
    setQuery('');
    setResults([]);
    setSelected(null);
    setEpisodes([]);
    setNotice(null);
    setExpanded({});
    setSearchSuggestions([]);
    setSearchTouched(false);
    setProviderMode('ready');
  }

  const seasonOptions = selected?.seasonNumbers || Array.from({ length: selected?.seasons || 0 }, (_, index) => index + 1);

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <button className="brand" onClick={reset} aria-label="Reset SeasonFetch">
          <span className="brand-glyph"><span /></span>
          <span>Season<span className="accent-text">Fetch</span></span>
        </button>
          <div className="topbar-right">
          <span className="live-indicator"><i /> Live discovery</span>
          <span className="topbar-label">TV SOURCE DISCOVERY</span>
          {user ? <AccountMenu supabase={supabase} user={user} profile={profile} isAdmin={isAdmin} onAdmin={() => setShowAdmin(true)} onSignOut={signOut} onProfileUpdated={setProfile} /> : <button className="account-trigger account-sign-in" onClick={() => setShowAuth(true)}>Sign in</button>}
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="eyebrow"><span className="eyebrow-dot" /> SEASON SOURCE FINDER</div>
          <h1>Find your season.<br /><span>One episode at a time.</span></h1>
          <p className="hero-copy">Discover clean, high-quality sources for every episode.<br className="desktop-only" /> Automatically prioritize the smallest known file size.</p>
          <form className="search-form" onSubmit={runSearch}>
            <Icon name="search" size={18} />
            <input value={query} onChange={event => { setQuery(event.target.value); setSearchTouched(false); }} placeholder="Search a TV series..." aria-label="Search a TV series" />
            {query && <button className="clear-search" type="button" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="x" size={15} /></button>}
            <button className="search-button" disabled={searching} type="submit">
              {searching ? <span className="spinner" /> : <>Search <Icon name="arrow" size={15} /></>}
            </button>
          </form>
          {(suggestionsLoading || searchSuggestions.length > 0) && query.trim().length >= 2 && <div className="search-suggestions" aria-label="Search suggestions">
            {suggestionsLoading && <div className="suggestions-loading"><span className="spinner spinner-dark" /> Finding matching titles…</div>}
            {!suggestionsLoading && searchSuggestions.map(series => <button className="suggestion-card" key={series.imdbId || series.id} type="button" onClick={() => { setSearchSuggestions([]); chooseSeries(series); }}>
              <Poster series={series} />
              <span className="suggestion-card-copy"><strong>{series.title}</strong><span>{series.year || 'Year unavailable'} <i /> {series.type || 'Series'}</span></span>
              <span className="card-arrow"><Icon name="arrow" size={14} /></span>
            </button>)}
          </div>}
          <div className="search-hint"><span><Icon name="check" size={12} /> 1080p only</span><b>·</b><span><Icon name="trend" size={12} /> Smallest known size</span><b>·</b><span><Icon name="link" size={12} /> Magnet links</span></div>
        </section>

        {notice && <div className="notice"><span className="notice-dot" />{notice}<button onClick={() => setNotice(null)}><Icon name="x" size={14} /></button></div>}

        {searching && <div className="loading-panel"><span className="spinner spinner-dark" /> Searching Cinemeta catalog <span className="loading-note">this usually takes a moment</span></div>}

        {!searching && results.length > 0 && (
          <section className="results-section fade-in">
            <div className="section-heading"><div><span className="section-kicker">SEARCH RESULTS</span><h2>Matching series</h2></div><span className="result-count">{results.length} matches</span></div>
            <div className="series-grid">
              {results.map(series => <button key={series.id} className="series-card" onClick={() => chooseSeries(series)}>
                <Poster series={series} />
                <span className="series-card-copy"><strong>{series.title}</strong><span>{series.year || 'Year unavailable'} <i /> {series.type || 'Series'}</span><em><Icon name="bolt" size={11} /> {series.rating || 'Rating unavailable'}</em></span>
                <span className="card-arrow"><Icon name="arrow" size={15} /></span>
              </button>)}
            </div>
          </section>
        )}

        {!searching && !selected && !results.length && !notice && (
          <section className="empty-state fade-in">
            <div className="empty-orbit"><Icon name="search" size={22} /></div>
            <span className="section-kicker">READY WHEN YOU ARE</span>
            <h2>{searchTouched ? 'Search another title' : 'Start with a series'}</h2>
            <p>Find a show above to scan seasons, compare available sources, and copy a magnet in one click.</p>
            <div className="suggestion-row"><span>Try</span>{['Breaking Bad', 'The Bear', 'Severance'].map(title => <button key={title} onClick={() => { setQuery(title); runSearch(undefined, title); }}>{title}</button>)}</div>
          </section>
        )}

        {selected && (
          <section className="workspace fade-in">
            <div className="series-banner">
              <Poster series={selected} large />
              <div className="selected-info">
                <div className="selected-topline"><span className="section-kicker">SELECTED SERIES</span>{providerMode === 'live' ? <span className="synced"><i /> Torrentio live</span> : providerMode === 'partial' ? <span className="synced partial-provider"><Icon name="dots" size={12} /> Torrentio partial</span> : providerMode === 'error' ? <span className="synced error-provider"><Icon name="x" size={12} /> Provider error</span> : providerMode === 'demo' ? <span className="synced demo-provider"><Icon name="dots" size={12} /> Preview fallback</span> : <span className="synced"><Icon name="check" size={12} /> Metadata synced</span>}</div>
                <h2>{selected.title}</h2>
                <div className="selected-meta"><span>{selected.year}</span><i /> <span>{selected.type}</span><i /> <span><Icon name="bolt" size={12} /> {selected.rating}</span></div>
                <p className="synopsis">{selected.synopsis}</p>
                <div className="genre-row">{(selected.genres || []).map(genre => <span key={genre}>{genre}</span>)}</div>
              </div>
              <button className="change-button" onClick={() => { setSelected(null); setEpisodes([]); setResults(SERIES); }}>Change series <Icon name="arrow" size={14} /></button>
            </div>

            <div className="season-toolbar">
              <div><span className="section-kicker">EPISODE SOURCES</span><h2>Season results</h2></div>
              <div className="season-controls">
                <div className="select-wrap"><Icon name="filter" size={15} /><select value={season} onChange={event => { scanRequestRef.current += 1; setSeason(Number(event.target.value)); setEpisodes([]); setExpanded({}); setProviderMode('ready'); }} aria-label="Choose season">{seasonOptions.map(item => <option key={item} value={item}>{item === 0 ? 'Specials' : `Season ${item}`}</option>)}</select><Icon name="down" size={14} /></div>
                <div className="select-wrap preference-wrap"><Icon name="trend" size={15} /><select value={torrentioPreference} onChange={event => changeTorrentioPreference(event.target.value)} aria-label="Choose Torrentio ranking preference">{TORRENTIO_PREFERENCES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Icon name="down" size={14} /></div>
                <div className="select-wrap preference-wrap"><Icon name="link" size={15} /><select value={audioPreference} onChange={event => changeAudioPreference(event.target.value)} aria-label="Choose audio filter">{AUDIO_PREFERENCES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Icon name="down" size={14} /></div>
                <div className="select-wrap preference-wrap"><Icon name="spark" size={15} /><select value={resolutionPreference} onChange={event => changeResolutionPreference(event.target.value)} aria-label="Choose resolution filter">{RESOLUTION_PREFERENCES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Icon name="down" size={14} /></div>
                <button className="secondary-button" onClick={copySeasonMagnets} disabled={checking || !episodes.length}><Icon name="copy" size={15} /> Copy season magnets</button>
                <button className="secondary-button" onClick={downloadSeasonMagnets} disabled={checking || !episodes.length}><Icon name="down" size={15} /> Download .txt</button>
                <button className="primary-button" onClick={checkSources} disabled={checking}>{checking ? <><span className="spinner spinner-dark" /> Scanning</> : <><Icon name="refresh" size={15} /> Check sources</>}</button>
              </div>
            </div>

            {checking && <div className="scan-panel"><span className="scan-pulse"><Icon name="bolt" size={16} /></span><div><strong>Checking episode sources</strong><span>Polling providers with a low-impact concurrency limit…</span></div><div className="scan-line"><i /></div></div>}

            {episodes.length > 0 && !checking && <>
              <div className="summary-panel">
                <div className="summary-stat"><span className="summary-label">AVAILABLE</span><strong>{available}<small>/{episodes.length}</small></strong></div>
                <div className="summary-progress"><div className="progress-label"><span>Season coverage</span><b>{progress}%</b></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div>
                <div className="summary-chip"><span className="chip-dot" /> {providerMode === 'live' ? 'Torrentio live · 1080p only' : providerMode === 'partial' ? 'Torrentio partial · retry failed rows' : providerMode === 'error' ? 'Torrentio error · retry scan' : providerMode === 'demo' ? 'Preview fallback · 1080p only' : '1080p filter active'}</div>
              </div>
              {seasonIntegrity && <div className="integrity-panel">
                <div><span className="section-kicker">SEASON INTEGRITY</span><strong>{seasonIntegrity.usableEpisodes} / {episodes.length} usable episodes</strong></div>
                <div className="integrity-grid"><span><b>Missing</b>{seasonIntegrity.missingEpisodes?.length ? seasonIntegrity.missingEpisodes.map(number => `E${String(number).padStart(2, '0')}`).join(', ') : 'None'}</span><span><b>Resolution</b>{seasonIntegrity.resolutionConsistency || 'Unknown'}</span><span><b>Audio evidence</b>{seasonIntegrity.audioConsistency === 'explicit-english-dub' ? 'Explicit English Dub' : seasonIntegrity.audioConsistency === 'possible-english-audio' ? 'Possible English Audio' : seasonIntegrity.audioConsistency === 'mixed' ? 'Mixed' : 'Unverified'}</span><span><b>Estimated size</b>{seasonIntegrity.estimatedTotalSizeBytes ? `${(seasonIntegrity.estimatedTotalSizeBytes / 1024 ** 3).toFixed(2)} GB` : 'Unknown'}</span><span><b>Weak releases</b>{seasonIntegrity.weakEpisodes?.length ? seasonIntegrity.weakEpisodes.map(number => `E${String(number).padStart(2, '0')}`).join(', ') : 'None detected'}</span></div>
              </div>}
              <div className="episode-table">
                <div className="table-header"><span>EPISODE</span><span>SOURCE</span><span>FILE SIZE</span><span>STATUS</span><span /></div>
                {episodes.map((item) => <div className="episode-group" key={item.id}>
                    <div className={`episode-row ${expanded[item.id] ? 'is-expanded' : ''}`}>
                    <button className="episode-name" onClick={() => setExpanded(current => ({ ...current, [item.id]: !current[item.id] }))}><span className="chevron"><Icon name={expanded[item.id] ? 'down' : 'chevron'} size={15} /></span><span className="episode-number">E{String(item.number).padStart(2, '0')}</span><span className="episode-title">{item.title}</span><span className={`mobile-status ${item.status}`} title={item.status === 'selected' ? 'Selected source' : item.status === 'size-unknown' ? 'Size unknown' : item.status === 'provider-error' ? 'Provider error' : 'Unavailable'}><Icon name={item.status === 'selected' ? 'check' : item.status === 'size-unknown' ? 'dots' : 'x'} size={12} /></span></button>
                    <span className={`quality-pill ${['unavailable', 'provider-error'].includes(item.status) ? 'muted-pill' : ''}`}>{['unavailable', 'provider-error'].includes(item.status) ? '—' : (item.resolution || resolutionPreference)}</span>
                    <span className="file-size">{item.size}</span>
                    <StatusBadge status={item.status} />
                    <span className="row-action">{item.magnet && <button className="copy-button" onClick={() => copyMagnet(item.magnet)} aria-label={`Copy magnet for episode ${item.number}`}><Icon name="copy" size={15} /></button>}</span>
                  </div>
                  {expanded[item.id] && <div className="episode-details">
                    {item.magnet ? <>
                      <div className="detail-top"><div><span className="detail-label">SELECTED SOURCE</span><strong>{item.format}</strong></div><div className="detail-actions">{item.sourceUrl && <a className="secondary-button small-button" href={item.sourceUrl} target="_blank" rel="noreferrer">Open source <Icon name="arrow" size={13} /></a>}{buildStremioDownloadLink(item) && <><button className="secondary-button small-button" onClick={checkStremioConnection}><Icon name="bolt" size={14} /> Check Stremio</button><a className="primary-button small-button" href={buildStremioDownloadLink(item)}>Open Stremio download <Icon name="arrow" size={13} /></a><button className="secondary-button small-button" onClick={() => copyStremioLink(item)}><Icon name="copy" size={14} /> Copy Stremio link</button></>}<a className="secondary-button small-button" href={item.magnet}>Open magnet <Icon name="link" size={13} /></a><button className="secondary-button small-button" onClick={() => copyMagnet(item.magnet)}><Icon name="copy" size={14} /> Copy magnet with trackers</button>{item.rawMagnet && <button className="secondary-button small-button" onClick={() => copyRawMagnet(item)}><Icon name="copy" size={14} /> Copy raw magnet</button>}<button className="secondary-button small-button" onClick={() => analyzeWithGemini(item)} disabled={geminiLoading[item.id]}><Icon name="bolt" size={14} /> {geminiLoading[item.id] ? 'Analyzing…' : 'Analyze with Gemini'}</button></div></div>
                      <div className="detail-meta"><span><b>Resolution</b>{item.resolution || 'Unknown'}</span><span><b>File size</b>{item.size}</span>{item.audio && <span><b>Audio</b>{item.audio === 'dual-audio' ? 'Dual audio' : 'English dubbed'}</span>}<span><b>Audio evidence</b>{item.audioEvidence === 'explicit-english-dub' ? 'Explicit English Dub' : item.audioEvidence === 'possible-english-audio' ? 'Possible English Audio' : 'Unverified'}</span>{item.releaseType && <span><b>Release</b>{item.releaseType}</span>}{item.seeders !== null && <span><b>Seeders</b>{item.seeders.toLocaleString()}</span>}{item.provider && <span><b>Provider</b>{item.provider}</span>}<span><b>Info hash</b>{item.hash.slice(0, 12)}…</span>{item.fileIdx !== null && <span><b>File index</b>{item.fileIdx}</span>}{item.trackerCount > 0 && <span><b>Trackers</b>{item.trackerCount}</span>}</div>
                      <div className="magnet-line"><code>{item.magnet}</code><a href={item.magnet} aria-label="Open magnet">Open</a><button onClick={() => copyMagnet(item.magnet)} aria-label="Copy magnet"><Icon name="copy" size={14} /></button></div>
                      <p className="detail-note"><Icon name="bolt" size={13} /> {item.selectionReason || (providerMode === 'live' ? `${item.fallbackTrackersUsed ? 'Torrentio returned no trackers, so fallback trackers were added. ' : ''}The tracker magnet is recommended; use the raw magnet if your downloader manages its own tracker/DHT settings.` : 'Preview source selected by smallest known size.')}</p>
                      {item.candidates?.length > 1 && <div className="alternatives-panel"><div className="alternatives-heading"><span className="detail-label">TOP ALTERNATIVES</span><span>Compared after hard filters</span></div>{item.candidates.slice(1, 4).map((candidate, index) => <div className="alternative-row" key={`${item.id}-alternative-${candidate.infoHash || index}`}><div><strong>{candidate.title || 'Untitled release'}</strong><span>{candidate.resolution || 'Resolution unknown'} · {candidate.sizeLabel || 'Size unknown'} · {candidate.seeders === null ? 'Seeders unknown' : `${candidate.seeders.toLocaleString()} seeders`}</span></div><em>{candidate.audioEvidence === 'explicit-english-dub' ? 'Explicit English Dub' : candidate.audioEvidence === 'possible-english-audio' ? 'Possible English Audio' : 'Audio unverified'}</em></div>)}</div>}
                      {geminiAnalysis[item.id] && <div className={`gemini-panel ${geminiAnalysis[item.id].error ? 'is-error' : ''}`}><div className="gemini-panel-heading"><span className="gemini-label">GEMINI ASSIST</span>{(geminiAnalysis[item.id].recommendation?.confidence || geminiAnalysis[item.id].confidence) && <strong>{geminiAnalysis[item.id].recommendation?.confidence || geminiAnalysis[item.id].confidence} confidence</strong>}</div>{geminiAnalysis[item.id].error ? <p>{geminiAnalysis[item.id].error}</p> : <><p>{geminiAnalysis[item.id].recommendation?.reason || geminiAnalysis[item.id].reason || 'No explanation returned.'}</p>{(geminiAnalysis[item.id].recommendation?.warnings || geminiAnalysis[item.id].warnings)?.length > 0 && <ul>{(geminiAnalysis[item.id].recommendation?.warnings || geminiAnalysis[item.id].warnings).map((warning, index) => <li key={`${item.id}-warning-${index}`}>{warning}</li>)}</ul>}<small>Torrentio’s deterministic selection remains the download source.</small></>}</div>}
                    </> : <div className="empty-source"><Icon name="x" size={17} /><div><strong>{item.preview ? 'Preview data is not downloadable' : 'No valid 1080p source found'}</strong><span>{item.preview ? 'Torrentio was unavailable during this scan. Run Check sources again to retrieve a real magnet.' : (item.sourceError || 'Try again later — provider availability can change.')}</span></div></div>}
                  </div>}
                </div>)}
              </div>
            </>}

            {!episodes.length && !checking && <div className="pre-scan"><div className="pre-scan-icon"><Icon name="bolt" size={21} /></div><div><strong>Ready to scan {selected.title}</strong><span>Select a season and check sources to see episode availability.</span></div><button className="text-action" onClick={checkSources}>Run first scan <Icon name="arrow" size={14} /></button></div>}
          </section>
        )}
      </main>

      <footer className="footer"><div><span className="footer-mark">SF</span><span>SeasonFetch</span></div><span>Metadata: Cinemeta live <i /> Sources: Torrentio proxy <i /> 1080p normalized</span></footer>
      {toast && <div className="toast"><span className="toast-icon"><Icon name="check" size={14} /></span>{toast}</div>}
      {showAuth && supabase && <AuthPanel key={authMode} supabase={supabase} initialMode={authMode} onClose={() => { setShowAuth(false); setAuthMode('sign-in'); }} />}
      {showAdmin && isAdmin && <AdminDashboard supabase={supabase} onClose={() => setShowAdmin(false)} />}
    </div>
  );
}

export default App;
