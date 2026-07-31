/**
 * Test preload: the suite is hermetic by design (in-memory store, memory
 * rate limiter, no network). Ambient credentials from the developer's shell
 * (a sourced deploy env, a Vercel pull) would silently connect the store
 * singleton to real infrastructure and turn fast deterministic tests into
 * slow network-bound ones, so they are cleared before any module loads.
 */
const AMBIENT_CREDENTIALS = [
  'BLOB_READ_WRITE_TOKEN',
  'TURNSTILE_SECRET_KEY',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'HUMANNESS_AUDIO_ORIGIN',
];

for (const name of AMBIENT_CREDENTIALS) {
  delete process.env[name];
}
