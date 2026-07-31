/**
 * One-off vote-log audit: pull every immutable vote event from Blob (read-only)
 * and look for manipulation signatures around a target model.
 *
 *   bun --env-file=.env.vercel-pull run scripts/audit-votes.ts [modelId]
 *
 * Events are cached to /tmp so re-runs don't re-hit Blob (bulk reads at high
 * concurrency can trip Vercel's DDoS mitigation).
 */
import { list } from '@vercel/blob';

import { MODELS_BY_ID, PROVIDERS_BY_ID, VARIANTS, VARIANTS_BY_ID } from '../src/server/catalog';
import { bradleyTerryFit, type AnchorRecord, type Outcome } from '../src/server/bradleyTerry';
import seedStandings from '../src/server/seed-standings.json';

const EVENTS_PREFIX = 'humanness/events/';
const CACHE = '/tmp/humanness-vote-events.json';
const TARGET = process.argv[2] ?? 'fish-s21-pro';

type VoteEvent = {
  id: string;
  battleId: string;
  winner: 'left' | 'right' | 'tie';
  leftVariantId: string;
  rightVariantId: string;
  createdAt: number;
};

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error('BLOB_READ_WRITE_TOKEN not set');

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
};

const loadEvents = async (): Promise<VoteEvent[]> => {
  const cached = Bun.file(CACHE);
  if (await cached.exists()) {
    const events = (await cached.json()) as VoteEvent[];
    console.error(`Loaded ${events.length} cached events from ${CACHE}`);
    return events;
  }
  const blobs: { url: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: EVENTS_PREFIX, token, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  console.error(`Fetching ${blobs.length} vote events…`);
  const events = (
    await mapLimit(blobs, 32, async (b) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const res = await fetch(b.url, { cache: 'force-cache' });
          if (res.ok) return (await res.json()) as VoteEvent;
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
      return null;
    })
  ).filter((e): e is VoteEvent => e !== null);
  events.sort((a, b) => a.createdAt - b.createdAt);
  await Bun.write(CACHE, JSON.stringify(events));
  return events;
};

/* --------------------------------- helpers -------------------------------- */

const modelOf = (variantId: string) => VARIANTS_BY_ID.get(variantId)?.modelId;
const label = (id: string) => {
  const m = MODELS_BY_ID.get(id);
  if (!m) return id;
  return `${PROVIDERS_BY_ID.get(m.providerId)!.name} ${m.name}`;
};
const pct = (n: number, d: number) => (d === 0 ? '  —  ' : `${((100 * n) / d).toFixed(1)}%`);
const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const hour = (ms: number) => new Date(ms).toISOString().slice(0, 13).replace('T', ' ');
const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Two-sided binomial p-value (normal approx w/ continuity correction). */
const binomP = (k: number, n: number, p: number) => {
  if (n === 0) return 1;
  const mean = n * p;
  const sd = Math.sqrt(n * p * (1 - p));
  if (sd === 0) return 1;
  const z = (Math.abs(k - mean) - 0.5) / sd;
  return 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)));
};
const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
};

type Side = 'left' | 'right';

/* ---------------------------------- main ---------------------------------- */

const main = async () => {
  const events = await loadEvents();
  const scored = events
    .map((e) => ({
      ...e,
      left: modelOf(e.leftVariantId),
      right: modelOf(e.rightVariantId),
    }))
    .filter((e) => e.left && e.right && e.left !== e.right) as (VoteEvent & {
    left: string;
    right: string;
  })[];

  console.log(`\n${'='.repeat(88)}`);
  console.log(`VOTE LOG AUDIT · target = ${TARGET} (${label(TARGET)})`);
  console.log('='.repeat(88));
  console.log(
    `\n${scored.length} usable live vote events · ${iso(scored[0].createdAt)} → ${iso(
      scored[scored.length - 1].createdAt,
    )} (UTC)`,
  );

  /* ---- 1. per-model win rates (baseline for judging the target) ---- */
  type Tally = { app: number; w: number; l: number; t: number; first: number; last: number };
  const tally = new Map<string, Tally>();
  const bump = (id: string, r: 'w' | 'l' | 't', at: number) => {
    const cur = tally.get(id) ?? { app: 0, w: 0, l: 0, t: 0, first: at, last: at };
    cur.app += 1;
    cur[r] += 1;
    cur.first = Math.min(cur.first, at);
    cur.last = Math.max(cur.last, at);
    tally.set(id, cur);
  };
  for (const e of scored) {
    bump(e.left, e.winner === 'left' ? 'w' : e.winner === 'right' ? 'l' : 't', e.createdAt);
    bump(e.right, e.winner === 'right' ? 'w' : e.winner === 'left' ? 'l' : 't', e.createdAt);
  }

  console.log('\n--- 1. Live per-model record (excludes seed) ---\n');
  console.log(
    'model                             appears   share      W     L     T   winrate   first seen',
  );
  const rows = [...tally.entries()].sort((a, b) => b[1].app - a[1].app);
  for (const [id, t] of rows) {
    const decided = t.w + t.l;
    console.log(
      `${label(id).padEnd(32)} ${String(t.app).padStart(7)}  ${pct(t.app, scored.length * 2)}  ${String(
        t.w,
      ).padStart(5)} ${String(t.l).padStart(5)} ${String(t.t).padStart(5)}   ${pct(
        t.w,
        decided,
      )}   ${day(t.first)}${id === TARGET ? '   <== TARGET' : ''}`,
    );
  }

  const target = tally.get(TARGET);
  if (!target) {
    console.log(`\nNo live votes for ${TARGET}.`);
    return;
  }

  /* ---- 2. BT-expected vs actual, head to head ---- */
  const players = [...new Set(VARIANTS.map((v) => v.modelId))];
  const anchors = new Map<string, AnchorRecord>(
    seedStandings.models
      .filter((m) => MODELS_BY_ID.has(m.id))
      .map((m) => [m.id, { wins: m.wins, losses: m.losses, ties: m.ties }]),
  );
  const outcomes: Outcome[] = scored.map((e) => ({
    left: e.left,
    right: e.right,
    winner: e.winner,
  }));
  const { ratings } = bradleyTerryFit({ players, outcomes, anchors, prior: 1 });
  const expected = (a: string, b: string) =>
    1 / (1 + 10 ** (((ratings.get(b) ?? 1200) - (ratings.get(a) ?? 1200)) / 400));

  console.log('\n--- 2. Head-to-head for the target ---\n');
  console.log('opponent                          n     W     L     T   winrate   BT-expected');
  const h2h = new Map<string, { n: number; w: number; l: number; t: number }>();
  for (const e of scored) {
    if (e.left !== TARGET && e.right !== TARGET) continue;
    const opp = e.left === TARGET ? e.right : e.left;
    const won = (e.left === TARGET && e.winner === 'left') || (e.right === TARGET && e.winner === 'right');
    const tie = e.winner === 'tie';
    const cur = h2h.get(opp) ?? { n: 0, w: 0, l: 0, t: 0 };
    cur.n += 1;
    if (tie) cur.t += 1;
    else if (won) cur.w += 1;
    else cur.l += 1;
    h2h.set(opp, cur);
  }
  for (const [opp, r] of [...h2h.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `${label(opp).padEnd(32)} ${String(r.n).padStart(4)}  ${String(r.w).padStart(4)}  ${String(
        r.l,
      ).padStart(4)}  ${String(r.t).padStart(4)}   ${pct(r.w, r.w + r.l)}     ${(
        100 * expected(TARGET, opp)
      ).toFixed(1)}%`,
    );
  }

  /* ---- 3. side bias (sides are shuffled 50/50 at battle creation) ---- */
  const sideCount = { left: 0, right: 0 };
  const sideWin = { left: 0, right: 0 };
  for (const e of scored) {
    if (e.left !== TARGET && e.right !== TARGET) continue;
    const side: Side = e.left === TARGET ? 'left' : 'right';
    sideCount[side] += 1;
    if (e.winner === side) sideWin[side] += 1;
  }
  console.log('\n--- 3. Side placement / side bias ---\n');
  console.log(
    `target on left  ${sideCount.left} (won ${sideWin.left}, ${pct(sideWin.left, sideCount.left)})`,
  );
  console.log(
    `target on right ${sideCount.right} (won ${sideWin.right}, ${pct(sideWin.right, sideCount.right)})`,
  );
  console.log(
    `placement p (vs 50/50): ${binomP(sideCount.left, sideCount.left + sideCount.right, 0.5).toFixed(4)}`,
  );
  const allLeftWins = scored.filter((e) => e.winner === 'left').length;
  console.log(
    `corpus-wide left-win rate: ${pct(allLeftWins, scored.filter((e) => e.winner !== 'tie').length)}`,
  );

  /* ---- 4. daily timeline ---- */
  console.log('\n--- 4. Daily timeline (target) ---\n');
  console.log('date         allVotes   targetN     W     L     T   winrate');
  const days = new Map<string, { all: number; n: number; w: number; l: number; t: number }>();
  for (const e of scored) {
    const d = day(e.createdAt);
    const cur = days.get(d) ?? { all: 0, n: 0, w: 0, l: 0, t: 0 };
    cur.all += 1;
    if (e.left === TARGET || e.right === TARGET) {
      cur.n += 1;
      const won =
        (e.left === TARGET && e.winner === 'left') || (e.right === TARGET && e.winner === 'right');
      if (e.winner === 'tie') cur.t += 1;
      else if (won) cur.w += 1;
      else cur.l += 1;
    }
    days.set(d, cur);
  }
  for (const [d, c] of days) {
    if (c.n === 0 && c.all === 0) continue;
    console.log(
      `${d}   ${String(c.all).padStart(8)}  ${String(c.n).padStart(8)}  ${String(c.w).padStart(
        4,
      )}  ${String(c.l).padStart(4)}  ${String(c.t).padStart(4)}   ${pct(c.w, c.w + c.l)}`,
    );
  }

  /* ---- 5. burst sessions (chain votes by inter-vote gap) ---- */
  const GAP = 10 * 60 * 1000;
  type Session = {
    start: number;
    end: number;
    votes: (typeof scored)[number][];
    gaps: number[];
  };
  const sessions: Session[] = [];
  for (const e of scored) {
    const last = sessions[sessions.length - 1];
    if (last && e.createdAt - last.end <= GAP) {
      last.gaps.push(e.createdAt - last.end);
      last.end = e.createdAt;
      last.votes.push(e);
    } else {
      sessions.push({ start: e.createdAt, end: e.createdAt, votes: [e], gaps: [] });
    }
  }

  const baseWin = target.w / Math.max(1, target.w + target.l);
  console.log(
    `\n--- 5. Vote bursts (chained, gap <= 10 min) · ${sessions.length} bursts · target baseline winrate ${(
      100 * baseWin
    ).toFixed(1)}% ---\n`,
  );
  console.log(
    'start (UTC)          mins  votes  medGap  fastN   tgtN     W     L     T  tgt winrate    p',
  );
  const interesting = sessions
    .map((s) => {
      const tv = s.votes.filter((e) => e.left === TARGET || e.right === TARGET);
      const w = tv.filter(
        (e) => (e.left === TARGET && e.winner === 'left') || (e.right === TARGET && e.winner === 'right'),
      ).length;
      const t = tv.filter((e) => e.winner === 'tie').length;
      const l = tv.length - w - t;
      return { s, tv, w, l, t, p: binomP(w, w + l, baseWin) };
    })
    .filter((r) => r.s.votes.length >= 5)
    .sort((a, b) => b.s.votes.length - a.s.votes.length);

  for (const r of interesting.slice(0, 40)) {
    const mins = (r.s.end - r.s.start) / 60000;
    const med = median(r.s.gaps) / 1000;
    const fast = r.s.gaps.filter((g) => g < 4000).length;
    console.log(
      `${iso(r.s.start)}  ${mins.toFixed(0).padStart(4)}  ${String(r.s.votes.length).padStart(
        5,
      )}  ${med.toFixed(1).padStart(6)}s ${String(fast).padStart(5)}  ${String(r.tv.length).padStart(
        5,
      )}  ${String(r.w).padStart(4)}  ${String(r.l).padStart(4)}  ${String(r.t).padStart(4)}  ${pct(
        r.w,
        r.w + r.l,
      ).padStart(9)}  ${r.p < 0.01 ? r.p.toExponential(1) : r.p.toFixed(3)}`,
    );
  }

  /* ---- 6. timing: how long before each target vote ---- */
  console.log('\n--- 6. Inter-vote timing ---\n');
  const gapsAll: number[] = [];
  const gapsTargetWin: number[] = [];
  const gapsTargetLoss: number[] = [];
  for (let i = 1; i < scored.length; i += 1) {
    const gap = scored[i].createdAt - scored[i - 1].createdAt;
    if (gap > GAP) continue;
    gapsAll.push(gap);
    const e = scored[i];
    if (e.left !== TARGET && e.right !== TARGET) continue;
    const won =
      (e.left === TARGET && e.winner === 'left') || (e.right === TARGET && e.winner === 'right');
    if (e.winner === 'tie') continue;
    (won ? gapsTargetWin : gapsTargetLoss).push(gap);
  }
  const summarize = (name: string, xs: number[]) => {
    if (xs.length === 0) return console.log(`${name.padEnd(26)} n=0`);
    const s = [...xs].sort((a, b) => a - b);
    console.log(
      `${name.padEnd(26)} n=${String(xs.length).padStart(5)}  p10=${(s[Math.floor(s.length * 0.1)] / 1000).toFixed(
        1,
      )}s  med=${(median(xs) / 1000).toFixed(1)}s  p90=${(
        s[Math.floor(s.length * 0.9)] / 1000
      ).toFixed(1)}s  <4s=${pct(xs.filter((g) => g < 4000).length, xs.length)}`,
    );
  };
  summarize('all consecutive votes', gapsAll);
  summarize('votes where target WON', gapsTargetWin);
  summarize('votes where target LOST', gapsTargetLoss);

  /* ---- 7. hours with the most target votes ---- */
  console.log('\n--- 7. Top hours by target volume ---\n');
  const hours = new Map<string, { n: number; w: number; l: number; all: number }>();
  for (const e of scored) {
    const h = hour(e.createdAt);
    const cur = hours.get(h) ?? { n: 0, w: 0, l: 0, all: 0 };
    cur.all += 1;
    if (e.left === TARGET || e.right === TARGET) {
      cur.n += 1;
      const won =
        (e.left === TARGET && e.winner === 'left') || (e.right === TARGET && e.winner === 'right');
      if (e.winner !== 'tie') won ? (cur.w += 1) : (cur.l += 1);
    }
    hours.set(h, cur);
  }
  console.log('hour (UTC)       all  tgtN     W     L  winrate      p');
  for (const [h, c] of [...hours.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
    console.log(
      `${h}  ${String(c.all).padStart(5)} ${String(c.n).padStart(5)} ${String(c.w).padStart(
        5,
      )} ${String(c.l).padStart(5)}  ${pct(c.w, c.w + c.l).padStart(7)}  ${binomP(
        c.w,
        c.w + c.l,
        baseWin,
      ).toFixed(3)}`,
    );
  }

  /* ---- 8. repeated identical matchups ---- */
  console.log('\n--- 8. Most-repeated exact variant pairings involving the target ---\n');
  const pairs = new Map<string, { n: number; w: number; l: number; t: number }>();
  for (const e of scored) {
    if (e.left !== TARGET && e.right !== TARGET) continue;
    const key = [e.leftVariantId, e.rightVariantId].sort().join('  vs  ');
    const cur = pairs.get(key) ?? { n: 0, w: 0, l: 0, t: 0 };
    cur.n += 1;
    const won =
      (e.left === TARGET && e.winner === 'left') || (e.right === TARGET && e.winner === 'right');
    if (e.winner === 'tie') cur.t += 1;
    else won ? (cur.w += 1) : (cur.l += 1);
    pairs.set(key, cur);
  }
  for (const [k, v] of [...pairs.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12)) {
    console.log(`${String(v.n).padStart(4)}x  W${v.w} L${v.l} T${v.t}  ${pct(v.w, v.w + v.l)}  ${k}`);
  }

  /* ---- 9. what the target's rating looks like with bursts removed ---- */
  console.log('\n--- 9. Sensitivity: BT rating with suspicious bursts excluded ---\n');
  const flagged = new Set(
    interesting
      .filter((r) => r.tv.length >= 8 && r.p < 0.01 && r.w / Math.max(1, r.w + r.l) > baseWin)
      .flatMap((r) => r.s.votes.map((e) => e.battleId)),
  );
  console.log(`flagged bursts contribute ${flagged.size} votes`);
  const clean = scored.filter((e) => !flagged.has(e.battleId));
  const { ratings: cleanRatings } = bradleyTerryFit({
    players,
    outcomes: clean.map((e) => ({ left: e.left, right: e.right, winner: e.winner })),
    anchors,
    prior: 1,
  });
  const before = ratings.get(TARGET) ?? 1200;
  const after = cleanRatings.get(TARGET) ?? 1200;
  console.log(
    `target BT rating: ${before.toFixed(0)} (all votes) → ${after.toFixed(0)} (bursts removed) · Δ ${(
      after - before
    ).toFixed(0)}`,
  );
  const rank = (m: Map<string, number>) =>
    [...m.entries()]
      .filter(([id]) => id !== 'human')
      .sort((a, b) => b[1] - a[1])
      .findIndex(([id]) => id === TARGET) + 1;
  console.log(`target rank: #${rank(ratings)} → #${rank(cleanRatings)}`);

  /* ---- 10. longest unbroken win streak per model (ties ignored) ---- */
  console.log('\n--- 10. Longest unbroken win streak, every model ---\n');
  console.log('model                            appears  winrate  longest streak  P(streak | own winrate)');
  const streaks = new Map<string, number>();
  const running = new Map<string, number>();
  for (const e of scored) {
    for (const side of ['left', 'right'] as const) {
      const id = side === 'left' ? e.left : e.right;
      if (e.winner === 'tie') continue;
      const won = e.winner === side;
      const cur = won ? (running.get(id) ?? 0) + 1 : 0;
      running.set(id, cur);
      streaks.set(id, Math.max(streaks.get(id) ?? 0, cur));
    }
  }
  for (const [id, t] of [...tally.entries()].sort(
    (a, b) => (streaks.get(b[0]) ?? 0) - (streaks.get(a[0]) ?? 0),
  )) {
    const wr = t.w / Math.max(1, t.w + t.l);
    const s = streaks.get(id) ?? 0;
    console.log(
      `${label(id).padEnd(32)} ${String(t.app).padStart(7)}  ${(100 * wr).toFixed(1).padStart(6)}%  ${String(
        s,
      ).padStart(14)}  ${wr ** s < 1e-4 ? (wr ** s).toExponential(1) : (wr ** s).toFixed(4)}${
        id === TARGET ? '   <== TARGET' : ''
      }`,
    );
  }
  console.log('');
};

void main();
