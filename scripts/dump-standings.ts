/// <reference types="bun" />
/**
 * Dump the arena standings as deterministic JSON, computed by the real
 * src/server/store.ts load() against whatever BLOB_READ_WRITE_TOKEN is set
 * (in-memory seed when unset). Used to diff old store vs new store after the
 * vote-store migration.
 *
 *   BLOB_READ_WRITE_TOKEN=... bun run scripts/dump-standings.ts
 */
import { arenaStore } from '../src/server/store';

const { state, totalVotes } = await arenaStore().load();
const variants = Object.fromEntries(
  [...state.entries()].sort(([a], [b]) => a.localeCompare(b)),
);
console.log(JSON.stringify({ totalVotes, variants }, null, 2));
