---
title: Shipping a local model to real people
date: 2026-09-21
topic: local-ai
tags: [on-device, caching, ux]
stage: seedling
series: { id: local-model-in-the-browser, name: A local model in the browser, order: 3 }
lang: en
excerpt: Caching the weights, showing honest progress and keeping the page alive while the model thinks. Part three of three.
---
Sample note, replace me.

A demo works on the author's laptop. A product works on a stranger's phone, on hotel Wi-Fi, the second time they visit. This last part of the series that began with [[Why run the model on the device]] is a checklist for that gap.

## Download once

Store the weights in the Cache API so the second visit is instant:

```ts
async function fetchCached(url: string): Promise<Response> {
  const cache = await caches.open('models-v1');
  const hit = await cache.match(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (res.ok) await cache.put(url, res.clone());
  return res;
}
```

Put a version in the cache name. When the model changes, delete the old cache instead of leaving a gigabyte behind.

## Be honest about the wait

Show the size before the download starts and let the user decide. Show real progress in megabytes, not a spinner. If the device cannot run the model, say so plainly and offer the smaller one from [[local-ai-2-fitting-a-model|part two]].

## Stay off the main thread

Run inference in a Web Worker. A page that freezes while it thinks feels broken, even when it is fast. Stream partial results back so there is something to read within the first second.

## Still to write

- Measuring quality after quantisation without a test lab.
- What to do when the tab is in the background and the browser reclaims the GPU.
