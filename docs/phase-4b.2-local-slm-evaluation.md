# Phase 4B.2: Deterministic Interpreter Hardening and Local SLM Gate

## Outcome

Phase 4B.2 improves the deterministic Italian interpreter and adds a conservative, developer-only local SLM experiment. The deterministic interpreter remains the primary path. The SLM is not a recipe engine: it is considered only when the deterministic parse is unresolved, its output is shape-checked and validated, conflicts are rejected, and failures fall back to the deterministic result. No recipe is automatically applied or persisted by this experiment.

The parser is measurably stronger on the authored corpora. The model itself remains unevaluated: no weights were downloaded and no real inference was run. This phase does not establish that the SLM improves quality or is suitable for product use.

## Deterministic Evaluation

Reproduce the current authored-corpus and held-out results with:

```sh
npm test -- src/domain/naturalLanguage/benchmark.test.ts --reporter=verbose
```

The tests print `NATURAL_LANGUAGE_BENCHMARK_AFTER` and `NATURAL_LANGUAGE_HELDOUT_V2` JSON records. They use a fixed clock (`2026-10-24T10:00:00.000Z`), `Europe/Rome`, the official flour catalogue, an empty pantry, and the same valid initial flour blend. Timings are Vitest/jsdom measurements, not browser response-time measurements.

### Current Results

| Metric | Original 96-case corpus | Held-out v2, 48 cases |
| --- | ---: | ---: |
| Exact normalized patch matches | 94 / 96 (97.9%) | 47 / 48 (97.9%) |
| Field precision | 99.1% | 94.6% |
| Field recall | 99.1% | 100% |
| Field F1 | 99.1% | 97.2% |
| Expected ambiguities detected | 20 / 20 | 25 / 25 |
| Ambiguous requests with applicable proposals | 0 | 0 |
| Unsupported requests safely abstained | 6 / 6 | 1 / 1 |
| Median / p95 parser time | 0.086 / 0.806 ms | 0.054 / 0.524 ms |

The two exact-match misses in the original corpus are `ferment-09` and `contradiction-05`. The held-out v2 miss is `hold-conflict-06` (“Impasto totale 900 g e sei panetti da 150 g.”): the parser extracts the explicit portion count and weight, flags the conflict with total dough weight, and does not produce an applicable configuration. It is counted as an exact-patch miss because exact patch matching expects an empty patch for an ambiguous prompt; the separate ambiguity safety metric passes.

The original corpus also reports a 4.2% invalid-patch rate. All explicitly invalid cases were detected (4/4); unsupported abstention recall was 6/6. The held-out corpus contains no expected invalid cases, so its invalid-case recall denominator is zero and is not meaningful.

## Held-Out Annotation History

The held-out data is versioned in `benchmarkHeldOutDataset.ts`. The historical v1 result was 29/48 exact matches (60.4%), field F1 61.3%, and 15/25 expected ambiguities missed. During evaluation, the expected output for one prompt was corrected: “Usa 0,15 per cento di lievito fresco” explicitly names fresh yeast, so v2 expects `yeastType: fresh` as well as the percentage. This correction followed inspection of the evaluated output. V2 is therefore the corrected set for future comparisons; the v1 baseline is preserved as historical context and is **not a like-for-like before/after baseline** for v2. Do not interpret the raw score difference as an unbiased estimate of parser improvement.

Gold labels are manually authored and not independently adjudicated. Follow-up prompts are evaluated without earlier turns, so they test context-missing clarification, not multi-turn conversation quality. The corpora measure only these fixed cases and do not estimate general Italian language understanding.

## Hybrid and Safety Policy

- Run the deterministic interpreter first; if it resolves the request, do not load or invoke the model.
- Do not delegate any ambiguity already detected by the deterministic parser (including flour selection, missing conversation context, or incomplete times) to the model; show the parser's clarification instead.
- Validate model JSON keys, field shapes, flour catalogue IDs, and recipe patches before presenting a candidate.
- Reject model proposals that conflict with explicit parser extractions; return clarification instead.
- Do not generate or modify yeast amounts or yeast type with the model. Yeast prediction/calculation engine behavior was not changed in this phase.
- Never automatically apply or persist an experimental proposal. Runtime failures leave the deterministic path available.
- The route is gated by `VITE_ENABLE_LOCAL_SLM_BENCHMARK=true` and is disabled by default. Loading requires an explicit button action.

Capability checks require a secure context and WebGPU, and optionally block devices when the browser reports less than 4 GB of system memory. Browser memory estimates are advisory and not uniformly exposed. They are not a guarantee of model fit; actual allocation or runtime failures remain possible. The app does not compare model download bytes with the maximum size of a single GPU buffer, since those quantities do not establish whether a model can load.

## Runtime, Bundle, and Browser Evidence

Model candidate: [Qwen2.5-0.5B-Instruct ONNX](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct), Q4F16 through Transformers.js 4.3.1. The approximate 483 MB figure is an estimated model-weight download, not a measured transfer or cache size. Tokenizer/runtime assets add overhead. No automatic download is configured.

Production build output from `npm run build`:

| Asset | Raw size | Gzip |
| --- | ---: | ---: |
| Main entry | 425.62 kB | 120.89 kB |
| Lazy benchmark route | 17.94 kB | 6.56 kB |
| Model worker | 588.96 kB | not reported |
| ONNX Runtime WASM | 26,861.77 kB | 6,762.79 kB |

The existing GitHub Pages base path `/lievia/` and HashRouter remain in place. A local Vite smoke check with the feature flag unset confirmed that the app rendered, `#/benchmark-slm` had no matching route, and there were no requests for the model worker, ONNX runtime, or Qwen/model-host resources. This establishes flag-off startup behavior in that local browser session only; it does not establish production hosting, offline, or all-browser behavior.

The [Transformers.js documentation](https://huggingface.co/docs/transformers.js/en/index) documents WebGPU inference and warns that WebGPU is experimental in many browsers. The [MDN WebGPU reference](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) states that WebGPU requires a secure context and is not Baseline across browsers. Safari/iOS and other target browser/device combinations were not tested in this phase. No real model download, cold/warm latency, peak memory, model quality, or inference compatibility measurements are available.

## Validation

- `npm test`: 17 files passed, 131 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript project build and Vite production build.
- Browser smoke check with the SLM feature flag disabled: app rendered; hidden benchmark route and model/runtime requests absent.

## Recommendation

Keep the SLM behind the disabled-by-default developer flag. The deterministic improvements and ambiguity safety results support continuing to use the deterministic parser as the user-facing interpreter. Do not enable the model, make quality claims, or replace deterministic handling based on this phase. A future evaluation requires a separately frozen and adjudicated test set, actual model inference and download measurements, named devices and browser versions, and explicit WebGPU/Safari/iOS compatibility testing.
