// Prints the speed / turn profile of the Outside camera flights (src/flight.ts) without a browser:
//   bun scripts/flight-check.ts
// The keys mirror outside.ts (ship centre approximated); look for peak turn rates and hard braking.
import * as THREE from 'three';
import { Flight, PACE, type Key } from '../src/flight';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const { lerp, radToDeg } = THREE.MathUtils;
const WINDOW = V(0, 1.8, -2.62), ASTERN = V(0, 1.86, -7.5), centre = V(0, 6, 9);
const over = { pos: V(0, 1.65, 2.3), target: V(0, 1.4, -2.6) };
const orbitAt = (y: number, p: number, d: number) => V(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(d).add(centre);

function profile(name: string, f: Flight, dur: number) {
  const p = V(0, 0, 0), t = V(0, 0, 0), pp = V(0, 0, 0), dp = V(0, 0, 0);
  let vMax = 0, wMax = 0, aMax = 0, vPrev = 0;
  const rows: string[] = [];
  const n = Math.round(dur * 60);
  for (let i = 0; i <= n; i++) {
    f.at(f.progress(i / n), p, t);
    const d = t.clone().sub(p).normalize();
    if (i > 0) {
      const v = p.distanceTo(pp) * 60, w = radToDeg(d.angleTo(dp)) * 60, a = (v - vPrev) * 60;
      vMax = Math.max(vMax, v); wMax = Math.max(wMax, w); if (i > 1) aMax = Math.max(aMax, Math.abs(a));
      if (i % 12 === 0) rows.push(`  t=${(i / 60).toFixed(1)} v=${v.toFixed(1).padStart(5)} turn=${w.toFixed(0).padStart(4)} acc=${a.toFixed(1).padStart(6)} z=${p.z.toFixed(2)}`);
      vPrev = v;
    }
    pp.copy(p); dp.copy(d);
  }
  console.log(`== ${name}: ${dur.toFixed(1)}s  peak speed ${vMax.toFixed(1)} m/s  peak turn ${wMax.toFixed(0)} deg/s  peak |accel| ${aMax.toFixed(0)} m/s2`);
  if (process.argv.includes('-v')) console.log(rows.join('\n'));
}

// out (outside.ts goOutside)
{
  const out = orbitAt(2.55, 0.16, 46);
  const mid = out.clone().lerp(ASTERN, 0.35).setY(lerp(ASTERN.y, out.y, 0.5));
  const side = ASTERN.clone().lerp(mid, 0.45).setY(lerp(ASTERN.y, mid.y, 0.3));
  const keys: Key[] = [
    { p: over.pos.clone(), t: over.target.clone() },
    { p: V(0.42, 1.86, 0.4), t: V(0.15, 1.76, -5) },
    { p: V(0.12, 1.82, -1.5), t: V(0.04, 1.74, -9) },
    { p: WINDOW.clone(), t: V(0, 1.74, -12) },
    { p: ASTERN.clone(), t: ASTERN.clone().add(V(-0.35, 0, -0.94)) },
    { p: side, t: side.clone().add(V(-0.9, 0.05, -0.42)) },
    { p: mid, t: centre.clone() },
    { p: out, t: centre.clone() },
  ];
  { const f = new Flight(keys, WINDOW, PACE.out.grow, false, PACE.out.turn); profile('out', f, f.duration); };
}
// back (goInside, from the default orbit)
{
  const y0 = 2.55, yA = -2.97, wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)), dy = wrap(yA - y0);
  const n = Math.max(1, Math.ceil(Math.abs(dy) / 0.5));
  const keys: Key[] = [{ p: orbitAt(y0, 0.16, 46), t: centre.clone() }];
  for (let i = 1; i <= n; i++) { const k = i / n, e = k * k * (3 - 2 * k); keys.push({ p: orbitAt(y0 + dy * k, lerp(0.16, -0.042, e), lerp(46, 35.5, e)), t: centre.clone() }); }
  const far = keys[keys.length - 1].p, into = V(0, 1.7, 2);
  keys.push(
    { p: far.clone().lerp(ASTERN, 0.6).setY(lerp(far.y, ASTERN.y, 0.75)), t: centre.clone().lerp(into, 0.1) },
    { p: ASTERN.clone(), t: centre.clone().lerp(into, 0.8) },
    { p: WINDOW.clone(), t: V(0, 1.75, 1.6) },
    { p: V(0.1, 1.98, -1.6), t: V(2.5, 1.62, 1.2) },
    { p: V(0.5, 1.92, 0.5), t: V(2.4, 1.5, -2.6) },
    { p: over.pos.clone(), t: over.target.clone() },
  );
  { const f = new Flight(keys, WINDOW, PACE.back.grow, true, PACE.back.turn); profile('back', f, f.duration); };
}
