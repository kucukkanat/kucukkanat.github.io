// Night life: a few moths circling each lantern, fading in after dark. Wings are two quads that flap.
import * as THREE from 'three';
import { uNight, uTime } from './time';

/** Lantern centres; the hanging one moves with the ship (update(hanging)). */
const LANTERNS = [new THREE.Vector3(-0.15, 0.97, 0.57), new THREE.Vector3(0.35, 2.67, 0.6)];

export function setupMoths(scene: THREE.Object3D, opts: { lite: boolean }) {
  const per = opts.lite ? 2 : 3;
  const wing = new THREE.BufferGeometry();
  // one wing: a rounded triangle from the body outwards (+X); the other is mirrored by scale
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.004, 0.022, 0, 0.012, 0.018, 0, -0.012, 0, 0, -0.008], 3));
  wing.setIndex([0, 1, 2, 0, 2, 3]);
  wing.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: '#d9c7a4', side: THREE.DoubleSide, transparent: true, opacity: 0 });
  const moths = LANTERNS.flatMap((c, li) => Array.from({ length: per }, (_, i) => {
    const g = new THREE.Group();
    const l = new THREE.Mesh(wing, mat), r = new THREE.Mesh(wing, mat);
    r.scale.x = -1;
    g.add(l, r);
    g.visible = false;
    scene.add(g);
    const seed = li * 10 + i * 2.37;
    return { g, l, r, c, seed, rad: 0.09 + 0.05 * ((i * 0.618) % 1) + li * 0.04, speed: (1.6 + (i % 3) * 0.5) * (i % 2 ? 1 : -1) };
  }));
  const prev = new THREE.Vector3();
  return {
    update(hanging?: THREE.Vector3) {
      if (hanging) LANTERNS[1].copy(hanging).add(new THREE.Vector3(0, 0.02, 0));
      const on = THREE.MathUtils.smoothstep(uNight.value, 0.3, 0.8);
      mat.opacity = on * 0.85;
      const t = uTime.value;
      for (const m of moths) {
        m.g.visible = on > 0.01;
        if (!m.g.visible) continue;
        // a wobbly orbit with sudden darts toward the flame and back
        const a = t * m.speed + m.seed;
        const dart = Math.pow(Math.max(0, Math.sin(t * 0.9 + m.seed * 3)), 12);
        const r = m.rad * (1 - 0.7 * dart) + 0.02 * Math.sin(t * 7 + m.seed);
        prev.copy(m.g.position);
        m.g.position.set(m.c.x + Math.cos(a) * r, m.c.y + 0.03 * Math.sin(t * 2.3 + m.seed) + 0.05 * Math.sin(a * 0.5), m.c.z + Math.sin(a) * r);
        // face along the path, wings flapping fast
        const dir = m.g.position.clone().sub(prev);
        if (dir.lengthSq() > 1e-8) m.g.rotation.y = Math.atan2(dir.x, dir.z);
        const flap = Math.sin(t * 38 + m.seed) * 0.9;
        m.l.rotation.z = flap;
        m.r.rotation.z = -flap;
      }
    },
  };
}
