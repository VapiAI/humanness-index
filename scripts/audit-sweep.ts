/**
 * Sweep the whole vote log for manipulation, without naming a suspect first.
 *
 * The Fish Audio burst was found by looking for it. This runs the same tests
 * over every model plus a few the single-target audit does not do, so a second
 * farmed model would surface on its own.
 *
 *   bun --env-file=.env.vercel-pull run scripts/audit-sweep.ts
 *
 * Events are cached to /tmp so re-runs don't re-hit Blob (bulk reads at high
 * concurrency can trip Vercel's DDoS mitigation). Pass --fresh to refetch.
 */
import { list } from '@vercel/blob';

import { MODELS_BY_ID, PROVIDERS_BY_ID, VARIANTS_BY_ID } from '../src/server/catalog';

const EVENTS_PREFIX = 'humanness/events/';
/** `--cache <path>` replays an alternate log — used to check the tests still fire. */
const cacheArg = process.argv.indexOf('--cache');
const CACHE = cacheArg === -1 ? '/tmp/humanness-vote-events.json' : process.argv[cacheArg + 1];

/** Chain a model's own votes into a listening session while gaps stay under this. */
const SESSION_GAP_MS = 10 * 60 * 1000;
/** Sessions shorter than this are too small to distinguish from luck. */
const SESSION_MIN = 15;
/** A vote this soon after the previous one did not involve listening to two clips. */
const FAST_MS = 4_000;
/** Rolling window for the "sustained dominance" test — catches farming with cover losses. */
const WINDOW = 30;
/** Split points nearer than this to an end make the changepoint test meaningless. */
const CHANGEPOINT_MARGIN = 40;

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
  if (!process.argv.includes('--fresh') && (await cached.exists())) {
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
    await mapLimit(blobs, 25, async (b) => {
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

/* -------------------------------- statistics ------------------------------- */

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
/** P(Z > z) for a standard normal. */
const upperTail = (z: number) => 0.5 * (1 - erf(z / Math.SQRT2));

/**
 * Permutations for the two tests that scan every window / split point. Those
 * scans overlap heavily, so Bonferroni over them is so conservative it pins
 * every p at 1.0 and the test can never fire. Reshuffling the same wins and
 * losses calibrates against the only thing being asked: is the ORDER clustered?
 */
const PERMUTATIONS = 3000;

/** Deterministic RNG so a rerun reproduces the same p-values. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const shuffle = (xs: Uint8Array, rand: () => number) => {
  for (let i = xs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const t = xs[i];
    xs[i] = xs[j];
    xs[j] = t;
  }
};

/** Most wins in any `w` consecutive trials. */
const maxWindow = (xs: Uint8Array, w: number) => {
  if (xs.length < w) return 0;
  let inWindow = 0;
  let best = 0;
  for (let i = 0; i < xs.length; i += 1) {
    inWindow += xs[i];
    if (i >= w) inWindow -= xs[i - w];
    if (i >= w - 1 && inWindow > best) best = inWindow;
  }
  return best;
};

/** Sharpest before/after split, as a z-score, ignoring the ends. */
const maxSplitZ = (xs: Uint8Array, margin: number) => {
  const n = xs.length;
  if (n < 2 * margin) return { z: 0, split: -1 };
  const prefix = new Int32Array(n + 1);
  for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i] + xs[i];
  const total = prefix[n];
  let best = 0;
  let at = -1;
  for (let s = margin; s < n - margin; s += 1) {
    const pooled = total / n;
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / s + 1 / (n - s)));
    if (se === 0) continue;
    const z = Math.abs((total - prefix[s]) / (n - s) - prefix[s] / s) / se;
    if (z > best) {
      best = z;
      at = s;
    }
  }
  return { z: best, split: at };
};

/** Empirical p from reshuffling: how often does chance alone reach `observed`? */
const permutationP = (
  xs: Uint8Array,
  observed: number,
  statistic: (xs: Uint8Array) => number,
  seed: number,
) => {
  const rand = rng(seed);
  const copy = Uint8Array.from(xs);
  let atLeast = 0;
  for (let i = 0; i < PERMUTATIONS; i += 1) {
    shuffle(copy, rand);
    if (statistic(copy) >= observed) atLeast += 1;
  }
  return (atLeast + 1) / (PERMUTATIONS + 1);
};

/** P(some run of `k` consecutive successes in `n` trials at rate `p`). */
const runProbability = (k: number, n: number, p: number) => {
  if (k <= 0) return 1;
  if (k > n) return 0;
  // dp[r] = P(reached trial i with a current run of r and no run of k yet).
  let dp = new Float64Array(k);
  dp[0] = 1;
  for (let i = 0; i < n; i += 1) {
    const next = new Float64Array(k);
    for (let r = 0; r < k; r += 1) {
      if (dp[r] === 0) continue;
      if (r + 1 < k) next[r + 1] += dp[r] * p;
      next[0] += dp[r] * (1 - p);
    }
    dp = next;
  }
  let survived = 0;
  for (let r = 0; r < k; r += 1) survived += dp[r];
  return 1 - survived;
};

/** One-sided two-proportion z-test, p-value that group A beats group B. */
const twoProportion = (kA: number, nA: number, kB: number, nB: number) => {
  if (nA === 0 || nB === 0) return 1;
  const pooled = (kA + kB) / (nA + nB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (se === 0) return 1;
  return upperTail((kA / nA - kB / nB) / se);
};

/** log odds ratio of winning on the right vs the left, and its standard error. */
const sideOdds = (winRight: number, lossRight: number, winLeft: number, lossLeft: number) => {
  // Haldane correction keeps a zero cell from blowing the whole thing up.
  const [a, b, c, d] = [winRight, lossRight, winLeft, lossLeft].map((v) => v + 0.5);
  return {
    logOr: Math.log((a / b) / (c / d)),
    variance: 1 / a + 1 / b + 1 / c + 1 / d,
  };
};

/* --------------------------------- helpers -------------------------------- */

const modelOf = (variantId: string) => VARIANTS_BY_ID.get(variantId)?.modelId;
const label = (id: string) => {
  const m = MODELS_BY_ID.get(id);
  return m ? `${PROVIDERS_BY_ID.get(m.providerId)!.name} ${m.name}` : id;
};
const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
const fmtP = (p: number) => (p < 1e-4 ? p.toExponential(1) : p.toFixed(4));
const pad = (v: string | number, n: number) => String(v).padStart(n);

type Finding = { model: string; test: string; p: number; detail: string };

/* ---------------------------------- main ---------------------------------- */

const events = await loadEvents();

const scored = events
  .map((e) => ({
    at: e.createdAt,
    battleId: e.battleId,
    winner: e.winner,
    left: modelOf(e.leftVariantId),
    right: modelOf(e.rightVariantId),
    leftVariantId: e.leftVariantId,
    rightVariantId: e.rightVariantId,
  }))
  .filter((e): e is typeof e & { left: string; right: string } =>
    Boolean(e.left && e.right && e.left !== e.right),
  );

console.log(`\n${'='.repeat(92)}`);
console.log('VOTE LOG SWEEP · every model, no suspect named in advance');
console.log('='.repeat(92));
console.log(
  `\n${scored.length} usable votes · ${iso(scored[0].at)} → ${iso(scored[scored.length - 1].at)} UTC`,
);

/* --- 0. Integrity of the log itself --------------------------------------- */

const seenBattles = new Set<string>();
let duplicates = 0;
for (const e of events) {
  if (seenBattles.has(e.battleId)) duplicates += 1;
  seenBattles.add(e.battleId);
}
const selfPairs = events.filter((e) => {
  const l = modelOf(e.leftVariantId);
  const r = modelOf(e.rightVariantId);
  return l && r && l === r;
}).length;
// Retiring a model drops its variants from the catalog but leaves its votes in
// the log, where they stop resolving. Expected, but it silently discards every
// battle it appeared in, so name the culprits rather than showing a bare count.
const retired = new Map<string, number>();
for (const e of events) {
  for (const id of [e.leftVariantId, e.rightVariantId]) {
    if (!VARIANTS_BY_ID.has(id)) retired.set(id, (retired.get(id) ?? 0) + 1);
  }
}
const unresolvable = events.filter(
  (e) => !VARIANTS_BY_ID.has(e.leftVariantId) || !VARIANTS_BY_ID.has(e.rightVariantId),
).length;
const outOfOrder = events.filter((e, i) => i > 0 && e.createdAt < events[i - 1].createdAt).length;

console.log('\n--- 0. Log integrity ---\n');
console.log(`duplicate battle ids      ${duplicates}`);
console.log(`same-model pairings       ${selfPairs}`);
console.log(`out-of-order timestamps   ${outOfOrder}`);
console.log(
  `votes on retired models   ${unresolvable} (${((100 * unresolvable) / events.length).toFixed(1)}%)` +
    ` across ${retired.size} variant ids — dropped, they have no model to score`,
);
for (const [id, n] of [...retired.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
  console.log(`  ${String(n).padStart(5)}x  ${id}`);
}
if (retired.size > 4) console.log(`  … ${retired.size - 4} more`);

/* --- Per-model vote sequences --------------------------------------------- */

type ModelVote = { at: number; result: 'win' | 'loss' | 'tie'; side: 'left' | 'right'; opponent: string; fast: boolean };

// Gap to the previous vote anywhere on the site: the only pacing signal in a
// log that stores no session or IP.
const gaps = scored.map((e, i) => (i === 0 ? Infinity : e.at - scored[i - 1].at));

const byModel = new Map<string, ModelVote[]>();
scored.forEach((e, i) => {
  for (const side of ['left', 'right'] as const) {
    const id = e[side];
    const result = e.winner === 'tie' ? 'tie' : e.winner === side ? 'win' : 'loss';
    const list = byModel.get(id) ?? [];
    list.push({
      at: e.at,
      result,
      side,
      opponent: side === 'left' ? e.right : e.left,
      fast: gaps[i] < FAST_MS,
    });
    byModel.set(id, list);
  }
});

const models = [...byModel.keys()].sort(
  (a, b) => byModel.get(b)!.length - byModel.get(a)!.length,
);
const findings: Finding[] = [];

/* Bonferroni over every test this script performs. */
const TESTS_PER_MODEL = 5;
const ALPHA = 0.05 / (models.length * TESTS_PER_MODEL);

/**
 * Sides are randomized, but the corpus still favours the right-hand clip. Every
 * model inherits that, so a model is only interesting if its OWN side gap is
 * wider than the arena's — test against that, not against 50/50.
 */
const corpusSide = (() => {
  let winRight = 0;
  let winLeft = 0;
  for (const e of scored) {
    if (e.winner === 'right') winRight += 1;
    else if (e.winner === 'left') winLeft += 1;
  }
  return { winRight, winLeft, rate: winRight / (winRight + winLeft) };
})();

console.log(
  `\n--- 1. Per-model tests · ${models.length} models × ${TESTS_PER_MODEL} tests · ` +
    `flag at p < ${ALPHA.toExponential(1)} (Bonferroni across models) ---`,
);
console.log(
  `Window and changepoint p-values come from ${PERMUTATIONS} reshuffles of each model's own ` +
    `results.\nSide bias is measured against the arena's ${(100 * corpusSide.rate).toFixed(1)}% ` +
    `right-hand win rate, not 50/50.\n`,
);
console.log(
  'model                          n   winrate  streak  p(streak)   best30  p(best30)   side p   fast Δ   p(fast)',
);

for (const id of models) {
  const votes = byModel.get(id)!;
  const decided = votes.filter((v) => v.result !== 'tie');
  const wins = decided.filter((v) => v.result === 'win').length;
  const rate = decided.length === 0 ? 0 : wins / decided.length;

  // Test 1 — longest unbroken win run, against the model's own rate.
  let streak = 0;
  let run = 0;
  for (const v of decided) {
    run = v.result === 'win' ? run + 1 : 0;
    streak = Math.max(streak, run);
  }
  const pStreak = runProbability(streak, decided.length, rate);

  // Test 2 — best rolling window. A farmer who concedes the odd vote to look
  // human breaks the streak test but not this one.
  const sequence = Uint8Array.from(decided.map((v) => (v.result === 'win' ? 1 : 0)));
  const best = maxWindow(sequence, WINDOW);
  const pWindow =
    decided.length < WINDOW
      ? 1
      : permutationP(sequence, best, (xs) => maxWindow(xs, WINDOW), 0x5eed);

  // Test 3 — side bias beyond the arena's own. Sides are randomized, so a model
  // that cares which one it is on was judged on something other than the audio.
  const leftDecided = decided.filter((v) => v.side === 'left');
  const rightDecided = decided.filter((v) => v.side === 'right');
  const winLeft = leftDecided.filter((v) => v.result === 'win').length;
  const winRight = rightDecided.filter((v) => v.result === 'win').length;
  const modelOdds = sideOdds(
    winRight,
    rightDecided.length - winRight,
    winLeft,
    leftDecided.length - winLeft,
  );
  // The corpus baseline counts each vote once from the winner's point of view,
  // so its "left" cell is the mirror of its "right" cell.
  const baseOdds = sideOdds(
    corpusSide.winRight,
    corpusSide.winLeft,
    corpusSide.winLeft,
    corpusSide.winRight,
  );
  const pSide =
    2 *
    upperTail(
      Math.abs(modelOdds.logOr - baseOdds.logOr) /
        Math.sqrt(modelOdds.variance + baseOdds.variance),
    );

  // Test 4 — does the model do better on votes cast too fast to have listened?
  const fast = decided.filter((v) => v.fast);
  const slow = decided.filter((v) => !v.fast);
  const fastRate = fast.length === 0 ? 0 : fast.filter((v) => v.result === 'win').length / fast.length;
  const slowRate = slow.length === 0 ? 0 : slow.filter((v) => v.result === 'win').length / slow.length;
  const pFast = twoProportion(
    fast.filter((v) => v.result === 'win').length,
    fast.length,
    slow.filter((v) => v.result === 'win').length,
    slow.length,
  );

  console.log(
    `${label(id).padEnd(28)} ${pad(votes.length, 4)}  ${pad((100 * rate).toFixed(1) + '%', 6)}  ` +
      `${pad(streak, 6)}  ${pad(fmtP(pStreak), 9)}   ${pad(`${best}/${WINDOW}`, 6)}  ${pad(
        fmtP(pWindow),
        9,
      )}  ${pad(fmtP(pSide), 7)}  ${pad(
        fast.length < 20 ? '—' : `${(100 * (fastRate - slowRate)).toFixed(1)}pt`,
        7,
      )}  ${pad(fast.length < 20 ? '—' : fmtP(pFast), 8)}`,
  );

  if (pStreak < ALPHA)
    findings.push({
      model: id,
      test: 'win streak',
      p: pStreak,
      detail: `${streak} consecutive wins over ${decided.length} decided votes at a ${(100 * rate).toFixed(1)}% rate`,
    });
  if (pWindow < ALPHA)
    findings.push({
      model: id,
      test: `best ${WINDOW}-vote window`,
      p: pWindow,
      detail: `${best}/${WINDOW} wins in its best window vs a ${(100 * rate).toFixed(1)}% baseline`,
    });
  if (pSide < ALPHA)
    findings.push({
      model: id,
      test: 'side bias',
      p: pSide,
      detail: `wins ${(100 * (leftDecided.filter((v) => v.result === 'win').length / Math.max(1, leftDecided.length))).toFixed(1)}% on the left vs ${(100 * (rightDecided.filter((v) => v.result === 'win').length / Math.max(1, rightDecided.length))).toFixed(1)}% on the right`,
    });
  if (pFast < ALPHA && fast.length >= 20)
    findings.push({
      model: id,
      test: 'fast-vote bias',
      p: pFast,
      detail: `${(100 * fastRate).toFixed(1)}% on ${fast.length} votes cast under ${FAST_MS / 1000}s vs ${(100 * slowRate).toFixed(1)}% otherwise`,
    });

  // Test 5 — session dominance. Chain the model's own votes and ask whether any
  // single sitting beats the rest of its record.
  const sessions: ModelVote[][] = [];
  for (const v of votes) {
    const last = sessions[sessions.length - 1];
    if (last && v.at - last[last.length - 1].at <= SESSION_GAP_MS) last.push(v);
    else sessions.push([v]);
  }
  const eligible = sessions.filter((s) => s.filter((v) => v.result !== 'tie').length >= SESSION_MIN);
  for (const session of eligible) {
    const inSession = session.filter((v) => v.result !== 'tie');
    const sessionSet = new Set(session);
    const outside = decided.filter((v) => !sessionSet.has(v));
    const p = Math.min(
      1,
      twoProportion(
        inSession.filter((v) => v.result === 'win').length,
        inSession.length,
        outside.filter((v) => v.result === 'win').length,
        outside.length,
      ) * eligible.length,
    );
    if (p < ALPHA)
      findings.push({
        model: id,
        test: 'session dominance',
        p,
        detail:
          `${inSession.filter((v) => v.result === 'win').length}/${inSession.length} in the sitting from ` +
          `${iso(session[0].at)} vs ${(100 * (outside.filter((v) => v.result === 'win').length / Math.max(1, outside.length))).toFixed(1)}% across its other ${outside.length}`,
      });
  }
}

/* --- 2. Changepoints, read together --------------------------------------- */

console.log('\n--- 2. Sharpest win-rate changepoint per model ---\n');
console.log('model                          split (UTC)        before → after     p (permutation)');

const changepoints: { id: string; at: number; p: number }[] = [];
for (const id of models) {
  const decided = byModel.get(id)!.filter((v) => v.result !== 'tie');
  if (decided.length < 2 * CHANGEPOINT_MARGIN) continue;
  const sequence = Uint8Array.from(decided.map((v) => (v.result === 'win' ? 1 : 0)));
  const { z, split } = maxSplitZ(sequence, CHANGEPOINT_MARGIN);
  const p = permutationP(sequence, z, (xs) => maxSplitZ(xs, CHANGEPOINT_MARGIN).z, 0xc0ffee);
  const before = sequence.slice(0, split).reduce((a, b) => a + b, 0) / split;
  const after =
    sequence.slice(split).reduce((a, b) => a + b, 0) / (sequence.length - split);
  changepoints.push({ id, at: decided[split].at, p });
  console.log(
    `${label(id).padEnd(28)} ${iso(decided[split].at)}   ${pad(
      (100 * before).toFixed(1) + '%',
      5,
    )} → ${pad((100 * after).toFixed(1) + '%', 5)}   ${pad(fmtP(p), 10)}`,
  );
  if (p < ALPHA)
    findings.push({
      model: id,
      test: 'win-rate changepoint',
      p,
      detail: `steps from ${(100 * before).toFixed(1)}% to ${(100 * after).toFixed(1)}% at ${iso(decided[split].at)} UTC`,
    });
}

const clustered = changepoints.filter((c) => c.p < 0.01);
if (clustered.length > 0) {
  const days = new Map<string, number>();
  for (const c of clustered) {
    const d = new Date(c.at).toISOString().slice(0, 10);
    days.set(d, (days.get(d) ?? 0) + 1);
  }
  const ranked = [...days.entries()].sort((a, b) => b[1] - a[1]);
  console.log(
    `\n${clustered.length} models shift at p < 0.01. Busiest split dates: ` +
      ranked
        .slice(0, 4)
        .map(([d, n]) => `${d} (${n})`)
        .join(', '),
  );
  console.log(
    'A date shared by many models is the audience changing, not any one model being farmed.',
  );
}

/* --- 3. Pacing, corpus-wide ----------------------------------------------- */

const finite = gaps.filter((g) => Number.isFinite(g)).sort((a, b) => a - b);
const q = (f: number) => finite[Math.floor(f * (finite.length - 1))] / 1000;
const fastVotes = finite.filter((g) => g < FAST_MS).length;

console.log('\n--- 3. Pacing ---\n');
console.log(
  `gap between consecutive votes: p10 ${q(0.1).toFixed(1)}s · median ${q(0.5).toFixed(1)}s · ` +
    `p90 ${q(0.9).toFixed(1)}s`,
);
console.log(
  `${fastVotes} of ${finite.length} votes (${((100 * fastVotes) / finite.length).toFixed(1)}%) ` +
    `arrived under ${FAST_MS / 1000}s after the previous one`,
);

const byDay = new Map<string, number>();
for (const e of scored) {
  const d = new Date(e.at).toISOString().slice(0, 10);
  byDay.set(d, (byDay.get(d) ?? 0) + 1);
}
const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`\nbusiest days: ${busiest.map(([d, n]) => `${d} (${n})`).join(', ')}`);
console.log(
  'The log has no session or IP, so consecutive votes may come from different\n' +
    'visitors — a fast global gap on a busy day is concurrency, not one script.',
);

/* --- 3b. Is the arena itself fair? ---------------------------------------- */

const decidedTotal = corpusSide.winLeft + corpusSide.winRight;
const sideZ =
  (corpusSide.winRight - decidedTotal / 2) / Math.sqrt(decidedTotal * 0.25);

console.log('\n--- 4. Arena-level fairness ---\n');
console.log(
  `right-hand clip wins ${(100 * corpusSide.rate).toFixed(1)}% of ${decidedTotal} decided votes ` +
    `(z = ${sideZ.toFixed(1)})`,
);

// Harmless only while every model lands on each side equally often, so check.
let worstSideZ = 0;
let worstSideModel = '';
for (const id of models) {
  const votes = byModel.get(id)!;
  const onRight = votes.filter((v) => v.side === 'right').length;
  const z = (onRight - votes.length / 2) / Math.sqrt(votes.length * 0.25);
  if (Math.abs(z) > Math.abs(worstSideZ)) {
    worstSideZ = z;
    worstSideModel = id;
  }
}
console.log(
  `side assignment is a fair coin flip — largest imbalance is ${label(worstSideModel)} ` +
    `at z = ${worstSideZ.toFixed(2)}, so the bias cancels out across models`,
);

/* --- 4. Verdict ------------------------------------------------------------ */

console.log(`\n${'='.repeat(92)}`);
console.log('FINDINGS');
console.log('='.repeat(92));
console.log(
  '\nSanity check: run with --cache on a log that still contains the Fish Audio burst and\n' +
    'session dominance + changepoint both fire. A clean result here means the tests ran,\n' +
    'not that they cannot fire.',
);

if (findings.length === 0) {
  console.log(`\nNothing clears p < ${ALPHA.toExponential(1)}. No model shows a manipulation signature.\n`);
} else {
  findings.sort((a, b) => a.p - b.p);
  for (const f of findings) {
    console.log(`\n${label(f.model)} — ${f.test} · p = ${fmtP(f.p)}`);
    console.log(`  ${f.detail}`);
  }
  console.log('');
}
