// Dust motes drifting in the sun shafts from the stern windows. Sunset only; they fade at night and in a storm.
import * as THREE from 'three';
import { seeded } from './labels';
import { uNight, uStorm, uTime } from './lighting';

export function setupDust(scene: THREE.Scene, opts: { count?: number; pixelRatio: number }) {
  const count = opts.count ?? 220;
  const rnd = seeded('dust');
  // light from the low sun, through the windows (z ≈ −2.4), slanting down into the cabin
  const dir = new THREE.Vector3(1.9, -2.0, 5.8).normalize();
  const panes = [-1.35, -0.68, 0, 0.68, 1.35];
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const alpha = new Float32Array(count);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 8; tries++) {
      const pane = panes[Math.floor(rnd() * panes.length)];
      p.set(pane + (rnd() - 0.5) * 0.45, 1.05 + rnd() * 1.4, -2.3);
      const s = 0.1 + Math.pow(rnd(), 0.8) * 2.6;
      p.addScaledVector(dir, s);
      p.x += (rnd() - 0.5) * 0.08; p.y += (rnd() - 0.5) * 0.08;
      if (p.y > 0.3 && p.y < 2.6) break;
    }
    pos.set([p.x, p.y, p.z], i * 3);
    seed[i] = rnd();
    // brightest near the glass, fading as the shaft spreads
    alpha[i] = THREE.MathUtils.clamp(1.1 - (p.z + 2.3) / 2.8, 0.15, 1) * (0.5 + rnd() * 0.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime, uNight, uStorm, uScale: { value: 0.065 * opts.pixelRatio } },
    vertexShader: /* glsl */`
      attribute float aSeed; attribute float aAlpha;
      uniform float uTime; uniform float uScale;
      varying float vA;
      void main() {
        vec3 p = position;
        float s = aSeed * 6.2831;
        p.x += sin(uTime * 0.11 + s) * 0.05 + sin(uTime * 0.31 + s * 3.0) * 0.012;
        p.y += sin(uTime * 0.08 + s * 2.0) * 0.06;
        p.z += cos(uTime * 0.09 + s) * 0.04;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.6 + aSeed) * 300.0 / -mv.z;
        vA = aAlpha * (0.6 + 0.4 * sin(uTime * (0.7 + aSeed) + s * 5.0));
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight; uniform float uStorm;
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        float a = smoothstep(0.5, 0.0, r);
        a *= a;
        float vis = (1.0 - uNight) * (1.0 - uStorm);
        gl_FragColor = vec4(vec3(1.0, 0.86, 0.64) * a * vA * vis * 1.1, 1.0);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  points.name = 'DustMotes';
  scene.add(points);
  return {
    points,
    update() { points.visible = uNight.value < 0.99 && uStorm.value < 0.99; },
  };
}
