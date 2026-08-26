/// <reference types="bun" />
/**
 * Register the four licensed source voices (Clara, Emma, Godfrey, Nelliot)
 * as clones on a provider, persisting ids to pipeline/voices.local.json.
 *
 *   bun run humanness:clone <provider> <source-clips-dir>
 *   bun run humanness:clone <provider> --list
 *   bun run humanness:clone <provider> --record voice-clara=<id> [...]
 *
 * <source-clips-dir> layout: one WAV/MP3 per voice, either
 *   {dir}/clara.wav … or {dir}/{clara,emma,godfrey,nelliot}/*.wav
 * (multi-file providers like ElevenLabs IVC use every file in the folder).
 *
 * Provider notes:
 *  - hume: clone creation is Platform-UI only → prints the manual runbook;
 *    record the resulting ids with --record.
 *  - sesame: blocked on a decision (Vapi-S3-specific clone endpoint) — the
 *    transport throws with the note.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadPipelineEnv } from './env';
import { parseArgs } from './lib';
import { transportFor } from './transports';
import { inworldListVoices } from './transports/inworld';
import { minimaxListClonedVoices } from './transports/minimax';
import {
  clonedVoiceIds,
  LOCAL_VOICES_PATH,
  SOURCE_VOICE_IDS,
  type SourceVoiceId,
  type VoiceMap,
} from './voices';

const AUDIO_EXTENSIONS = /\.(wav|mp3|flac|m4a)$/i;

const persistVoices = (providerId: string, additions: VoiceMap): void => {
  const local: Record<string, VoiceMap> = existsSync(LOCAL_VOICES_PATH)
    ? (JSON.parse(readFileSync(LOCAL_VOICES_PATH, 'utf8')) as Record<string, VoiceMap>)
    : {};
  local[providerId] = { ...local[providerId], ...additions };
  writeFileSync(LOCAL_VOICES_PATH, `${JSON.stringify(local, null, 2)}\n`);
  console.log(`persisted ${Object.keys(additions).length} ids to ${LOCAL_VOICES_PATH}`);
};

/** Find each voice's sample files in the source dir. */
const sampleFilesFor = (dir: string, voiceId: SourceVoiceId): string[] => {
  const shortName = voiceId.replace(/^voice-/, '');
  const subdir = join(dir, shortName);
  if (existsSync(subdir) && statSync(subdir).isDirectory()) {
    return readdirSync(subdir)
      .filter((name) => AUDIO_EXTENSIONS.test(name))
      .map((name) => join(subdir, name));
  }
  return readdirSync(dir)
    .filter(
      (name) =>
        AUDIO_EXTENSIONS.test(name) &&
        name.toLowerCase().startsWith(shortName.toLowerCase()),
    )
    .map((name) => join(dir, name));
};

const listProviderVoices = async (providerId: string): Promise<void> => {
  if (providerId === 'minimax') {
    const voices = await minimaxListClonedVoices();
    console.log(`minimax cloned voices (${voices.length}):`);
    for (const voice of voices) console.log(`  ${voice.voice_id}`);
    return;
  }
  if (providerId === 'inworld') {
    const voices = await inworldListVoices();
    console.log(`inworld voices visible to this key (${voices.length}):`);
    for (const voice of voices) {
      console.log(`  ${voice.voiceId ?? voice.name} ${voice.displayName ? `(${voice.displayName})` : ''}`);
    }
    return;
  }
  console.log(
    `no list helper for ${providerId}; current known ids:\n` +
      JSON.stringify(clonedVoiceIds()[providerId] ?? {}, null, 2),
  );
};

const main = async (): Promise<void> => {
  loadPipelineEnv();
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const providerId = positionals[0];
  if (!providerId) {
    console.error(
      'usage: bun run humanness:clone <provider> <source-clips-dir> | --list | --record voice-x=<id>',
    );
    process.exit(2);
  }

  if (flags.has('list')) {
    await listProviderVoices(providerId);
    return;
  }

  if (flags.has('record')) {
    // --record voice-clara=<id> [voice-emma=<id> ...] — for UI-created clones.
    // parseArgs puts the first pair in the flag value and the rest in positionals.
    const recordFlag = flags.get('record');
    const pairs = positionals
      .slice(1)
      .concat(typeof recordFlag === 'string' ? [recordFlag] : []);
    if (pairs.length === 0) {
      console.error('--record needs at least one voice-x=<id> pair');
      process.exit(2);
    }
    const additions: VoiceMap = {};
    for (const pair of pairs) {
      const [voiceId, providerVoiceId] = pair.split('=', 2);
      if (!SOURCE_VOICE_IDS.includes(voiceId as SourceVoiceId) || !providerVoiceId) {
        console.error(`bad --record pair: ${pair} (want voice-clara=<id>)`);
        process.exit(2);
      }
      additions[voiceId as SourceVoiceId] = providerVoiceId;
    }
    persistVoices(providerId, additions);
    return;
  }

  const transport = transportFor(providerId);
  if (!transport) {
    console.error(`unknown provider ${providerId}`);
    process.exit(1);
  }
  if (transport.manualCloneRunbook) {
    console.log(transport.manualCloneRunbook);
    console.log('\nThen persist the ids with:');
    console.log(
      `  bun run humanness:clone ${providerId} --record voice-clara=<id> voice-emma=<id> voice-godfrey=<id> voice-nelliot=<id>`,
    );
    return;
  }
  if (!transport.createClone) {
    console.error(`provider ${providerId} has no clone transport`);
    process.exit(1);
  }

  const dir = positionals[1];
  if (!dir || !existsSync(dir)) {
    console.error(`source clips dir not found: ${dir ?? '(missing)'}`);
    process.exit(2);
  }

  const additions: VoiceMap = {};
  const existing = clonedVoiceIds()[providerId] ?? {};
  for (const voiceId of SOURCE_VOICE_IDS) {
    if (existing[voiceId] && !flags.has('force')) {
      console.log(`= ${voiceId}: already registered (${existing[voiceId]})`);
      continue;
    }
    const samples = sampleFilesFor(resolve(dir), voiceId);
    if (samples.length === 0) {
      console.error(`✗ ${voiceId}: no sample files found in ${dir}`);
      continue;
    }
    const displayName = `Arena ${voiceId.replace(/^voice-/, '').replace(/^./, (c) => c.toUpperCase())}`;
    try {
      const providerVoiceId = await transport.createClone({
        voiceKey: voiceId,
        displayName,
        sampleFiles: samples,
      });
      additions[voiceId] = providerVoiceId;
      console.log(`✓ ${voiceId} → ${providerVoiceId} (${samples.length} samples)`);
    } catch (error) {
      console.error(
        `✗ ${voiceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (Object.keys(additions).length > 0) {
    persistVoices(providerId, additions);
  }
  const stillMissing = SOURCE_VOICE_IDS.filter(
    (voiceId) => !{ ...existing, ...additions }[voiceId],
  );
  if (stillMissing.length > 0) {
    console.error(`still missing for ${providerId}: ${stillMissing.join(', ')}`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
