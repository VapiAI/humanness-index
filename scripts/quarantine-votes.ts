/**
 * Move a model's anomalous vote session out of the standings.
 *
 * The vote log is append-only and every event blob is the duplicate-vote guard
 * for its battle, so nothing is deleted outright: flagged events are copied to
 * `humanness/quarantine/` first and only then removed from `humanness/events/`,
 * which makes this reversible and leaves the record intact.
 *
 * The session is picked by the one signature that survives every innocent
 * explanation — an unbroken win streak far past what the model's own win rate
 * can produce. Coverage-forced pairing explains why a new model appears in
 * every battle; it cannot explain why it stops losing.
 *
 *   bun --env-file=.env.vercel-pull run scripts/quarantine-votes.ts [modelId]        # dry run
 *   bun --env-file=.env.vercel-pull run scripts/quarantine-votes.ts [modelId] --apply
 */
import { del, list, put } from '@vercel/blob';

import { MODELS_BY_ID, PROVIDERS_BY_ID, VARIANTS_BY_ID } from '../src/server/catalog';

const EVENTS_PREFIX = 'humanness/events/';
const PENDING_PREFIX = 'humanness/pending/';
const QUARANTINE_PREFIX = 'humanness/quarantine/';
/** Chain votes into a session while they arrive within this gap. */
const SESSION_GAP_MS = 10 * 60 * 1000;
/** A streak this long is the flag; no model in the corpus has exceeded 14. */
const STREAK_FLOOR = 20;
/**
 * When sealed battles went live. Votes cast from here on are blind by
 * construction, so they stay in the standings even inside a flagged session —
 * whatever the model earns under the fix, it keeps.
 */
const SEALED_FROM = Date.parse('2026-07-31T05:03:00Z');

const args = process.argv.slice(2);
const TARGET = args.find((a) => !a.startsWith('--')) ?? 'fish-s21-pro';
const APPLY = args.includes('--apply');

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

const label = (id: string) => {
  const m = MODELS_BY_ID.get(id);
  return m ? `${PROVIDERS_BY_ID.get(m.providerId)!.name} ${m.name}` : id;
};
const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const modelOf = (variantId: string) => VARIANTS_BY_ID.get(variantId)?.modelId;

const listAll = async (prefix: string) => {
  const blobs: { url: string; pathname: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, token, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
};

const eventBlobs = await listAll(EVENTS_PREFIX);
console.log(`Reading ${eventBlobs.length} vote events…`);
// Gentle: a burst of thousands of reads trips Vercel's DDoS mitigation, which
// then 403s public reads — audio clips included.
const byBattle = new Map<string, { url: string; event: VoteEvent }>();
for (const entry of await mapLimit(eventBlobs, 25, async (blob) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(blob.url, { cache: 'force-cache' });
      if (res.ok) return { url: blob.url, event: (await res.json()) as VoteEvent };
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
  }
  return null;
})) {
  if (entry) byBattle.set(entry.event.battleId, entry);
}

const events = [...byBattle.values()]
  .map(({ event }) => event)
  .sort((a, b) => a.createdAt - b.createdAt);

/** The target's votes, in order, with the result from its own point of view. */
const targetVotes = events
  .map((e) => {
    const left = modelOf(e.leftVariantId);
    const right = modelOf(e.rightVariantId);
    if (left === right) return null;
    const side = left === TARGET ? 'left' : right === TARGET ? 'right' : null;
    if (!side) return null;
    return {
      event: e,
      opponent: (side === 'left' ? right : left)!,
      result: e.winner === 'tie' ? 'tie' : e.winner === side ? 'win' : 'loss',
    };
  })
  .filter((v): v is NonNullable<typeof v> => v !== null);

if (targetVotes.length === 0) {
  console.log(`No live votes for ${TARGET}.`);
  process.exit(0);
}

/** Chain the target's votes into listening sessions. */
type Session = { votes: typeof targetVotes };
const sessions: Session[] = [];
for (const v of targetVotes) {
  const last = sessions[sessions.length - 1];
  const lastAt = last?.votes[last.votes.length - 1].event.createdAt ?? 0;
  if (last && v.event.createdAt - lastAt <= SESSION_GAP_MS) last.votes.push(v);
  else sessions.push({ votes: [v] });
}

const longestStreak = (votes: typeof targetVotes) => {
  let best = 0;
  let run = 0;
  for (const v of votes) {
    if (v.result === 'tie') continue;
    run = v.result === 'win' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
};

const summarize = (votes: typeof targetVotes) => {
  const w = votes.filter((v) => v.result === 'win').length;
  const l = votes.filter((v) => v.result === 'loss').length;
  const t = votes.filter((v) => v.result === 'tie').length;
  return { w, l, t, rate: w + l === 0 ? 0 : w / (w + l), streak: longestStreak(votes) };
};

console.log(`\n${label(TARGET)} — ${targetVotes.length} live votes in ${sessions.length} sessions\n`);
console.log('start (UTC)            n     W     L     T   winrate   longest streak');
for (const s of sessions) {
  const { w, l, t, rate, streak } = summarize(s.votes);
  console.log(
    `${iso(s.votes[0].event.createdAt)} ${String(s.votes.length).padStart(5)} ${String(w).padStart(
      5,
    )} ${String(l).padStart(5)} ${String(t).padStart(5)}   ${(100 * rate).toFixed(1).padStart(6)}%   ${String(
      streak,
    ).padStart(14)}${streak >= STREAK_FLOOR ? '   <== FLAGGED' : ''}`,
  );
}

const flagged = sessions.filter((s) => longestStreak(s.votes) >= STREAK_FLOOR);
if (flagged.length === 0) {
  console.log(`\nNo session reaches a ${STREAK_FLOOR}-win streak. Nothing to quarantine.`);
  process.exit(0);
}

const doomed = flagged
  .flatMap((s) => s.votes)
  .filter((v) => v.event.createdAt < SEALED_FROM)
  .map((v) => v.event);
const spared = flagged.flatMap((s) => s.votes).length - doomed.length;
const kept = targetVotes.filter((v) => !doomed.includes(v.event));
const before = summarize(targetVotes);
const after = summarize(kept);
console.log(
  `\n${doomed.length} votes to quarantine from ${flagged.length} flagged session(s)` +
    (spared > 0 ? ` (${spared} kept: cast after battles were sealed)` : '') +
    `\n${label(TARGET)} record ${before.w}-${before.l}-${before.t} (${(100 * before.rate).toFixed(1)}%)` +
    ` → ${after.w}-${after.l}-${after.t} (${(100 * after.rate).toFixed(1)}%)`,
);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to quarantine, then rebuild the snapshot.\n');
  process.exit(0);
}

console.log('\nCopying to quarantine…');
for (const event of doomed) {
  await put(`${QUARANTINE_PREFIX}${event.battleId}.json`, JSON.stringify(event), {
    access: 'public',
    token,
    contentType: 'application/json',
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
  });
}

const doomedIds = new Set(doomed.map((event) => event.battleId));
// The event blob is the log of record, but recent votes also carry a marker
// holding the same payload. Leave the marker and the next fold replays the
// vote straight back into the counts.
const markers = (await listAll(PENDING_PREFIX)).filter((blob) =>
  doomedIds.has(blob.pathname.slice(blob.pathname.lastIndexOf('/') + 1).replace(/\.json$/, '')),
);
const liveUrls = doomed
  .map((event) => byBattle.get(event.battleId)?.url)
  .filter((url): url is string => url !== undefined);

console.log(`Removing ${liveUrls.length} event blobs and ${markers.length} pending markers…`);
for (let i = 0; i < liveUrls.length; i += 100) await del(liveUrls.slice(i, i + 100), { token });
if (markers.length > 0) await del(markers.map((blob) => blob.url), { token });

console.log(`\nQuarantined ${doomed.length} votes to ${QUARANTINE_PREFIX}.`);
console.log('Now rebuild the snapshot and refit: scripts/recompute-standings.ts\n');
