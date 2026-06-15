/// <reference types="bun" />
/**
 * normalizeHostedAudio.ts — loudness-normalize EVERY hosted arena clip to ONE
 * uniform target, in place on the Vercel Blob store.
 *
 * WHY: battles play per-(model x voice x prompt) clips off the Blob origin. The
 * Human baseline was normalized to ~-24.7 LUFS, but the TTS-generated clips vary
 * widely, so an A/B battle can be "spiky" (one voice much louder than the other).
 * This tool re-levels the WHOLE set (TTS + Human) to a single integrated
 * loudness with true-peak limiting, replacing each clip IN PLACE at its existing
 * audio/{hash}.mp3 path — the content hash / URL never changes, only the bytes.
 *
 * It is the batch sibling of ingestHumanClips.ts and uses the SAME normalization
 * chain that produced the -24.7 LUFS human clips:
 *   pass 1: measure integrated loudness (EBU R128) + true peak (ffmpeg loudnorm),
 *   pass 2: apply ONE linear gain to the target, then a true-peak limiter
 *           (alimiter) so nothing clips. A pure linear gain shifts integrated
 *           loudness by EXACTLY the applied dB, so every clip lands on target —
 *           the tightest possible band, which is what kills the spikiness.
 *
 * ROBUSTNESS (this is a ~1700+ clip batch):
 *  - Enumeration is authoritative: it lists the Blob store directly (every
 *    audio/*.mp3), so nothing is missed even if it is not in the registry.
 *  - Work is sharded across FRESH bun worker processes (default 40 clips each,
 *    6 in parallel). This sidesteps the documented Bun 1.0.3 long-lived-process
 *    fetch wedge (RUNBOOK) and makes a wedged/slow shard recoverable: the
 *    orchestrator times each worker out, kills it, and retries the shard.
 *  - Downloads use curl (separate process, retry + timeout); uploads use the
 *    Blob SDK put() with allowOverwrite + retry + timeout. ffmpeg/ffprobe have
 *    hard timeouts.
 *  - Idempotent + resumable: each clip's outcome is checkpointed; a re-run skips
 *    clips already on target (within tolerance) and re-encodes nothing it does
 *    not have to (so the already-correct human clips are left untouched).
 *  - It NEVER re-hashes or renames: every PUT targets the exact existing
 *    pathname, so live URLs stay stable.
 *
 * USAGE (token from pipeline/.env BLOB_READ_WRITE_TOKEN):
 *   bun run src/pipeline/normalizeHostedAudio.ts --dry-run      # enumerate + measure spread, no writes
 *   bun run src/pipeline/normalizeHostedAudio.ts                # full in-place normalize + verify
 *   bun run src/pipeline/normalizeHostedAudio.ts --limit 40     # smoke test on the first 40 clips
 *   bun run src/pipeline/normalizeHostedAudio.ts --verify-only  # just re-measure a live sample
 *   bun run src/pipeline/normalizeHostedAudio.ts --force        # ignore checkpoints, re-process all
 * Flags: --target <LUFS> --comp <dB> --tol <LU> --tp-ceiling <dBTP>
 *        --shard-size <n> --workers <n> --sample <n>
 *
 * Outputs (gitignored, under results/loudness/): manifest.json (enumeration),
 * ckpt/*.jsonl (per-shard checkpoints), report.json (final report). Clip
 * binaries only ever touch the OS temp dir and are deleted after each clip.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { list, put } from '@vercel/blob';

import { loadPipelineEnv, requireEnv } from './env';
import {
  clipHash,
  looksLikeMp3,
  median,
  parseArgs,
  sleep,
  stdev,
  variantIdFor,
} from './lib';
import { pipelineModels } from './models';
import { PROMPTS } from './prompts';
import { SOURCE_VOICE_IDS } from './voices';

/* -------------------------------- constants ------------------------------- */

/**
 * The uniform target. -24.7 LUFS matches the established Human baseline (the
 * arena's loudness anchor), sits in the middle of the measured TTS spread, and
 * means the already-normalized human clips need no change. True peak is held
 * well under the -1 dBTP requirement by the same -2 dBFS sample limiter the
 * human clips use (verified true peaks <= ~-2 dBTP). These defaults can be
 * overridden on the CLI, but the run records whatever it used.
 */
const TARGET_LUFS = -24.7;
const TP_CEILING_DBTP = -1.0;
/** Sample-peak limiter ceiling (~-2.0 dBFS); matches ingestHumanClips.ts. */
const TP_LIMIT_LINEAR = 0.794;
/** Skip (idempotent) when within this many LU of target AND under the TP ceiling. */
const IDEMPOTENT_TOL_LU = 0.75;
/** Sanity guard against amplifying a near-silent/defective clip into noise. */
const GAIN_CAP_DB = 25;
/** An MP3 smaller than this is an error payload, not a clip. */
const MIN_CLIP_BYTES = 2_000;

const DOWNLOAD_TIMEOUT_S = 60;
const FFMPEG_TIMEOUT_MS = 120_000;
const FFPROBE_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const STEP_RETRIES = 3;

const DEFAULT_SHARD_SIZE = 40;
const DEFAULT_WORKERS = 6;
const WORKER_TIMEOUT_MS = 6 * 60 * 1000;
const SHARD_RETRIES = 3;

const DEFAULT_SAMPLE = 90;
const CALIBRATE_SUBSET = 12;
const VERIFY_SAMPLE = 36;

const BLOB_PREFIX = 'audio/';
const RESULTS_DIR = resolve(import.meta.dir, 'results', 'loudness');
const MANIFEST_PATH = resolve(RESULTS_DIR, 'manifest.json');
const CKPT_DIR = resolve(RESULTS_DIR, 'ckpt');
const REPORT_PATH = resolve(RESULTS_DIR, 'report.json');
const WORKER_LOG = resolve(RESULTS_DIR, 'worker.log');
const SCRIPT_PATH = import.meta.path;

/* ---------------------------------- types --------------------------------- */

type Label = {
  modelId: string;
  providerId: string;
  voiceId: string;
  promptId: string;
} | null;

type ManifestEntry = {
  pathname: string;
  url: string;
  hash: string;
  size: number;
  label: Label;
};

type Loudness = { i: number; tp: number; lra: number; thresh: number };

type Outcome = 'normalized' | 'already-on-target' | 'failed';

type CkptLine = {
  hash: string;
  pathname: string;
  label: Label;
  beforeI: number | null;
  beforeTp: number | null;
  gainDb: number | null;
  outcome: Outcome;
  note?: string;
};

type MeasureTask = { pathname: string; url: string; hash: string; label: Label };

type MeasureResult = MeasureTask & {
  ok: boolean;
  i?: number;
  tp?: number;
  lra?: number;
  /** Calibration only: residual (outputI - target) after a trial normalize. */
  residual?: number | null;
  error?: string;
};

type NormalizeOpts = {
  target: number;
  comp: number;
  tol: number;
  tpCeiling: number;
};

/* --------------------------------- helpers -------------------------------- */

const fmt = (n: number | null | undefined, d = 1): string =>
  n == null || !Number.isFinite(n) ? 'n/a' : n.toFixed(d);

const hashFromPathname = (pathname: string): string =>
  pathname.replace(/^audio\//, '').replace(/\.mp3$/, '');

const mkTmpDir = (): string => {
  const dir = resolve(
    tmpdir(),
    `hi-norm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const flagStr = (
  flags: Map<string, string | true>,
  key: string,
  fallback: string,
): string => (flags.has(key) ? String(flags.get(key)) : fallback);

const flagNum = (
  flags: Map<string, string | true>,
  key: string,
  fallback: number,
): number => (flags.has(key) ? Number(flags.get(key)) : fallback);

/* ----------------------------- ffmpeg / curl ------------------------------ */

/** Pass-1 loudness measurement: integrated LUFS + true peak (EBU R128). */
const measureLoudness = (file: string): Loudness | null => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-af',
      `loudnorm=I=${TARGET_LUFS}:TP=${TP_CEILING_DBTP}:LRA=11:print_format=json`,
      '-f',
      'null',
      '-',
    ],
    { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1 << 24 },
  );
  const log = result.stderr?.toString() ?? '';
  // Extract fields directly rather than JSON.parse-ing a brace block: some
  // clips (e.g. MiniMax) carry an `aigc` metadata tag whose own {...} braces
  // precede the loudnorm JSON and would otherwise be matched instead.
  const grab = (key: string): number => {
    const match = log.match(
      new RegExp(`"${key}"\\s*:\\s*"(-?[0-9.]+|-?inf)"`),
    );
    if (!match) return NaN;
    if (match[1].includes('inf')) return match[1].startsWith('-') ? -Infinity : Infinity;
    return Number.parseFloat(match[1]);
  };
  const i = grab('input_i');
  if (!Number.isFinite(i)) return null;
  const tp = grab('input_tp');
  const lra = grab('input_lra');
  const thresh = grab('input_thresh');
  return {
    i,
    tp: Number.isFinite(tp) ? tp : 0,
    lra: Number.isFinite(lra) ? lra : 0,
    thresh: Number.isFinite(thresh) ? thresh : 0,
  };
};

/** Source sample rate / channels / bitrate, so the re-encode changes only loudness. */
const probeAudio = (file: string): { sr: number; ch: number; br: number } => {
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=sample_rate,channels,bit_rate:format=bit_rate',
      '-of',
      'json',
      file,
    ],
    { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: 1 << 22 },
  );
  let sr = 44_100;
  let ch = 1;
  let br = 128_000;
  try {
    const json = JSON.parse(result.stdout?.toString() ?? '{}');
    const stream = json.streams?.[0] ?? {};
    sr = Number.parseInt(String(stream.sample_rate), 10) || sr;
    ch = Number.parseInt(String(stream.channels), 10) || ch;
    const streamBr = Number.parseInt(String(stream.bit_rate), 10);
    const formatBr = Number.parseInt(String(json.format?.bit_rate), 10);
    br =
      Number.isFinite(streamBr) && streamBr > 0
        ? streamBr
        : Number.isFinite(formatBr) && formatBr > 0
          ? formatBr
          : br;
  } catch {
    /* keep defaults */
  }
  return {
    sr,
    ch: Math.max(1, Math.min(2, ch)),
    br: Math.min(320_000, Math.max(48_000, br)),
  };
};

/** Download a clip to dest with retries; validate it is a real MP3. */
const downloadClip = (url: string, dest: string): boolean => {
  for (let attempt = 0; attempt < STEP_RETRIES; attempt += 1) {
    const result = spawnSync(
      'curl',
      [
        '-fsSL',
        '--max-time',
        String(DOWNLOAD_TIMEOUT_S),
        '--retry',
        '2',
        '--retry-delay',
        '1',
        '-o',
        dest,
        url,
      ],
      { timeout: (DOWNLOAD_TIMEOUT_S + 30) * 1000 },
    );
    if (result.status === 0 && existsSync(dest)) {
      const bytes = readFileSync(dest);
      if (bytes.length >= MIN_CLIP_BYTES && looksLikeMp3(bytes)) return true;
    }
    Bun.sleepSync(1000 * (attempt + 1));
  }
  return false;
};

/** Apply linear gain + true-peak limiter, re-encode preserving sr/ch/bitrate. */
const encodeNormalized = (
  src: string,
  dest: string,
  gainDb: number,
  audio: { sr: number; ch: number; br: number },
): boolean => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-filter_threads',
      '1',
      '-i',
      src,
      '-af',
      `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${TP_LIMIT_LINEAR}:level=false`,
      '-ac',
      String(audio.ch),
      '-ar',
      String(audio.sr),
      '-c:a',
      'libmp3lame',
      '-b:a',
      `${Math.round(audio.br / 1000)}k`,
      '-f',
      'mp3',
      dest,
    ],
    { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1 << 24 },
  );
  if (result.status !== 0 || !existsSync(dest)) return false;
  const bytes = readFileSync(dest);
  return looksLikeMp3(bytes) && bytes.length >= MIN_CLIP_BYTES;
};

/** PUT the new bytes to the EXACT existing pathname (in place), with retries. */
const uploadInPlace = async (
  pathname: string,
  bytes: Uint8Array,
  token: string,
): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < STEP_RETRIES; attempt += 1) {
    try {
      await put(pathname, Buffer.from(bytes), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'audio/mpeg',
        token,
        allowOverwrite: true,
        abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      return;
    } catch (error) {
      lastError = error;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

/* -------------------------------- checkpoint ------------------------------ */

const readCkptFile = (file: string): CkptLine[] => {
  if (!existsSync(file)) return [];
  const lines: CkptLine[] = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed) as CkptLine);
    } catch {
      /* ignore a torn final line */
    }
  }
  return lines;
};

const loadCkptHashes = (file: string): Set<string> =>
  new Set(readCkptFile(file).map((line) => line.hash));

const mergeAllCkpt = (): CkptLine[] => {
  if (!existsSync(CKPT_DIR)) return [];
  const byHash = new Map<string, CkptLine>();
  for (const name of readdirSync(CKPT_DIR)) {
    if (!name.endsWith('.jsonl')) continue;
    for (const line of readCkptFile(resolve(CKPT_DIR, name))) {
      byHash.set(line.hash, line);
    }
  }
  return [...byHash.values()];
};

/* ------------------------------ worker: one clip -------------------------- */

const processOne = async (
  entry: ManifestEntry,
  opts: NormalizeOpts,
  token: string,
  tmpDir: string,
): Promise<CkptLine> => {
  const base: Pick<CkptLine, 'hash' | 'pathname' | 'label'> = {
    hash: entry.hash,
    pathname: entry.pathname,
    label: entry.label,
  };
  const src = resolve(tmpDir, `${entry.hash}.src.mp3`);
  const out = resolve(tmpDir, `${entry.hash}.out.mp3`);
  try {
    if (!downloadClip(entry.url, src)) {
      return { ...base, beforeI: null, beforeTp: null, gainDb: null, outcome: 'failed', note: 'download failed' };
    }
    const before = measureLoudness(src);
    if (!before) {
      return { ...base, beforeI: null, beforeTp: null, gainDb: null, outcome: 'failed', note: 'measure failed' };
    }

    const onTarget =
      Math.abs(before.i - opts.target) <= opts.tol && before.tp <= opts.tpCeiling;
    if (onTarget) {
      return {
        ...base,
        beforeI: before.i,
        beforeTp: before.tp,
        gainDb: 0,
        outcome: 'already-on-target',
      };
    }

    let gain = opts.target + opts.comp - before.i;
    let note: string | undefined;
    if (gain > GAIN_CAP_DB) {
      gain = GAIN_CAP_DB;
      note = `gain capped (+${GAIN_CAP_DB} dB); source ~${fmt(before.i)} LUFS`;
    } else if (gain < -GAIN_CAP_DB) {
      gain = -GAIN_CAP_DB;
      note = `gain capped (-${GAIN_CAP_DB} dB); source ~${fmt(before.i)} LUFS`;
    }

    const audio = probeAudio(src);
    if (!encodeNormalized(src, out, gain, audio)) {
      return { ...base, beforeI: before.i, beforeTp: before.tp, gainDb: gain, outcome: 'failed', note: 'encode failed' };
    }
    await uploadInPlace(entry.pathname, readFileSync(out), token);
    return {
      ...base,
      beforeI: before.i,
      beforeTp: before.tp,
      gainDb: gain,
      outcome: 'normalized',
      note,
    };
  } catch (error) {
    return {
      ...base,
      beforeI: null,
      beforeTp: null,
      gainDb: null,
      outcome: 'failed',
      note: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rmSync(src, { force: true });
    rmSync(out, { force: true });
  }
};

const runNormalizeWorker = async (
  flags: Map<string, string | true>,
): Promise<void> => {
  loadPipelineEnv();
  const token = requireEnv('BLOB_READ_WRITE_TOKEN');
  const manifestPath = flagStr(flags, 'manifest', MANIFEST_PATH);
  const from = flagNum(flags, 'from', 0);
  const to = flagNum(flags, 'to', 0);
  const ckpt = flagStr(flags, 'ckpt', resolve(CKPT_DIR, `shard-${from}-${to}.jsonl`));
  const opts: NormalizeOpts = {
    target: flagNum(flags, 'target', TARGET_LUFS),
    comp: flagNum(flags, 'comp', 0),
    tol: flagNum(flags, 'tol', IDEMPOTENT_TOL_LU),
    tpCeiling: flagNum(flags, 'tp-ceiling', TP_CEILING_DBTP),
  };

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    blobs: ManifestEntry[];
  };
  const slice = manifest.blobs.slice(from, to);
  const done = loadCkptHashes(ckpt);
  const tmpDir = mkTmpDir();
  try {
    for (const entry of slice) {
      if (done.has(entry.hash)) continue;
      const line = await processOne(entry, opts, token, tmpDir);
      appendFileSync(ckpt, `${JSON.stringify(line)}\n`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

/** Band (LU) within which a settled clip is "done"; a wider read triggers a re-fetch. */
const SETTLE_BAND_LU = 1.5;
const SETTLE_RETRIES = 4;
const SETTLE_DELAY_MS = 5_000;

const runMeasureWorker = async (
  flags: Map<string, string | true>,
): Promise<void> => {
  const tasksPath = flagStr(flags, 'tasks', '');
  const outPath = flagStr(flags, 'out', '');
  const calibrate = flags.has('calibrate');
  // settle: this is a post-normalization verify; a clip should read ~target.
  // If it reads far off, the overwrite may not have propagated yet (a few
  // seconds), so re-download + re-measure before trusting an off reading.
  const settle = flags.has('settle');
  const target = flagNum(flags, 'target', TARGET_LUFS);
  const tasks = JSON.parse(readFileSync(tasksPath, 'utf8')) as MeasureTask[];
  const tmpDir = mkTmpDir();
  const results: MeasureResult[] = [];
  try {
    for (const task of tasks) {
      const src = resolve(tmpDir, `${task.hash}.mp3`);
      const out = resolve(tmpDir, `${task.hash}.out.mp3`);
      try {
        let measured: Loudness | null = null;
        for (let attempt = 0; attempt < (settle ? SETTLE_RETRIES : 1); attempt += 1) {
          if (!downloadClip(task.url, src)) {
            measured = null;
            continue;
          }
          measured = measureLoudness(src);
          if (!settle || !measured) break;
          if (Math.abs(measured.i - target) <= SETTLE_BAND_LU) break;
          if (attempt < SETTLE_RETRIES - 1) Bun.sleepSync(SETTLE_DELAY_MS);
        }
        if (!measured) {
          results.push({ ...task, ok: false, error: 'download/measure failed' });
          continue;
        }
        let residual: number | null = null;
        if (calibrate) {
          const audio = probeAudio(src);
          if (encodeNormalized(src, out, target - measured.i, audio)) {
            const after = measureLoudness(out);
            if (after) residual = after.i - target;
          }
        }
        results.push({
          ...task,
          ok: true,
          i: measured.i,
          tp: measured.tp,
          lra: measured.lra,
          residual,
        });
      } finally {
        rmSync(src, { force: true });
        rmSync(out, { force: true });
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  writeFileSync(outPath, JSON.stringify(results, null, 2));
};

/* ------------------------------- orchestrator ----------------------------- */

const enumerateBlobs = async (
  token: string,
): Promise<{ pathname: string; url: string; size: number }[]> => {
  const blobs: { pathname: string; url: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const res = await list({ prefix: BLOB_PREFIX, limit: 1000, cursor, token });
    for (const blob of res.blobs) {
      if (blob.pathname.endsWith('.mp3')) {
        blobs.push({ pathname: blob.pathname, url: blob.url, size: blob.size });
      }
    }
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  return blobs;
};

/** hash -> {model,provider,voice,prompt} for every known (variant x prompt). */
const buildLabelMap = (): Map<string, NonNullable<Label>> => {
  const map = new Map<string, NonNullable<Label>>();
  for (const model of pipelineModels()) {
    for (const voiceId of SOURCE_VOICE_IDS) {
      const variantId = variantIdFor(voiceId, model.providerId, model.arenaApiId);
      for (const prompt of PROMPTS) {
        const hash = clipHash(variantId, prompt.id);
        if (!map.has(hash)) {
          map.set(hash, {
            modelId: model.id,
            providerId: model.providerId,
            voiceId,
            promptId: prompt.id,
          });
        }
      }
    }
  }
  return map;
};

/** Round-robin pick across (model, voice) groups so a small sample spans both. */
const pickRepresentative = (
  entries: ManifestEntry[],
  maxTotal: number,
  perGroup: number,
  promptOffset = 0,
): ManifestEntry[] => {
  const groups = new Map<string, ManifestEntry[]>();
  for (const entry of entries) {
    if (!entry.label) continue;
    const key = `${entry.label.modelId}|${entry.label.voiceId}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }
  const ordered = [...groups.values()].map((arr) =>
    arr.sort((a, b) => a.label!.promptId.localeCompare(b.label!.promptId)),
  );
  const picked: ManifestEntry[] = [];
  for (let round = 0; round < perGroup && picked.length < maxTotal; round += 1) {
    for (const group of ordered) {
      if (round >= group.length) continue;
      picked.push(group[(round + promptOffset) % group.length]);
      if (picked.length >= maxTotal) break;
    }
  }
  return picked;
};

const toTasks = (entries: ManifestEntry[]): MeasureTask[] =>
  entries.map(({ pathname, url, hash, label }) => ({ pathname, url, hash, label }));

/** Spawn a fresh worker process; stream its stderr to the log; time it out. */
const runWorker = (
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; timedOut: boolean }> =>
  new Promise((resolveRun) => {
    const child = spawn('bun', ['run', SCRIPT_PATH, ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stderr?.on('data', (data: Buffer) => {
      appendFileSync(WORKER_LOG, data.toString());
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? -1, timedOut });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      appendFileSync(WORKER_LOG, `spawn error: ${String(error)}\n`);
      resolveRun({ code: -1, timedOut });
    });
  });

/** Run a measure/calibrate pass in ONE worker process and read its results. */
const measureViaWorker = async (
  entries: ManifestEntry[],
  opts: { calibrate?: boolean; settle?: boolean; target: number },
): Promise<MeasureResult[]> => {
  if (entries.length === 0) return [];
  const tasksPath = resolve(RESULTS_DIR, `tasks-${Date.now()}.json`);
  const outPath = resolve(RESULTS_DIR, `measure-${Date.now()}.json`);
  writeFileSync(tasksPath, JSON.stringify(toTasks(entries), null, 2));
  const args = [
    '--role',
    'worker',
    '--mode',
    'measure',
    '--tasks',
    tasksPath,
    '--out',
    outPath,
    '--target',
    String(opts.target),
  ];
  if (opts.calibrate) args.push('--calibrate');
  if (opts.settle) args.push('--settle');
  const res = await runWorker(args, WORKER_TIMEOUT_MS);
  if (res.code !== 0 || !existsSync(outPath)) {
    throw new Error(`measure worker failed (code=${res.code}, timedOut=${res.timedOut})`);
  }
  const results = JSON.parse(readFileSync(outPath, 'utf8')) as MeasureResult[];
  rmSync(tasksPath, { force: true });
  rmSync(outPath, { force: true });
  return results;
};

const spreadOf = (values: number[]) => {
  const ok = values.filter((value) => Number.isFinite(value));
  if (ok.length === 0) {
    return { n: 0, min: NaN, median: NaN, max: NaN, stdev: NaN };
  }
  return {
    n: ok.length,
    min: Math.min(...ok),
    median: median(ok),
    max: Math.max(...ok),
    stdev: stdev(ok),
  };
};

const labelStr = (label: Label): string =>
  label ? `${label.modelId} / ${label.voiceId} / ${label.promptId}` : 'unknown';

/* ---------------------------- shard scheduling ---------------------------- */

const runNormalization = async (
  total: number,
  opts: NormalizeOpts & { shardSize: number; workers: number },
): Promise<void> => {
  const shards: { from: number; to: number }[] = [];
  for (let from = 0; from < total; from += opts.shardSize) {
    shards.push({ from, to: Math.min(from + opts.shardSize, total) });
  }
  const counts = { normalized: 0, 'already-on-target': 0, failed: 0 } as Record<
    Outcome,
    number
  >;
  let completed = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < shards.length) {
      const { from, to } = shards[cursor];
      cursor += 1;
      const ckpt = resolve(CKPT_DIR, `shard-${from}-${to}.jsonl`);
      let ok = false;
      for (let attempt = 0; attempt < SHARD_RETRIES && !ok; attempt += 1) {
        const res = await runWorker(
          [
            '--role',
            'worker',
            '--mode',
            'normalize',
            '--manifest',
            MANIFEST_PATH,
            '--from',
            String(from),
            '--to',
            String(to),
            '--ckpt',
            ckpt,
            '--target',
            String(opts.target),
            '--comp',
            String(opts.comp),
            '--tol',
            String(opts.tol),
            '--tp-ceiling',
            String(opts.tpCeiling),
          ],
          WORKER_TIMEOUT_MS,
        );
        ok = res.code === 0 && !res.timedOut;
        if (!ok) {
          appendFileSync(
            WORKER_LOG,
            `shard ${from}-${to} attempt ${attempt + 1} failed (code=${res.code}, timedOut=${res.timedOut})\n`,
          );
          await sleep(1000);
        }
      }
      completed += 1;
      // Reset running counts and recompute from all checkpoints (cheap, exact).
      counts.normalized = 0;
      counts['already-on-target'] = 0;
      counts.failed = 0;
      for (const line of mergeAllCkpt()) counts[line.outcome] += 1;
      console.log(
        `  [${completed}/${shards.length} shards] ${from}-${to} ${ok ? 'ok' : 'FAILED'} | ` +
          `normalized=${counts.normalized} on-target=${counts['already-on-target']} failed=${counts.failed}`,
      );
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(opts.workers, shards.length) }, () => worker()),
  );
};

/* ---------------------------------- report -------------------------------- */

const printReport = (
  manifest: ManifestEntry[],
  beforeSample: MeasureResult[],
  comp: number,
  opts: NormalizeOpts,
  verify: MeasureResult[],
  abPairs: { key: string; rows: MeasureResult[] }[],
): void => {
  const ckpt = mergeAllCkpt();
  const byOutcome = (outcome: Outcome) =>
    ckpt.filter((line) => line.outcome === outcome);
  const normalized = byOutcome('normalized');
  const onTarget = byOutcome('already-on-target');
  const failed = byOutcome('failed');

  const beforeFromRun = spreadOf(
    ckpt.map((line) => line.beforeI).filter((v): v is number => v != null),
  );
  const beforeFromSample = spreadOf(
    beforeSample.filter((r) => r.ok).map((r) => r.i!),
  );
  const verifyOk = verify.filter((r) => r.ok);
  const afterSpread = spreadOf(verifyOk.map((r) => r.i!));
  const tpSpread = spreadOf(verifyOk.map((r) => r.tp!));
  const overCeiling = verifyOk.filter((r) => (r.tp ?? 0) > opts.tpCeiling);

  const lines: string[] = [];
  lines.push('');
  lines.push('================ LOUDNESS NORMALIZATION REPORT ================');
  lines.push(`hosted clips enumerated : ${manifest.length}`);
  lines.push(
    `  labelled to a model     : ${manifest.filter((e) => e.label).length}`,
  );
  lines.push(
    `  unlabelled (not in reg.): ${manifest.filter((e) => !e.label).length}`,
  );
  lines.push('');
  lines.push(`TARGET : ${opts.target} LUFS integrated, true peak <= ${opts.tpCeiling} dBTP`);
  lines.push(
    `         (limiter ${TP_LIMIT_LINEAR} linear ~ -2 dBFS; MP3 comp ${comp >= 0 ? '+' : ''}${fmt(comp, 2)} dB; idempotent tol +/-${opts.tol} LU)`,
  );
  lines.push('');
  lines.push('BEFORE (representative sample, pre-normalization):');
  lines.push(
    `  n=${beforeFromSample.n}  min=${fmt(beforeFromSample.min)}  median=${fmt(beforeFromSample.median)}  max=${fmt(beforeFromSample.max)}  ` +
      `spread=${fmt(beforeFromSample.max - beforeFromSample.min)} LU  stdev=${fmt(beforeFromSample.stdev)}`,
  );
  if (beforeFromRun.n > 0) {
    lines.push('BEFORE (every clip processed this run):');
    lines.push(
      `  n=${beforeFromRun.n}  min=${fmt(beforeFromRun.min)}  median=${fmt(beforeFromRun.median)}  max=${fmt(beforeFromRun.max)}  ` +
        `spread=${fmt(beforeFromRun.max - beforeFromRun.min)} LU  stdev=${fmt(beforeFromRun.stdev)}`,
    );
  }
  lines.push('');
  lines.push('AFTER (verification sample re-measured from the live store):');
  lines.push(
    `  LUFS n=${afterSpread.n}  min=${fmt(afterSpread.min)}  median=${fmt(afterSpread.median)}  max=${fmt(afterSpread.max)}  ` +
      `spread=${fmt(afterSpread.max - afterSpread.min)} LU  stdev=${fmt(afterSpread.stdev)}`,
  );
  lines.push(
    `  TruePeak min=${fmt(tpSpread.min)}  median=${fmt(tpSpread.median)}  max=${fmt(tpSpread.max)} dBTP  ` +
      `(clips over ${opts.tpCeiling} dBTP: ${overCeiling.length})`,
  );
  lines.push('');
  lines.push('COUNTS:');
  lines.push(`  normalized (re-encoded + re-uploaded) : ${normalized.length}`);
  lines.push(`  already on target (left unchanged)    : ${onTarget.length}`);
  lines.push(`  failed                                : ${failed.length}`);
  lines.push(`  total accounted                       : ${ckpt.length} / ${manifest.length}`);
  if (failed.length > 0) {
    lines.push('');
    lines.push('FAILED / SKIPPED clips:');
    for (const line of failed.slice(0, 50)) {
      lines.push(`  ${line.hash} (${labelStr(line.label)}) — ${line.note ?? 'unknown'}`);
    }
    if (failed.length > 50) lines.push(`  ... and ${failed.length - 50} more`);
  }
  const capped = normalized.filter((line) => line.note?.includes('cap'));
  if (capped.length > 0) {
    lines.push('');
    lines.push(`gain-capped (likely defective/near-silent sources): ${capped.length}`);
    for (const line of capped.slice(0, 20)) {
      lines.push(`  ${line.hash} (${labelStr(line.label)}) — ${line.note}`);
    }
  }
  lines.push('');
  lines.push('BATTLE A/B SPOT CHECKS (same voice + prompt, different models):');
  for (const pair of abPairs) {
    const rows = pair.rows.filter((r) => r.ok);
    if (rows.length < 2) continue;
    const vals = rows.map((r) => r.i!);
    lines.push(
      `  ${pair.key}: spread ${fmt(Math.max(...vals) - Math.min(...vals))} LU`,
    );
    for (const row of rows) {
      lines.push(
        `      ${fmt(row.i)} LUFS / ${fmt(row.tp)} dBTP  ${row.label?.modelId ?? row.hash}`,
      );
    }
  }
  lines.push('===============================================================');

  const text = lines.join('\n');
  console.log(text);

  writeFileSync(
    REPORT_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        target: opts.target,
        tpCeiling: opts.tpCeiling,
        tpLimitLinear: TP_LIMIT_LINEAR,
        mp3CompDb: comp,
        idempotentTolLu: opts.tol,
        enumerated: manifest.length,
        labelled: manifest.filter((e) => e.label).length,
        beforeSample: beforeFromSample,
        beforeAllProcessed: beforeFromRun,
        afterVerify: afterSpread,
        afterVerifyTruePeak: tpSpread,
        counts: {
          normalized: normalized.length,
          alreadyOnTarget: onTarget.length,
          failed: failed.length,
          accounted: ckpt.length,
        },
        failed: failed.map((line) => ({
          hash: line.hash,
          label: line.label,
          note: line.note,
        })),
        verifySample: verifyOk.map((r) => ({
          hash: r.hash,
          label: r.label,
          i: r.i,
          tp: r.tp,
        })),
        abPairs: abPairs.map((pair) => ({
          key: pair.key,
          rows: pair.rows
            .filter((r) => r.ok)
            .map((r) => ({ modelId: r.label?.modelId, i: r.i, tp: r.tp })),
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nreport written to ${REPORT_PATH}`);
};

/* ---------------------------------- main ---------------------------------- */

const orchestrate = async (
  flags: Map<string, string | true>,
): Promise<void> => {
  loadPipelineEnv();
  const token = requireEnv('BLOB_READ_WRITE_TOKEN');
  mkdirSync(RESULTS_DIR, { recursive: true });
  mkdirSync(CKPT_DIR, { recursive: true });

  const dryRun = flags.has('dry-run');
  const verifyOnly = flags.has('verify-only');
  const force = flags.has('force');
  const target = flagNum(flags, 'target', TARGET_LUFS);
  const tol = flagNum(flags, 'tol', IDEMPOTENT_TOL_LU);
  const tpCeiling = flagNum(flags, 'tp-ceiling', TP_CEILING_DBTP);
  const limit = flagNum(flags, 'limit', 0);
  const shardSize = flagNum(flags, 'shard-size', DEFAULT_SHARD_SIZE);
  const workers = flagNum(flags, 'workers', DEFAULT_WORKERS);
  const sampleSize = flagNum(flags, 'sample', DEFAULT_SAMPLE);

  if (force && existsSync(CKPT_DIR)) {
    for (const name of readdirSync(CKPT_DIR)) {
      if (name.endsWith('.jsonl')) rmSync(resolve(CKPT_DIR, name), { force: true });
    }
    console.log('cleared checkpoints (--force)');
  }

  console.log(`enumerating hosted clips on ${BLOB_PREFIX}* ...`);
  const rawBlobs = await enumerateBlobs(token);
  const labelMap = buildLabelMap();
  let manifest: ManifestEntry[] = rawBlobs
    .map((blob) => {
      const hash = hashFromPathname(blob.pathname);
      return {
        pathname: blob.pathname,
        url: blob.url,
        hash,
        size: blob.size,
        label: labelMap.get(hash) ?? null,
      };
    })
    .sort((a, b) => a.pathname.localeCompare(b.pathname));
  if (limit > 0) manifest = manifest.slice(0, limit);

  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        origin: BLOB_PREFIX,
        count: manifest.length,
        blobs: manifest,
      },
      null,
      2,
    )}\n`,
  );

  const byProvider = new Map<string, number>();
  for (const entry of manifest) {
    const key = entry.label?.providerId ?? 'unknown';
    byProvider.set(key, (byProvider.get(key) ?? 0) + 1);
  }
  console.log(`enumerated ${manifest.length} clips:`);
  for (const [provider, count] of [...byProvider.entries()].sort()) {
    console.log(`  ${provider.padEnd(14)} ${count}`);
  }
  console.log(`manifest written to ${MANIFEST_PATH}`);

  // ----- verify-only short circuit -----
  if (verifyOnly) {
    const { verify, abPairs } = await runVerification(manifest, target, false);
    printReport(manifest, [], 0, { target, comp: 0, tol, tpCeiling }, verify, abPairs);
    return;
  }

  // ----- before sample + calibration -----
  console.log(`\nmeasuring a representative sample (n<=${sampleSize}) ...`);
  const beforeSampleEntries = pickRepresentative(manifest, sampleSize, 3);
  const beforeSample = await measureViaWorker(beforeSampleEntries, { target });
  const beforeStats = spreadOf(beforeSample.filter((r) => r.ok).map((r) => r.i!));
  console.log(
    `  BEFORE spread: n=${beforeStats.n} min=${fmt(beforeStats.min)} median=${fmt(beforeStats.median)} ` +
      `max=${fmt(beforeStats.max)} (=${fmt(beforeStats.max - beforeStats.min)} LU spread)`,
  );

  console.log(`calibrating MP3 re-encode loudness offset (n<=${CALIBRATE_SUBSET}) ...`);
  const calibrationEntries = pickRepresentative(manifest, CALIBRATE_SUBSET, 1, 5);
  const calibration = await measureViaWorker(calibrationEntries, {
    target,
    calibrate: true,
  });
  const residuals = calibration
    .map((r) => r.residual)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const comp = residuals.length > 0 ? -median(residuals) : 0;
  console.log(
    `  measured residual median=${fmt(residuals.length ? median(residuals) : 0, 2)} LU ` +
      `-> MP3 comp ${comp >= 0 ? '+' : ''}${fmt(comp, 2)} dB`,
  );

  const opts: NormalizeOpts = { target, comp, tol, tpCeiling };

  if (dryRun) {
    console.log('\n--dry-run: skipping normalization. Spread + target shown above.');
    printReport(manifest, beforeSample, comp, opts, [], []);
    return;
  }

  // ----- normalize everything -----
  console.log(
    `\nnormalizing ${manifest.length} clips to ${target} LUFS ` +
      `(shards of ${shardSize}, ${workers} workers) ...`,
  );
  await runNormalization(manifest.length, { ...opts, shardSize, workers });

  // ----- verify -----
  // In-place overwrites take a few seconds to propagate to the public URL
  // (measured <8 s); wait, then verify with per-clip settle retries.
  const verifyDelayMs = flagNum(flags, 'verify-delay', 20) * 1000;
  console.log(
    `\nwaiting ${verifyDelayMs / 1000}s for blob propagation, then verifying from the live store ...`,
  );
  await sleep(verifyDelayMs);
  const { verify, abPairs } = await runVerification(manifest, target, true);
  printReport(manifest, beforeSample, comp, opts, verify, abPairs);
};

/** Re-measure a post-normalization sample + a few battle A/B groups. */
const runVerification = async (
  manifest: ManifestEntry[],
  target: number,
  settle: boolean,
): Promise<{ verify: MeasureResult[]; abPairs: { key: string; rows: MeasureResult[] }[] }> => {
  const sample = pickRepresentative(manifest, VERIFY_SAMPLE, 2, 7);
  // Guarantee a human clip is in the sample if one exists.
  const human = manifest.filter((e) => e.label?.providerId === 'human').slice(0, 2);
  const sampleByHash = new Map(sample.map((e) => [e.hash, e]));
  for (const entry of human) sampleByHash.set(entry.hash, entry);

  // Battle A/B groups: same (voice, prompt) across whatever models host it.
  const abKeys: { voiceId: string; promptId: string }[] = [
    { voiceId: 'voice-clara', promptId: 'clip-01' },
    { voiceId: 'voice-nelliot', promptId: 'clip-02' },
    { voiceId: 'voice-clara', promptId: 'clip-12' },
  ];
  const abGroups = abKeys.map(({ voiceId, promptId }) => ({
    key: `${voiceId} / ${promptId}`,
    entries: manifest
      .filter((e) => e.label?.voiceId === voiceId && e.label.promptId === promptId)
      .slice(0, 6),
  }));
  for (const group of abGroups) {
    for (const entry of group.entries) sampleByHash.set(entry.hash, entry);
  }

  const measured = await measureViaWorker([...sampleByHash.values()], {
    target,
    settle,
  });
  const byHash = new Map(measured.map((r) => [r.hash, r]));
  const abPairs = abGroups.map((group) => ({
    key: group.key,
    rows: group.entries
      .map((entry) => byHash.get(entry.hash))
      .filter((row): row is MeasureResult => Boolean(row)),
  }));
  return { verify: measured, abPairs };
};

const main = async (): Promise<void> => {
  const { flags } = parseArgs(process.argv.slice(2));
  const role = flagStr(flags, 'role', 'orchestrator');
  if (role === 'worker') {
    const mode = flagStr(flags, 'mode', 'normalize');
    if (mode === 'measure') {
      await runMeasureWorker(flags);
    } else {
      await runNormalizeWorker(flags);
    }
    return;
  }
  await orchestrate(flags);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
