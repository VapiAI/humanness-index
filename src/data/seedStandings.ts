/**
 * Client-safe re-export of the production standings export. The JSON lives
 * next to the server store (which folds live votes over it); importing it
 * through this module keeps client bundles from reaching into ../server
 * TypeScript (node:crypto, @vercel/blob).
 */
import seedStandings from '../server/seed-standings.json';

export const SEED_STANDINGS = seedStandings;
