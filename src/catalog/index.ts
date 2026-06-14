/**
 * Registry public API — the only module consumers should import from
 * `catalog/`. Everything downstream (server arena catalog, first-paint seed
 * rows, stats helpers, detail pages, sitemap) derives through these lookups,
 * which is what keeps 'unlisted' entries off every surface.
 *
 * The exported collections merge the committed registry with the private
 * overlay (./overlay.local, gitignored; empty by default — see SPEC 4.3).
 * Overlay entries are type-constrained to 'unlisted', so the merge cannot
 * change any listed or arena surface.
 *
 * Importable from client and server code: pure data + pure functions, no
 * node builtins.
 */
import { MODEL_ENTRIES as BASE_MODEL_ENTRIES } from './models';
import { OVERLAY } from './overlay.local';
import { PROVIDER_ENTRIES as BASE_PROVIDER_ENTRIES } from './providers';
import type { ModelEntry, ProviderEntry } from './types';

export * from './types';
export * from './audio';
export * from './voices';

/** Committed registry + private overlay (unlisted-only), overlay last. */
export const MODEL_ENTRIES: ModelEntry[] = [
  ...BASE_MODEL_ENTRIES,
  ...OVERLAY.models,
];
export const PROVIDER_ENTRIES: ProviderEntry[] = [
  ...BASE_PROVIDER_ENTRIES,
  ...OVERLAY.providers,
];

const PROVIDER_ENTRIES_BY_ID = new Map(
  PROVIDER_ENTRIES.map((provider) => [provider.id, provider]),
);
const MODEL_ENTRIES_BY_ID = new Map(
  MODEL_ENTRIES.map((model) => [model.id, model]),
);

export const providerEntryById = (id: string): ProviderEntry | undefined =>
  PROVIDER_ENTRIES_BY_ID.get(id);

export const modelEntryById = (id: string): ModelEntry | undefined =>
  MODEL_ENTRIES_BY_ID.get(id);

/** Resolved provider of a model; entry integrity is enforced by catalog.test. */
export const providerOfModel = (model: ModelEntry): ProviderEntry =>
  PROVIDER_ENTRIES_BY_ID.get(model.providerId)!;

/* ----------------------------- Arena surfaces -----------------------------
 * 'active' only: retired models leave battle sampling and the index table,
 * unlisted models leave everything.
 * -------------------------------------------------------------------------- */

export const arenaModelEntries = (): ModelEntry[] =>
  MODEL_ENTRIES.filter((model) => model.status === 'active');

/** Active models of one provider, in frozen registry order. */
export const arenaModelEntriesOfProvider = (providerId: string): ModelEntry[] =>
  MODEL_ENTRIES.filter(
    (model) => model.providerId === providerId && model.status === 'active',
  );

/** Providers with at least one active model, in frozen registry order. */
export const arenaProviderEntries = (): ProviderEntry[] =>
  PROVIDER_ENTRIES.filter(
    (provider) => arenaModelEntriesOfProvider(provider.id).length > 0,
  );

/* ------------------------- Display-name lookups ---------------------------
 * The stats/scoring helpers key off the (provider, model) display names that
 * arena API rows carry. Built over active entries only, so unlisted models
 * resolve to nothing (and render as dashes) exactly like unknown ones.
 * -------------------------------------------------------------------------- */

const displayKey = (provider: string, model: string) =>
  `${provider}\u0000${model}`;

const MODEL_ENTRIES_BY_DISPLAY = new Map(
  arenaModelEntries().map((model) => [
    displayKey(providerOfModel(model).name, model.name),
    model,
  ]),
);

const ARENA_PROVIDERS_BY_NAME = new Map(
  arenaProviderEntries().map((provider) => [provider.name, provider]),
);

export const modelEntryByDisplayName = (
  provider: string,
  model: string,
): ModelEntry | undefined =>
  MODEL_ENTRIES_BY_DISPLAY.get(displayKey(provider, model));

export const arenaProviderEntryByName = (
  name: string,
): ProviderEntry | undefined => ARENA_PROVIDERS_BY_NAME.get(name);

/* ------------------------------ Page surfaces -----------------------------
 * Detail pages and the sitemap (Phase 2) include retired entries (never 404
 * an earned URL) but still exclude unlisted ones.
 * -------------------------------------------------------------------------- */

export const listedModelEntries = (): ModelEntry[] =>
  MODEL_ENTRIES.filter((model) => model.status !== 'unlisted');

export const listedProviderEntries = (): ProviderEntry[] =>
  PROVIDER_ENTRIES.filter((provider) =>
    MODEL_ENTRIES.some(
      (model) =>
        model.providerId === provider.id && model.status !== 'unlisted',
    ),
  );
