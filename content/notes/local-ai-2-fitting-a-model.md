---
title: Fitting a model into a browser tab
date: 2026-08-17
topic: local-ai
tags: [on-device, quantisation, webgpu]
stage: growing
series: { id: local-model-in-the-browser, name: A local model in the browser, order: 2 }
lang: en
excerpt: Quantisation, a memory budget and a fallback path. Part two of three.
---
Sample note, replace me.

[[local-ai-1-why-on-device|Part one]] argued for running the model on the device. The first practical obstacle is size: the weights have to travel over the network and then fit in memory next to everything else the tab is doing.

## Quantisation

Weights are usually trained as 32-bit floats. Storing them with fewer bits makes the file smaller at some cost in quality. The numbers below are illustrative for a model with one billion parameters:

| Precision | Bits per weight | Approximate size |
|---|---|---|
| float32 | 32 | 4 GB |
| float16 | 16 | 2 GB |
| 8-bit | 8 | 1 GB |
| 4-bit | 4 | 0.5 GB |

Four bits is a common sweet spot for language models; below that, quality tends to fall off quickly.

## Ask the device first

Never assume a GPU. Check, then choose a model, then fall back:

```ts
async function pickBackend(): Promise<'webgpu' | 'wasm'> {
  const gpu = (navigator as any).gpu;
  if (!gpu) return 'wasm';
  const adapter = await gpu.requestAdapter();
  return adapter ? 'webgpu' : 'wasm';
}
```

On the WebAssembly path, pick a smaller model rather than making the user wait.

## A budget, written down

Decide the budget before choosing the model, not after:

- download: what a visitor will tolerate on their connection;
- memory: well under what a mid-range phone can spare;
- time to first result: seconds, not minutes.

If the model does not fit the budget, the model changes. The budget does not.

Next: [[local-ai-3-shipping-it]].
