/**
 * Is a "blind" battle actually blind? Checks the two ways the matchup used to
 * leak before a vote, and fails loudly if either still does:
 *
 *  1. Clip URLs were a content hash of `{variantId}|{promptId}|settings-v3`,
 *     and every variant/prompt id ships in the public repo — an 88 x 20 hash
 *     space anyone can precompute and look the answer up in.
 *  2. The vote token was base64url'd JSON, so one atob() named both models.
 *
 *   bun run scripts/audit-blindness.ts [origin]
 */
import { createHash } from 'node:crypto';

import { MODELS_BY_ID, PROMPTS, PROVIDERS_BY_ID, VARIANTS } from '../src/server/catalog';

const origin = process.argv[2] ?? 'https://humannessindex.vapi.ai';

const table = new Map<string, { variantId: string; promptId: string; modelId: string }>();
for (const variant of VARIANTS) {
  for (const prompt of PROMPTS) {
    const digest = createHash('sha256')
      .update(`${variant.id}|${prompt.id}|settings-v3`)
      .digest('hex')
      .slice(0, 32);
    table.set(digest, { variantId: variant.id, promptId: prompt.id, modelId: variant.modelId });
  }
}
console.log(`Precomputed ${table.size} clip hashes from public catalog data.`);

const label = (id: string) => {
  const m = MODELS_BY_ID.get(id);
  if (!m) return null;
  return `${PROVIDERS_BY_ID.get(m.providerId)!.name} ${m.name}`;
};
const resolve = (url: string) => {
  const hash = url.split('/').pop()!.replace('.mp3', '');
  const hit = table.get(hash);
  return hit ? label(hit.modelId) : null;
};

const res = await fetch(`${origin}/api/battle`, {
  headers: { 'user-agent': 'Mozilla/5.0 humanness-audit' },
});
const battle = (await res.json()) as {
  id: string;
  voteToken: string;
  leftAudioUrl: string;
  rightAudioUrl: string;
};

console.log(`\nLive battle served by ${origin}:`);
console.log(`  id    ${battle.id}`);
console.log(`  left  ${battle.leftAudioUrl}`);
console.log(`  right ${battle.rightAudioUrl}`);

const fromUrls = [resolve(battle.leftAudioUrl), resolve(battle.rightAudioUrl)];
const tokenPlaintext = Buffer.from(battle.voteToken, 'base64url').toString('utf-8');
const namedInToken = VARIANTS.filter((v) => tokenPlaintext.includes(v.id));

console.log('\n1. Clip URL -> precomputed hash table');
console.log(
  fromUrls.some((hit) => hit !== null)
    ? `   LEAKING: left=${fromUrls[0] ?? '?'} right=${fromUrls[1] ?? '?'}`
    : '   blind: neither URL resolves to a catalog clip',
);
console.log('\n2. Vote token -> plaintext read');
console.log(
  namedInToken.length > 0
    ? `   LEAKING: names ${namedInToken.map((v) => v.id).join(', ')}`
    : '   blind: the token decodes to ciphertext, no variant ids inside',
);

const leaking = fromUrls.some((hit) => hit !== null) || namedInToken.length > 0;
console.log(`\nVerdict: ${leaking ? 'BATTLE IS UNMASKABLE' : 'battle is blind'}\n`);
process.exit(leaking ? 1 : 0);
