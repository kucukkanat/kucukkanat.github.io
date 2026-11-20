---
title: Why run the model on the device
date: 2026-08-03
updated: 2026-09-01
topic: local-ai
tags: [on-device, privacy, webgpu]
stage: evergreen
series: { id: local-model-in-the-browser, name: A local model in the browser, order: 1 }
lang: en
excerpt: Running a model on the user's own device removes the server, the bill and the privacy question in one move. Part one of three.
---
Sample note, replace me.

Most AI features are a text box wired to somebody else's data centre. That is a fine place to start, and a strange place to stop. A laptop or a phone bought in the last few years can run a useful model by itself.

## What you gain

- **Privacy by construction.** The text never leaves the device, so there is nothing to promise and nothing to leak.
- **No bill per request.** The user brings the hardware. A hobby project can stay free for ever.
- **It works offline.** On a train, on a plane, in a cabin.
- **Latency you control.** No queue, no cold start on someone else's cluster.

## What you give up

The largest models do not fit, and the ones that do are less capable. The first visit includes a large download. Devices differ wildly, so the same page can be instant on one machine and unusable on another.

## When it is the right choice

Local models shine at narrow, well-defined jobs: transcribing speech, embedding text for search, classifying, summarising a page the user is already looking at. They struggle when the task needs broad knowledge or long reasoning.

A good test: would the feature still be worth having if it were only ninety percent as good, but private and free? If so, run it locally.

Next: [[local-ai-2-fitting-a-model]] looks at getting a model small enough to download, and [[local-ai-3-shipping-it]] at the unglamorous parts of putting it in front of people. There is a shorter Turkish take in [[cihazda-yapay-zeka]].
