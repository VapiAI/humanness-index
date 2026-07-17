/**
 * Provider transport registry. Providers without an entry here (canopylabs,
 * gradium) have no usable synthesis/bench surface from this
 * pipeline — see UNMEASURABLE_PROVIDERS for the sourced reasons. xai has a
 * bench-only transport (realtime WS; its HTTP config stays team-gated —
 * transports/xai.ts). LMNT was cut from the expansion 2026-06-11 and its
 * never-run transport deleted (see RUNBOOK).
 */
import { cartesia } from './cartesia';
import { elevenlabs } from './elevenlabs';
import { hume } from './hume';
import { inworld } from './inworld';
import { minimax } from './minimax';
import { neuphonic } from './neuphonic';
import { sesame } from './sesame';
import { smallest } from './smallest';
import { speechify } from './speechify';
import { xai } from './xai';
import type { ProviderTransport } from './types';

export const TRANSPORTS: Record<string, ProviderTransport> = {
  elevenlabs,
  minimax,
  inworld,
  cartesia,
  // Keyed `smallestai` — the frozen providerId used in variant hashes and
  // the catalog provider id (clone CLI: `humanness:clone smallestai`).
  smallestai: smallest,
  neuphonic,
  hume,
  sesame,
  speechify,
  xai,
};

/** Why the remaining arena providers cannot be measured/generated live. */
export const UNMEASURABLE_PROVIDERS: Record<string, string> = {
  canopylabs:
    "no public synthesis API — arena clips came from Canopy's internal Orpheus dashboard",
  gradium: 'no Gradium API key locally (arena clips were imported from a vendor zip)',
};

export const transportFor = (providerId: string): ProviderTransport | undefined =>
  TRANSPORTS[providerId];

export { BENCH_TEXT } from './http';
export * from './types';
