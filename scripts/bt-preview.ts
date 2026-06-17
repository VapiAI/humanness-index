/**
 * Preview the Bradley–Terry standings on the REAL production vote log, without
 * changing anything. Reads every immutable vote event from Blob (no mutation),
 * folds the seed export as anchor games, fits BT + bootstrap rank ranges, and
 * prints the new rankings next to the current online-Elo ones.
 *
 *   BLOB_READ_WRITE_TOKEN=... bun run scripts/bt-preview.ts
 */
import { list } from '@vercel/blob';

import {
  MODELS_BY_ID,
  PROVIDERS_BY_ID,
  VARIANTS,
  VARIANTS_BY_ID,
} from '../src/server/catalog';
import {
  bootstrapRankRange,
  bradleyTerryFit,
  formatRankRange,
  type AnchorRecord,
  type Outcome,
} from '../src/server/bradleyTerry';
import seedStandings from '../src/server/seed-standings.json';

const EVENTS_PREFIX = 'humanness/events/';

type VoteEvent = {
  battleId: string;
  winner: 'left' | 'right' | 'tie';
  leftVariantId: string;
  rightVariantId: string;
  createdAt: number;
};

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('BLOB_READ_WRITE_TOKEN not set — cannot read the production vote log.');
  process.exit(1);
}

const fetchJson = async <T>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
};

const main = async () => {
  // 1. List + fetch every immutable vote event (read-only).
  const blobs: { url: string; pathname: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: EVENTS_PREFIX, token, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  console.error(`Fetching ${blobs.length} vote events…`);
  const events = (await mapLimit(blobs, 64, (b) => fetchJson<VoteEvent>(b.url))).filter(
    (e): e is VoteEvent => e !== null,
  );

  // 2. Live pairwise outcomes at the MODEL level (variant → model).
  const variantModel = (variantId: string) => VARIANTS_BY_ID.get(variantId)?.modelId;
  const outcomes: Outcome[] = [];
  for (const e of events) {
    const left = variantModel(e.leftVariantId);
    const right = variantModel(e.rightVariantId);
    if (!left || !right || left === right) continue;
    outcomes.push({ left, right, winner: e.winner });
  }

  // 3. Seed export → anchor games (no loss: these still count + move ratings).
  const anchors = new Map<string, AnchorRecord>();
  for (const m of seedStandings.models) {
    if (!MODELS_BY_ID.has(m.id)) continue;
    anchors.set(m.id, { wins: m.wins, losses: m.losses, ties: m.ties });
  }

  const players = [...new Set(VARIANTS.map((v) => v.modelId))];
  const input = { players, outcomes, anchors, prior: 1 };

  // 4. Fit + bootstrap likely-rank over the competitors (excludes the Human).
  const { ratings } = bradleyTerryFit(input);
  const competitors = players.filter((id) => id !== 'human');
  const ranges = bootstrapRankRange(input, competitors, { resamples: 300 });

  // 5. Humanness transform (same as the app: anchor on the human, floor at the
  //    worst, top uncapped).
  const human = ratings.get('human') ?? 1200;
  const minElo = Math.min(...players.map((p) => ratings.get(p) ?? 1200));
  const humanness = (elo: number, isHuman: boolean) =>
    isHuman
      ? 100
      : Math.max(0, Math.round(((elo - minElo) / (human - minElo)) * 100));

  // Per-model live vote counts (for context).
  const liveVotes = new Map<string, number>();
  for (const o of outcomes) {
    liveVotes.set(o.left, (liveVotes.get(o.left) ?? 0) + 1);
    liveVotes.set(o.right, (liveVotes.get(o.right) ?? 0) + 1);
  }
  const seedVotes = new Map(seedStandings.models.map((m) => [m.id, m.voteCount]));

  // Current online-Elo standings for comparison.
  const current = await fetchJson<{
    models: { id: string; elo: number; rankRange: string }[];
  }>('https://humannessindex.vapi.ai/api/models');
  const currentById = new Map(
    (current?.models ?? []).map((m) => [m.id, m]),
  );

  const sorted = [...players].sort((a, z) => (ratings.get(z) ?? 0) - (ratings.get(a) ?? 0));
  const name = (id: string) => {
    const m = MODELS_BY_ID.get(id)!;
    const provider = PROVIDERS_BY_ID.get(m.providerId)!.name;
    return id === 'human' ? 'Human (Homo Sapien)' : `${provider} ${m.name}`;
  };

  console.log(
    `\nBradley–Terry preview · ${events.length} live events + ${seedStandings.totalUniqueVotes} seed votes\n`,
  );
  console.log(
    'BT   model                           BTrating  Human  likelyRank   (now: Elo / rank)   votes',
  );
  let rank = 0;
  for (const id of sorted) {
    const isHuman = id === 'human';
    if (!isHuman) rank += 1;
    const bt = ratings.get(id)!;
    const h = humanness(bt, isHuman);
    const lr = isHuman ? 'Baseline' : formatRankRange(ranges.get(id)!);
    const cur = currentById.get(id);
    const curStr = cur ? `${Math.round(cur.elo)} / ${cur.rankRange}` : '—';
    const votes = (liveVotes.get(id) ?? 0) + (seedVotes.get(id) ?? 0);
    const rankLabel = isHuman ? ' — ' : `#${rank}`.padStart(3);
    console.log(
      `${rankLabel}  ${name(id).padEnd(30)}  ${Math.round(bt).toString().padStart(7)}  ${String(h).padStart(4)}   ${lr.padEnd(10)}  ${curStr.padEnd(18)}  ${votes}`,
    );
  }
  console.log('');
};

void main();
