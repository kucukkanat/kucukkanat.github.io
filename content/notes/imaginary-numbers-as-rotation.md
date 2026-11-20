---
title: Imaginary numbers are rotations
date: 2026-07-12
topic: maths-and-play
tags: [maths, complex-numbers, games]
stage: seedling
lang: en
excerpt: Multiplying by i is a quarter turn. Once you see that, complex numbers stop being imaginary and become the natural way to spin things on a screen.
---
Sample note, replace me.

No ordinary number squares to minus one, so mathematicians named one that does: *i*. The name "imaginary" has frightened students ever since, which is a pity, because the idea is concrete.

## A quarter turn

Put the ordinary numbers on a horizontal line. Multiplying by minus one flips a number to the other side of zero: a half turn. What operation, done twice, gives a half turn? A quarter turn. That is all *i* is.

So a complex number `a + bi` is a point on a plane, and multiplying two of them adds their angles and multiplies their lengths.

## In a game

To rotate a sprite's direction by a fixed angle each frame, multiply by a unit complex number. No trigonometry inside the loop:

```ts
type C = { re: number; im: number };

const mul = (a: C, b: C): C => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

const step: C = { re: Math.cos(0.05), im: Math.sin(0.05) };
let heading: C = { re: 1, im: 0 };
heading = mul(heading, step); // once per frame
```

## One dimension up

Rotations in three dimensions need four numbers instead of two. Those are quaternions, and every 3D engine uses them for the same reason: they compose cleanly and never lock up.

Seeds to grow here: why the lengths drift after many multiplications, and how to renormalise cheaply.
