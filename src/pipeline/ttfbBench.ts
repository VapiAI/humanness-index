/// <reference types="bun" />
/**
 * Live TTFB (time-to-first-audio) benchmark for the Humanness Index™ models —
 * a full TypeScript port of the original prototype's 50-trial bench.
 *
 * Methodology (identical to the original):
 *  - per model: 2 warm-up trials (discarded) + 50 measured trials,
 *  - SEQUENTIAL within a provider (concurrency inflates TTFB); different
 *    providers run in parallel,
 *  - t0 at synthesis-request send on a pre-established connection
 *    (explicit connect for WS; keep-alive absorbed by warm-ups for HTTP),
 *  - t1 at the first audio chunk received,
 *  - 429s retried with exponential backoff and counted, never timed,
 *  - stats: median/p90/min/max/stdev/n; results JSON + table printed.
 *
 *   bun run humanness:ttfb [model-or-provider filter ...] [--trials 50]
 *
 * The model list derives from the registry (plus pending pipeline models),
 * so newly registered models are benchable with zero extra wiring. Models
 * whose provider has no transport or key are reported as unmeasurable with
 * a reason, never invented.
 *
 * Results → pipeline/results/ttfb_results_50trial.json (gitignored). The
 * registry's measured `latencyMs` values cite that artifact path.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadPipelineEnv } from './env';
import { median, parseArgs, sleep, stdev } from './lib';
import { pipelineModels, type PipelineModel } from './models';
import {
  BENCH_TEXT,
  RateLimitedError,
  transportFor,
  UNMEASURABLE_PROVIDERS,
  type TtfbPlan,
} from './transports';

const WARMUP_TRIALS = 2;
const DEFAULT_MEASURED_TRIALS = 50;
const TRIAL_PAUSE_MS = 300;
const MODEL_PAUSE_MS = 1000;
const MAX_RATE_LIMIT_RETRIES = 6;
const OUT_PATH = resolve(import.meta.dir, 'results', 'ttfb_results_50trial.json');

type ModelRecord = {
  provider: string;
  model_id: string;
  api_model_id: string;
  transport: string;
  text: string;
  trials_ms: number[];
  connect_ms: number[];
  warmup_ms: number[];
  errors: string[];
  rate_limit_hits: number;
  notes: string;
  elapsed_s?: number;
  stats?: {
    median_ms: number;
    p90_ms: number;
    min_ms: number;
    max_ms: number;
    stdev_ms: number;
    n: number;
  };
};

const runModel = async (
  model: PipelineModel,
  plan: Extract<TtfbPlan, { trial: unknown }>,
  measuredTrials: number,
): Promise<ModelRecord> => {
  const record: ModelRecord = {
    provider: model.providerId,
    model_id: model.id,
    api_model_id: model.vendorModelId,
    transport: plan.transport,
    text: BENCH_TEXT,
    trials_ms: [],
    connect_ms: [],
    warmup_ms: [],
    errors: [],
    rate_limit_hits: 0,
    notes: plan.notes ?? '',
  };
  let measured = 0;
  let warmups = 0;
  let backoffMs = 2000;
  let rateLimitRetries = 0;

  while (measured < measuredTrials) {
    const isWarmup = warmups < WARMUP_TRIALS;
    let result: { ttfbMs: number; connectMs: number };
    try {
      result = await plan.trial();
      backoffMs = 2000;
      rateLimitRetries = 0;
    } catch (error) {
      if (error instanceof RateLimitedError) {
        record.rate_limit_hits += 1;
        rateLimitRetries += 1;
        if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
          record.errors.push(
            `giving up after ${MAX_RATE_LIMIT_RETRIES} consecutive 429s: ${error.message}`,
          );
          break;
        }
        console.log(
          `  ${model.providerId}/${model.vendorModelId}: 429 rate-limited, backing off ${Math.round(backoffMs / 1000)}s`,
        );
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
        continue;
      }
      record.errors.push(
        `${isWarmup ? 'warmup' : 'trial'} ${warmups + measured}: ${
          error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
        }`,
      );
      if (record.errors.length >= 5 && record.trials_ms.length === 0) break;
      await sleep(TRIAL_PAUSE_MS);
      if (isWarmup) warmups += 1;
      else measured += 1; // count the slot but record no timing
      continue;
    }
    if (isWarmup) {
      warmups += 1;
      record.warmup_ms.push(Math.round(result.ttfbMs * 10) / 10);
    } else {
      measured += 1;
      record.trials_ms.push(Math.round(result.ttfbMs * 10) / 10);
      record.connect_ms.push(Math.round(result.connectMs * 10) / 10);
      if (measured % 10 === 0) {
        console.log(
          `  ${model.providerId}/${model.vendorModelId}: ${measured}/${measuredTrials} trials done ` +
            `(last ${Math.round(result.ttfbMs)} ms)`,
        );
      }
    }
    await sleep(TRIAL_PAUSE_MS);
  }

  const trials = record.trials_ms;
  if (trials.length > 0) {
    const ordered = [...trials].sort((a, b) => a - b);
    record.stats = {
      median_ms: Math.round(median(trials)),
      p90_ms: Math.round(
        ordered[Math.min(ordered.length - 1, Math.ceil(0.9 * ordered.length) - 1)],
      ),
      min_ms: Math.round(Math.min(...trials)),
      max_ms: Math.round(Math.max(...trials)),
      stdev_ms: Math.round(stdev(trials)),
      n: trials.length,
    };
  }
  return record;
};

const main = async (): Promise<void> => {
  loadPipelineEnv();
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const measuredTrials = Number(flags.get('trials') ?? DEFAULT_MEASURED_TRIALS);

  const filters = positionals.map((value) => value.toLowerCase());
  const matchesFilter = (model: PipelineModel): boolean =>
    filters.length === 0 ||
    filters.some(
      (filter) =>
        model.id.toLowerCase() === filter ||
        model.slug.toLowerCase() === filter ||
        model.providerId.toLowerCase() === filter ||
        model.vendorModelId.toLowerCase() === filter,
    );

  const candidates = pipelineModels().filter(matchesFilter);
  const unmeasurable: Array<{ provider: string; model_id: string; reason: string }> = [];
  const planned: Array<{ model: PipelineModel; plan: Extract<TtfbPlan, { trial: unknown }> }> = [];

  for (const model of candidates) {
    const transport = transportFor(model.providerId);
    if (!transport?.ttfbPlanFor) {
      unmeasurable.push({
        provider: model.providerId,
        model_id: model.id,
        reason:
          UNMEASURABLE_PROVIDERS[model.providerId] ??
          `no transport implemented for ${model.providerId}`,
      });
      continue;
    }
    if (!process.env[transport.apiKeyEnv]?.trim()) {
      unmeasurable.push({
        provider: model.providerId,
        model_id: model.id,
        reason: `missing ${transport.apiKeyEnv} in pipeline/.env`,
      });
      continue;
    }
    const plan = transport.ttfbPlanFor(model.vendorModelId);
    if ('unmeasurable' in plan) {
      unmeasurable.push({
        provider: model.providerId,
        model_id: model.id,
        reason: plan.unmeasurable,
      });
      continue;
    }
    planned.push({ model, plan });
  }

  console.log(
    `benchmarking ${planned.length} models (${measuredTrials} trials each), ` +
      `${unmeasurable.length} unmeasurable`,
  );

  // Sequential within a provider; providers in parallel.
  const byProvider = new Map<string, typeof planned>();
  for (const entry of planned) {
    const group = byProvider.get(entry.model.providerId) ?? [];
    group.push(entry);
    byProvider.set(entry.model.providerId, group);
  }
  const outputs = new Map<string, ModelRecord[]>();
  await Promise.all(
    [...byProvider.entries()].map(async ([providerId, group]) => {
      const records: ModelRecord[] = [];
      for (const { model, plan } of group) {
        console.log(`=== ${providerId} / ${model.id} (${model.vendorModelId}) via ${plan.transport}`);
        const started = performance.now();
        const record = await runModel(model, plan, measuredTrials);
        record.elapsed_s = Math.round((performance.now() - started) / 100) / 10;
        records.push(record);
        console.log(
          `=== ${providerId} / ${model.vendorModelId} finished in ${record.elapsed_s}s ` +
            `(${record.stats?.n ?? 0} timings, ${record.errors.length} errors, ` +
            `${record.rate_limit_hits} rate-limit hits)`,
        );
        await sleep(MODEL_PAUSE_MS);
      }
      outputs.set(providerId, records);
    }),
  );

  const results = {
    methodology: {
      text: BENCH_TEXT,
      measure:
        't0 at synthesis-request send (connection pre-established) -> t1 at first audio chunk received',
      trials:
        `${WARMUP_TRIALS} warm-up discarded + ${measuredTrials} measured per model; ` +
        `sequential within a provider, providers in parallel; ${TRIAL_PAUSE_MS}ms pacing between trials`,
      machine:
        'local dev machine; includes network RTT from this machine to provider',
      date: new Date().toISOString(),
      port: 'TypeScript port of the original prototype 50-trial TTFB bench',
    },
    models: [...byProvider.keys()].flatMap((providerId) => outputs.get(providerId) ?? []),
    unmeasurable,
  };

  mkdirSync(resolve(import.meta.dir, 'results'), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nwrote ${OUT_PATH}`);

  const pad = (value: string | number, width: number): string =>
    String(value).padEnd(width);
  console.log(
    `\n${pad('provider', 12)} ${pad('model id', 28)} ${pad('api model id', 26)} ` +
      `median   p90   min   max  stdev   n  transport`,
  );
  for (const record of results.models) {
    if (record.stats) {
      const s = record.stats;
      console.log(
        `${pad(record.provider, 12)} ${pad(record.model_id, 28)} ${pad(record.api_model_id, 26)} ` +
          `${String(s.median_ms).padStart(6)} ${String(s.p90_ms).padStart(5)} ${String(s.min_ms).padStart(5)} ` +
          `${String(s.max_ms).padStart(5)} ${String(s.stdev_ms).padStart(6)} ${String(s.n).padStart(3)}  ${record.transport}`,
      );
    } else {
      console.log(
        `${pad(record.provider, 12)} ${pad(record.model_id, 28)} ${pad(record.api_model_id, 26)} ` +
          ` FAILED ${record.errors.slice(0, 1).join(' ')}`,
      );
    }
  }
  for (const entry of unmeasurable) {
    console.log(`${pad(entry.provider, 12)} ${pad(entry.model_id, 28)} unmeasurable: ${entry.reason}`);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
