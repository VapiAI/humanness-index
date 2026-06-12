/**
 * Transport contracts. One module per provider under transports/, each
 * porting the request shapes proven in the original prototype's provider
 * adapters and verified against the vendors' public API docs.
 */

export type SynthesisResult = {
  bytes: Uint8Array;
  format: 'mp3' | 'wav' | 'pcm';
  /** Required when format is 'pcm' (headerless) so ffmpeg can transcode. */
  sampleRate?: number;
};

export type SynthesizeArgs = {
  vendorModelId: string;
  providerVoiceId: string;
  text: string;
};

export type CloneArgs = {
  /** Source voice key, e.g. 'voice-clara'. */
  voiceKey: string;
  /** Display name for the provider console, e.g. 'Arena Clara'. */
  displayName: string;
  /** Local sample files (wav/mp3). */
  sampleFiles: string[];
};

export type TtfbTrialResult = { ttfbMs: number; connectMs: number };

export type TtfbPlan =
  | {
      transport: string;
      trial: () => Promise<TtfbTrialResult>;
      notes?: string;
    }
  | { unmeasurable: string };

export type ProviderTransport = {
  providerId: string;
  apiKeyEnv: string;
  synthesize?: (args: SynthesizeArgs) => Promise<SynthesisResult>;
  /** Registers a clone, returns the provider voice id. */
  createClone?: (args: CloneArgs) => Promise<string>;
  /** Steps to follow when clone creation is not API-automatable. */
  manualCloneRunbook?: string;
  ttfbPlanFor?: (vendorModelId: string) => TtfbPlan;
};

export class TransportError extends Error {}

export class RateLimitedError extends TransportError {}
