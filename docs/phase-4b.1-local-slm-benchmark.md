# Phase 4B.1: Local SLM Feasibility Benchmark

## Outcome

The experiment adds an opt-in, isolated browser benchmark for a local language model. The existing deterministic Italian interpreter remains unchanged and is still the fallback. No recipe is applied or persisted by the benchmark page.

The deterministic baseline is useful on explicit dates and structured requests, but still misses colloquial, conversational, and ambiguity cases. A local SLM remains an unmeasured candidate: no model weights were downloaded and no model inference was run. This phase therefore establishes feasibility boundaries, not evidence that the model improves quality.

## Candidate And Runtime

- Model candidate: [Qwen2.5-0.5B-Instruct ONNX](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct), Q4F16 through Transformers.js.
- The model card describes a 0.49B-parameter instruction model and lists Italian among supported languages. The selected quantized weights are reported at approximately 483 MB; this is a model-download estimate, not a measured browser cache size.
- Transformers.js runs inference in a Web Worker using WebGPU. The page checks for a secure context and usable WebGPU adapter before loading. Support and performance remain device/browser dependent.
- Model files are not included in the production bundle. Loading them requires a user action and a network download from the model host; inference is intended to run locally after download/cache.
- Safari/iOS compatibility, actual download size/time, memory use, warm/cold inference latency, and model quality have not been tested.

## Deterministic Baseline

Reproduce with:

```sh
npm test -- src/domain/naturalLanguage/benchmark.test.ts --reporter=verbose
```

The test prints a JSON `NATURAL_LANGUAGE_BENCHMARK` summary, including category scores and failure IDs. The corpus contains 96 manually authored Italian prompts across 12 categories. Each run uses the same fixed clock (`2026-10-24T10:00:00.000Z`), `Europe/Rome`, the official flour catalogue, an empty pantry, and a valid initial flour blend. It does not modify application state.

### Observed Metrics

| Metric | Result |
| --- | ---: |
| Exact normalized patch matches | 71 / 96 (74.0%) |
| Field precision | 97.8% |
| Field recall | 79.3% |
| Field F1 | 87.6% |
| Invalid patch rate | 4 / 96 (4.2%) |
| Invalid-case detection recall | 4 / 4 (100%) |
| Unsupported abstention recall | 6 / 6 (100%) |
| Expected ambiguity cases missed | 8 / 18 (44.4%) |
| Deterministic parser latency, median / p95 | 0.061 ms / 0.652 ms |

Category exact accuracy:

| Category | Matches |
| --- | ---: |
| Basics | 10 / 14 (71.4%) |
| Compound | 5 / 10 (50.0%) |
| Catalogue | 9 / 10 (90.0%) |
| Yeast | 7 / 8 (87.5%) |
| Fermentation | 7 / 11 (63.6%) |
| Dates | 8 / 8 (100%) |
| Availability | 2 / 5 (40.0%) |
| Ambiguity | 8 / 10 (80.0%) |
| Invalid | 4 / 4 (100%) |
| Unsupported | 5 / 5 (100%) |
| Colloquial | 2 / 6 (33.3%) |
| Follow-up | 4 / 5 (80.0%) |

Latency is measured with `performance.now()` inside the Vitest/jsdom run. It describes this deterministic code path on the benchmark machine, not browser UI latency and not model inference latency. Timings vary between runs.

### Scoring Notes And Limits

- Gold labels are manually authored, not independently adjudicated. They were reviewed for initial-state flour composition, derived schedule fields, yeast conversion precision, and an invalid-duration label; further review is still warranted.
- Exact patch comparison uses the interpreter's explicit fields. Flour entries are sorted by ID; yeast percentages are rounded to three decimal places. A false `useTotalWeight` is ignored when no total weight was requested. A derived `bakingAt` is ignored unless that case explicitly expects a requested bake time.
- Field precision/recall/F1 are micro-averaged over the tracked patch fields. Invalid rate uses all 96 prompts as its denominator; invalid detection recall uses only gold cases marked invalid. Ambiguity and unsupported recall likewise use only their marked gold cases.
- Follow-up prompts are run independently, without preceding conversation history. Their scores do not establish conversational multi-turn quality.
- Results are an evaluation of this fixed corpus and interpreter path, not a broad estimate of Italian language understanding.

## Production Bundle Impact

Measured with `npm run build` after adding the optional route:

| Asset | Raw size | Gzip |
| --- | ---: | ---: |
| Main entry | 425.39 kB | 120.85 kB |
| Lazy benchmark route | 15.19 kB | 5.65 kB |
| Model worker | 546.54 kB | not reported |
| ONNX Runtime WASM | 26,861.77 kB | 6,762.79 kB |

The route is lazy-loaded and gated by `VITE_ENABLE_LOCAL_SLM_BENCHMARK=true`; it is disabled by default. Runtime assets are emitted by the build, but the approximately 483 MB model weights are not bundled. No paid service, inference API, cloud backend, API key, commit, push, or deployment was used.

## Recommendation

Proceed to Phase 4B.2 only as a controlled, user-triggered browser experiment. Compare the SLM and deterministic interpreter on the same reviewed corpus, recording exact/field quality, abstention and ambiguity behavior, cold and warm latency, download/cache size, and memory on named devices. First confirm WebGPU and download behavior on intended desktop browsers; treat iPhone/Safari as an explicit compatibility gate rather than an assumption.

Do not replace or automatically override the deterministic interpreter, enable the benchmark route by default, or make a product-quality claim until those measurements show a repeatable improvement that justifies the large model/runtime cost. Keep candidate patches validated and non-persistent.