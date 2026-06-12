/// <reference types="bun" />
/**
 * Loads pipeline/.env (gitignored) into process.env without overriding
 * already-exported variables. Every pipeline CLI calls this first, so the
 * scripts work from the repo root regardless of cwd. Values are secrets:
 * never log them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(import.meta.dir, '.env');

export const loadPipelineEnv = (): void => {
  if (!existsSync(ENV_PATH)) {
    console.error(
      'pipeline/.env not found — copy pipeline/.env.example and fill in keys.',
    );
    return;
  }
  for (const rawLine of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      value[0] === value[value.length - 1] &&
      (value[0] === '"' || value[0] === "'")
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined && value !== '') {
      process.env[key] = value;
    }
  }
};

/** Required env lookup with a clear, value-free error. */
export const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var ${name} (see pipeline/.env.example)`);
  }
  return value;
};
