/**
 * Generates the default (empty) private registry overlay when none exists.
 * Runs on `bun install` (postinstall) so fresh clones typecheck, test, and
 * build out of the box. See src/catalog/overlay.local.ts (gitignored) and
 * SPEC.md section 4.3: embargoed registry entries are injected at deploy
 * time through this file; with the empty default the mechanism is dormant.
 *
 * Never overwrites an existing overlay.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OVERLAY_PATH = resolve(import.meta.dir, '../src/catalog/overlay.local.ts');

const DEFAULT_OVERLAY = `/**
 * Private registry overlay (gitignored; regenerated empty by
 * scripts/ensure-overlay.ts on install). Unannounced or embargoed entries
 * can be added here by the deploy environment; they must be status
 * 'unlisted' (enforced by the RegistryOverlay type), so every public
 * surface derives identically whether or not an overlay is present.
 */
import type { RegistryOverlay } from './types';

export const OVERLAY: RegistryOverlay = {
  providers: [],
  models: [],
};
`;

if (existsSync(OVERLAY_PATH)) {
  process.exit(0);
}
writeFileSync(OVERLAY_PATH, DEFAULT_OVERLAY);
console.log('[ensure-overlay] wrote empty src/catalog/overlay.local.ts');
