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
  /**
   * The Human baseline reference row (derived from the registry entry's
   * `baseline` flag). Pinned to the top, scored 100, and excluded from the
   * counts, the highlight cards, and the latency chart.
   */
  baseline?: boolean;
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

/**
 * A blind head-to-head round: two opaque audio clips. By design it carries NO
 * model identities on the live path — the matchup lives only in the signed
 * `voteToken`, and the client learns who was who from the vote response.
 */
export type HeroBattle = {
  prompt: string;
  leftAudio: string;
  rightAudio: string;
  /** Signed server token required to record the vote (null for offline fallbacks). */
  voteToken: string | null;
  /**
   * OFFLINE-ONLY fallback identities (the bundled fallback rounds, used when
   * the battle API is unreachable). The live /api/battle response is
   * identity-free; these stay UNSET on the live path and only let the
   * offline/dev reveal show identities. Never read for the live (token) path.
   */
  leftModelId?: string;
  rightModelId?: string;
};

/** One revealed side after a vote: identity + its post-vote score/rank/shift. */
export type RevealCard = {
  model: ScoredModel;
  /** Competitor rank (ignores the Human baseline; 0 for a baseline). */
  rank: number;
  humanness: number;
  /** Signed Elo shift this vote produced for the side. */
  eloDelta: number;
};

/**
 * The post-vote reveal, built entirely from the vote response (the client
 * never held the pre-vote identities). Drives the unmasked cards + result copy.
 */
export type RoundReveal = {
  winner: VoteChoice;
  /** Pick agreed with the crowd (server-judged on pre-vote standings). */
  correct: boolean;
  left: RevealCard;
  right: RevealCard;
};

export type BattleSide = 'left' | 'right';
export type VoteChoice = BattleSide | 'tie';

/** Sortable rankings-table columns. */
export type TableSortKey =
  | 'rank'
  | 'provider'
  | 'humanness'
  | 'elo'
  | 'latency'
  | 'price'
  | 'votes';
export type TableSort = { key: TableSortKey; dir: 'asc' | 'desc' };

/** idle → playing → ready → (revealed, tracked separately) */
export type RoundPhase = 'idle' | 'playing' | 'ready';
