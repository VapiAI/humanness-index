/** Maintainer-only access/consent and bounded rendering probes; no uploads. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPipelineEnv } from './env';
import { PROMPTS } from './prompts';
import { clonedVoiceIds, SOURCE_VOICE_IDS, type SourceVoiceId } from './voices';
import { openaiConsentPhrases, openaiListConsents, uploadOpenaiConsent } from './transports/openai';
import { runOpenaiLiveProbe } from './transports/openaiLiveProbe';

const main = async (): Promise<void> => {
  loadPipelineEnv();
  const [command, voice, argument] = process.argv.slice(2);
  if (command === 'inspect') {
    // Sequential: stop after the first persistent access failure.
    const phrases = await openaiConsentPhrases();
    console.log('Current consent phrases:', JSON.stringify(phrases, null, 2));
    console.log('Existing consent objects:', JSON.stringify(await openaiListConsents(), null, 2));
    console.log('Read access is verified; recording-voice write and Live access still require their own probes.');
    return;
  }
  if (!SOURCE_VOICE_IDS.includes(voice as SourceVoiceId)) throw new Error('Specify voice-clara, voice-emma, voice-godfrey or voice-nelliot');
  if (command === 'upload-consent' && argument) {
    await openaiConsentPhrases(); // Verify current phrases before each new actor upload.
    console.log('Consent receipt saved:', await uploadOpenaiConsent(voice, argument));
    return;
  }
  if (command !== 'render') throw new Error('usage: bun run humanness:openai inspect | upload-consent <voice-id> <actor-recording> | render <voice-id> <clip-id>');
  const prompt = PROMPTS.find((item) => item.id === argument);
  if (!prompt) throw new Error('Specify a frozen clip-01 through clip-20 prompt');
  const voiceId = clonedVoiceIds().openai?.[voice as SourceVoiceId];
  if (!voiceId) throw new Error('No recording-based OpenAI clone registered for this source voice');
  // Unique directory for EVERY attempt, including failures. No auto-retries or curation.
  const dir = resolve(import.meta.dir, 'results/openai/probes', `${new Date().toISOString().replace(/[:.]/g, '-')}-${voice}-${prompt.id}`);
  mkdirSync(dir, { recursive: true });
  const result = await runOpenaiLiveProbe({ voiceId, text: prompt.text });
  const { audio, ...report } = result;
  writeFileSync(resolve(dir, 'output.pcm'), audio);
  writeFileSync(resolve(dir, 'report.json'), `${JSON.stringify({ ...report, promptId: prompt.id, voice, audioBytes: audio.length, audioDurationSeconds: audio.length / 48000, eligibility: 'pending independent ASR and listening; endpoint is heuristic', protocol: 'instructions.append, paced PCM silence, 3s audio/transcript quiet, 60s deadline; no retries or edits' }, null, 2)}\n`);
  console.log(`Probe retained at ${dir}; transcript matches=${result.transcriptMatches}, issues=${result.issues.length}. Independent audio review still required.`);
  if (result.issues.length) process.exitCode = 1;
};

if (import.meta.main) main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'OpenAI probe failed');
  process.exitCode = 1;
});
