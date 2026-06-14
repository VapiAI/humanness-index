/**
 * Sesame CSM-1B transport — STUB, pending a decision.
 *
 * Synthesis: a privately hosted CSM-1B deployment
 * (SESAME_URL/generate_audio_stream_progressive, ported from the original
 * prototype's Sesame adapter) works for stock speakers. SESAME_URL is
 * required: there is no public default host.
 *
 * Cloning: DECISION NEEDED. The deployment's clone path expects source
 * samples staged in its own private object storage, which this pipeline
 * cannot reach. Replicating it means either (a) getting upload access to
 * that storage, (b) standing up our own CSM-1B host with audio-prompt
 * cloning, or (c) dropping Sesame from the expansion. Until that call is
 * made, createClone throws with this note (see RUNBOOK).
 */
import { requireEnv } from '../env';
import { throwForStatus } from './http';
import { TransportError, type ProviderTransport, type TtfbPlan } from './types';

const baseUrl = (): string => requireEnv('SESAME_URL').replace(/\/$/, '');

export const sesame: ProviderTransport = {
  providerId: 'sesame',
  apiKeyEnv: 'SESAME_API_KEY',

  synthesize: async ({ providerVoiceId, text }) => {
    // Deliberately no request timeout: a cold serverless GPU worker can
    // take minutes to spin up, which is why this stays off postJsonForBytes.
    const response = await fetch(`${baseUrl()}/generate_audio_stream_progressive`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${requireEnv('SESAME_API_KEY')}`,
        'content-type': 'application/json',
        accept: 'audio/wav',
      },
      body: JSON.stringify({
        text,
        speaker: providerVoiceId,
        output_sample_rate: 24000,
        enable_profiler: false,
      }),
    });
    await throwForStatus(response, 'sesame generate_audio_stream_progressive');
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      format: 'wav' as const,
    };
  },

  createClone: async () => {
    throw new TransportError(
      'Sesame cloning is blocked on a decision: the hosted clone endpoint expects samples ' +
        'staged in its own private storage. Options: get upload access, self-host CSM-1B ' +
        'cloning, or drop Sesame. See pipeline/RUNBOOK.md.',
    );
  },

  ttfbPlanFor: (): TtfbPlan => ({
    unmeasurable:
      'privately hosted CSM-1B has no stable public latency surface; bench once a cloning decision lands',
  }),
};
