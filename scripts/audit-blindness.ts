/**
 * Is a "blind" battle actually blind? Checks the three ways the matchup used to
 * leak before a vote, and fails loudly if any still does:
 *
 *  1. Clip URLs were a content hash of `{variantId}|{promptId}|settings-v3`,
 *     and every variant/prompt id ships in the public repo — an 88 x 20 hash
 *     space anyone can precompute and look the answer up in.
 *  2. The vote token was base64url'd JSON, so one atob() named both models.
 *  3. The MP3 frame header carried each provider's own sample rate and bitrate,
 *     which named some models outright (Grok TTS Streaming was the only entrant
 *     at 160 kbps / 24 kHz) and cut others to a two- or three-way guess. Check 3
 *     sweeps the catalog rather than the battle, because a single battle cannot
 *     show that a NEW model shipped in a format nobody else uses.
 *
 *   bun run scripts/audit-blindness.ts [origin]
 */
import { createHash } from 'node:crypto';

import { ARENA_CLIP_FORMAT } from '../src/pipeline/lib';
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

/* 3. Encoding fingerprint — one clip per model, straight off the audio origin. */

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/** bitrate/sampleRate/channels read off the first MP3 frame header. */
const encodingOf = (bytes: Buffer): string => {
  let i = 0;
  if (bytes.subarray(0, 3).toString() === 'ID3') {
    i =
      10 +
      (((bytes[6]! & 0x7f) << 21) |
        ((bytes[7]! & 0x7f) << 14) |
        ((bytes[8]! & 0x7f) << 7) |
        (bytes[9]! & 0x7f));
  }
  while (i < bytes.length - 4 && !(bytes[i] === 0xff && (bytes[i + 1]! & 0xe0) === 0xe0)) i += 1;
  const version = (bytes[i + 1]! >> 3) & 3;
  const bitrateIdx = (bytes[i + 2]! >> 4) & 15;
  const rateIdx = (bytes[i + 2]! >> 2) & 3;
  const channelMode = (bytes[i + 3]! >> 6) & 3;
  const kbps = version === 3 ? BITRATES_V1[bitrateIdx] : BITRATES_V2[bitrateIdx];
  return `${kbps}kbps/${(RATES[version] ?? [0, 0, 0])[rateIdx]}Hz/${channelMode === 3 ? 1 : 2}ch`;
};

const expectedEncoding = `${ARENA_CLIP_FORMAT.bitrateKbps}kbps/${ARENA_CLIP_FORMAT.sampleRate}Hz/${ARENA_CLIP_FORMAT.channels}ch`;
const probePrompt = PROMPTS[0]!.id;
const oneVariantPerModel = new Map<string, (typeof VARIANTS)[number]>();
for (const variant of VARIANTS) {
  if (!oneVariantPerModel.has(variant.modelId)) oneVariantPerModel.set(variant.modelId, variant);
}

const encodings = new Map<string, string[]>();
await Promise.all(
  [...oneVariantPerModel.values()].map(async (variant) => {
    const digest = createHash('sha256')
      .update(`${variant.id}|${probePrompt}|settings-v3`)
      .digest('hex')
      .slice(0, 32);
    const clip = await fetch(`${origin}/audio/${digest}.mp3`, {
      headers: { 'user-agent': 'Mozilla/5.0 humanness-audit' },
    });
    if (!clip.ok) return;
    const encoding = encodingOf(Buffer.from(await clip.arrayBuffer()));
    encodings.set(encoding, [...(encodings.get(encoding) ?? []), label(variant.modelId) ?? variant.modelId]);
  }),
);

// A model alone in its encoding bucket is identifiable from four bytes; a small
// bucket narrows the guess. Only one bucket for the whole field is blind.
const offFormat = [...encodings.keys()].filter((e) => e !== expectedEncoding);
console.log(`\n3. MP3 frame header -> model identity (${encodings.size} encoding(s) across ${[...encodings.values()].flat().length} models)`);
if (offFormat.length === 0) {
  console.log(`   blind: every model encodes to ${expectedEncoding}`);
} else {
  for (const encoding of offFormat) {
    const names = encodings.get(encoding)!;
    console.log(
      `   LEAKING: ${encoding} is ${names.length === 1 ? 'unique to' : `shared by only`} ${names.join(', ')}`,
    );
  }
}

const leaking =
  fromUrls.some((hit) => hit !== null) || namedInToken.length > 0 || offFormat.length > 0;
console.log(`\nVerdict: ${leaking ? 'BATTLE IS UNMASKABLE' : 'battle is blind'}\n`);
process.exit(leaking ? 1 : 0);
