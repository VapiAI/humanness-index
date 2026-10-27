/**
 * Recording-based OpenAI clones for the pending GPT-Live eligibility probe.
 * No batch synthesize or comparable TTFB until the protocol is verified.
 * Official source, checked 2026-10-27:
 * https://developers.openai.com/api/docs/guides/custom-voices
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { requireEnv } from '../env';
import { SOURCE_VOICE_IDS, type SourceVoiceId } from '../voices';
import { postFormForJson, requestJson } from './http';
import { TransportError, type ProviderTransport } from './types';

const API = 'https://api.openai.com/v1/audio';
type Receipt = { consentId?: string; consentSha256?: string; voiceId?: string; sampleSha256?: string };
type State = { projectId: string; voices: Partial<Record<SourceVoiceId, Receipt>> };
const statePath = (): string => {
  const project = requireEnv('OPENAI_PROJECT_ID');
  if (!/^proj_[A-Za-z0-9_-]+$/.test(project)) throw new TransportError('Invalid OPENAI_PROJECT_ID');
  return resolve(import.meta.dir, '../results/openai', project, 'voices.json');
};
const state = (): State => {
  const path = statePath();
  const projectId = requireEnv('OPENAI_PROJECT_ID');
  const value: State = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8')) as State
    : { projectId, voices: {} };
  if (value.projectId !== projectId) throw new TransportError('OpenAI receipt project mismatch');
  return value;
};
const save = (value: State): void => {
  const path = statePath();
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};
const sourceVoice = (key: string): SourceVoiceId => {
  if (!SOURCE_VOICE_IDS.includes(key as SourceVoiceId)) throw new TransportError('Unknown source voice');
  return key as SourceVoiceId;
};
export const openaiHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${requireEnv('OPENAI_API_KEY')}`,
  'OpenAI-Project': requireEnv('OPENAI_PROJECT_ID'),
});

/** Preserve bytes; use supported base MIME types (no codecs parameter). */
const recording = (path: string): { blob: Blob; sha256: string } => {
  const mime: Record<string, string> = {
    '.mp3': 'audio/mpeg', '.mpeg': 'audio/mpeg', '.wav': 'audio/wav',
    '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac',
    '.webm': 'audio/webm', '.mp4': 'audio/mp4',
  };
  const type = mime[extname(path).toLowerCase()];
  if (!type) throw new TransportError('Unsupported OpenAI recording format');
  const bytes = readFileSync(path);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
    throw new TransportError('OpenAI recording must be nonempty and at most 10 MiB');
  }
  return { blob: new Blob([bytes], { type }), sha256: createHash('sha256').update(bytes).digest('hex') };
};

/** Read-only access probe. No clone/model entitlement is inferred from success. */
export const openaiConsentPhrases = (): Promise<unknown> =>
  requestJson('GET', `${API}/consent_phrases`, openaiHeaders(), undefined, 'OpenAI consent phrases');

export const openaiListConsents = (): Promise<unknown> =>
  requestJson('GET', `${API}/voice_consents`, openaiHeaders(), undefined, 'OpenAI consent list');

/** Caller supplies an actual actor recording; never generated or spliced consent. */
export const uploadOpenaiConsent = async (key: string, path: string): Promise<string> => {
  const voice = sourceVoice(key);
  const receipt = state();
  const old = receipt.voices[voice] ?? {};
  const audio = recording(path);
  if (old.consentId) {
    if (old.consentSha256 !== audio.sha256) throw new TransportError('Different consent already recorded; review existing receipt');
    return old.consentId;
  }
  const form = new FormData();
  form.set('name', `Humanness Index ${voice}`);
  form.set('language', 'en');
  form.set('recording', audio.blob, basename(path));
  const result = await postFormForJson<{ id: string }>(`${API}/voice_consents`, openaiHeaders(), form, 'OpenAI consent creation');
  if (!result.id?.startsWith('cons_')) throw new TransportError('OpenAI returned no consent ID; inspect before retrying');
  receipt.voices[voice] = { ...old, consentId: result.id, consentSha256: audio.sha256 };
  save(receipt);
  return result.id;
};

export const openai: ProviderTransport = {
  providerId: 'openai',
  apiKeyEnv: 'OPENAI_API_KEY',
  createClone: async ({ voiceKey, displayName, sampleFiles }) => {
    const voice = sourceVoice(voiceKey);
    const receipt = state();
    const old = receipt.voices[voice];
    if (!old?.consentId) throw new TransportError('Actual actor consent required first: see GPT-LIVE.md');
    if (sampleFiles.length !== 1) throw new TransportError('OpenAI requires one intended reference sample per voice');
    const audio = recording(sampleFiles[0]);
    if (old.voiceId) {
      if (old.sampleSha256 !== audio.sha256) throw new TransportError('Different sample already cloned; review existing receipt');
      return old.voiceId;
    }
    const form = new FormData();
    form.set('name', displayName);
    form.set('consent', old.consentId);
    form.set('audio_sample', audio.blob, basename(sampleFiles[0]));
    const result = await postFormForJson<{ id: string }>(`${API}/voices`, openaiHeaders(), form, 'OpenAI recording clone');
    if (!result.id?.startsWith('voice_')) throw new TransportError('OpenAI returned no voice ID; inspect before retrying');
    receipt.voices[voice] = { ...old, voiceId: result.id, sampleSha256: audio.sha256 };
    save(receipt);
    return result.id;
  },
  ttfbPlanFor: () => ({
    unmeasurable: 'GPT-Live scripted-speech eligibility and request-to-first-audio comparability are unverified; see GPT-LIVE.md. Do not publish startup or interaction latency as synthesis TTFB.',
  }),
};
