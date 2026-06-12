/** A voice model in the arena, as seeded from the (currently mock) catalog. */
export type ArenaRow = {
  id: string;
  provider: string;
  model: string;
  /** Blind-preference Elo standing — the sole input to the Humanness score. */
  elo: number;
  uncertainty: number;
  wins: number;
  losses: number;
  ties: number;
  likelyRank: string;
  /** Seeds the per-voice visual/voice fingerprint. */
  voiceProfile: number;
};

/** Humanness is purely vote-derived, so a scored model is just an arena row. */
export type ScoredModel = ArenaRow;

/** A tight single-hue color ramp the canvas visualizers draw with. */
export type Palette = {
  name?: string;
  from: string;
  mid: string;
  to: string;
};

/** Per-voice seed + animation speed that the canvas draw functions consume. */
export type VoiceFingerprint = {
  p: number;
  speed: number;
};

/** A head-to-head round: one prompt read by two real voices. */
export type HeroBattle = {
  prompt: string;
  leftModelId: string;
  rightModelId: string;
  leftAudio: string;
  rightAudio: string;
  /** Signed server token required to record the vote (null for offline fallbacks). */
  voteToken: string | null;
};

export type BattleSide = 'left' | 'right';
export type VoteChoice = BattleSide | 'tie';

/** Sortable rankings-table columns. */
export type TableSortKey =
  | 'rank'
  | 'provider'
  | 'humanness'
  | 'latency'
  | 'price'
  | 'votes';
export type TableSort = { key: TableSortKey; dir: 'asc' | 'desc' };

/** idle → playing → ready → (revealed, tracked separately) */
export type RoundPhase = 'idle' | 'playing' | 'ready';
