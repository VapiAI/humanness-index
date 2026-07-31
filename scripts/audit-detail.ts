/**
 * Per-vote drill-down for one model on one day, off the cached event dump
 * written by scripts/audit-votes.ts.
 *
 *   bun run scripts/audit-detail.ts [modelId] [YYYY-MM-DD]
 */
import { MODELS_BY_ID, PROVIDERS_BY_ID, VARIANTS_BY_ID } from '../src/server/catalog';

const CACHE = '/tmp/humanness-vote-events.json';
const TARGET = process.argv[2] ?? 'fish-s21-pro';
const DAY = process.argv[3] ?? '2026-07-31';

type VoteEvent = {
  battleId: string;
  winner: 'left' | 'right' | 'tie';
  leftVariantId: string;
  rightVariantId: string;
  createdAt: number;
};

const modelOf = (v: string) => VARIANTS_BY_ID.get(v)?.modelId;
const label = (id: string) => {
  const m = MODELS_BY_ID.get(id);
  return m ? `${PROVIDERS_BY_ID.get(m.providerId)!.name} ${m.name}` : id;
};
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);

const events = (JSON.parse(await Bun.file(CACHE).text()) as VoteEvent[])
  .filter((e) => new Date(e.createdAt).toISOString().slice(0, 10) === DAY)
  .sort((a, b) => a.createdAt - b.createdAt);

console.log(`\n${events.length} votes on ${DAY} (UTC)\n`);
console.log('  #  time      gap   side   result  voice      opponent');

let wins = 0;
let decided = 0;
let prev = 0;
let streak = 0;
let bestStreak = 0;
events.forEach((e, i) => {
  const left = modelOf(e.leftVariantId);
  const right = modelOf(e.rightVariantId);
  const involved = left === TARGET || right === TARGET;
  const gap = prev ? (e.createdAt - prev) / 1000 : 0;
  prev = e.createdAt;
  if (!involved) {
    console.log(
      `${String(i + 1).padStart(3)}  ${clock(e.createdAt)}  ${gap.toFixed(0).padStart(5)}s   —      —       —          ${label(left!)} vs ${label(right!)}`,
    );
    return;
  }
  const side = left === TARGET ? 'L' : 'R';
  const opp = left === TARGET ? right! : left!;
  const voice = VARIANTS_BY_ID.get(e.leftVariantId)!.sourceVoiceId.replace('voice-', '');
  const won = e.winner === (side === 'L' ? 'left' : 'right');
  const result = e.winner === 'tie' ? 'tie ' : won ? 'WIN ' : 'loss';
  if (e.winner !== 'tie') {
    decided += 1;
    if (won) {
      wins += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
    } else streak = 0;
  }
  console.log(
    `${String(i + 1).padStart(3)}  ${clock(e.createdAt)}  ${gap.toFixed(0).padStart(5)}s   ${side}      ${result}    ${voice.padEnd(9)}  ${label(opp)}   [${
      decided ? ((100 * wins) / decided).toFixed(0) : '--'
    }%]`,
  );
});

console.log(`\nlongest consecutive win streak: ${bestStreak}`);

// Opponent mix per hour: is the target being fed weak opponents?
const byHour = new Map<string, Map<string, number>>();
for (const e of events) {
  const left = modelOf(e.leftVariantId);
  const right = modelOf(e.rightVariantId);
  if (left !== TARGET && right !== TARGET) continue;
  const opp = left === TARGET ? right! : left!;
  const h = new Date(e.createdAt).toISOString().slice(11, 13);
  const m = byHour.get(h) ?? new Map<string, number>();
  m.set(opp, (m.get(opp) ?? 0) + 1);
  byHour.set(h, m);
}
console.log('\nopponent mix per hour (UTC):');
for (const [h, m] of byHour) {
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]);
  console.log(
    `  ${h}:00  ${top.length} distinct opponents · ${top
      .slice(0, 6)
      .map(([o, n]) => `${label(o)}×${n}`)
      .join(', ')}`,
  );
}
console.log('');
