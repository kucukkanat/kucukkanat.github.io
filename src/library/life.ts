// A living room: the books answer the visitor's typing with a glow, his eyes follow what the visitor looks at,
// he glances around when nothing happens, and left alone for a while he goes to straighten a shelf.
import * as THREE from 'three';
import type { Topic } from './types';
import type { Librarian } from './librarian';
import { uNight } from './time';

/** The library deck's named nodes. */
export interface Room { get(name: string): THREE.Object3D | undefined }

const GOLD = new THREE.Color('#c8902e');

export interface LifeInput {
  hovered: string | null;            // topic under the mouse
  typing: string;                    // what the visitor is typing (empty when the box is empty)
  reading: THREE.Vector3 | null;     // the open book, when reading
  quiet: boolean;                    // nothing going on: no reply, no fetch, no reading
}

export function setupLife(scene: THREE.Object3D, room: Room, lib: Librarian, topics: Topic[], match: (t: string) => Topic | null) {
  // per topic book: its materials, the centre of its spine, a current glow
  const books = topics.flatMap(t => {
    const node = room.get(`Book_${t.id}`);
    if (!node) return [];
    const mats: THREE.MeshStandardMaterial[] = [];
    const box = new THREE.Box3();
    node.updateWorldMatrix(true, true);
    node.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      box.expandByObject(m);
      for (const mat of ([] as THREE.Material[]).concat(m.material)) if ((mat as THREE.MeshStandardMaterial).emissive) mats.push(mat as THREE.MeshStandardMaterial);
    });
    const spine = box.getCenter(new THREE.Vector3());
    spine.z = box.max.z;                          // the face toward the room
    return [{ id: t.id, node, mats, spine, glow: 0, reach: (node.userData.reach as string) ?? 'mid' }];
  });

  // a soft halo in front of the glowing spine (the shelves are baked, so a real light would not show on them)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(), color: '#ffc46a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
  }));
  halo.scale.set(0.34, 0.5, 1);
  halo.renderOrder = 4;
  halo.visible = false;
  scene.add(halo);

  let matched: string | null = null, matchedAt = -99;
  let hoverSince = 0, lastHover: string | null = null;
  let glance: { at: THREE.Vector3; until: number } | null = null, nextGlance = 5;
  let quietFor = 0, nextErrand = 25 + Math.random() * 15;
  let time = 0;
  // books he is pointing the visitor to (no exact match, or the first-visit tour), and the occasional glint that
  // teaches the eye where the real books are
  let suggested = new Set<string>(), suggestUntil = 0;
  let glint: { id: string; at: number } | null = null, nextGlint = 3;
  let pointLook: { at: THREE.Vector3; until: number } | null = null;
  const glanceSpots = () => {
    const spots = [
      room.get('Table_drop')?.getWorldPosition(new THREE.Vector3()),
      new THREE.Vector3(2.6, 1.5, -1.2), new THREE.Vector3(2.6, 1.5, 0.9),         // the portholes
      new THREE.Vector3(0.35, 2.6, 0.6),                                           // the hanging lantern
    ].filter(Boolean) as THREE.Vector3[];
    return spots.concat(books.map(b => b.spine));
  };

  return {
    /** The book that answers the visitor's words, if any. */
    get matched() { return matched; },
    update(dt: number, inp: LifeInput) {
      time += dt;
      // --- glow: the matching book pulses while the visitor types, a hovered book lights up
      const m = inp.typing.trim() ? match(inp.typing)?.id ?? null : null;
      if (m !== matched) { matched = m; matchedAt = time; }
      let brightest: (typeof books)[number] | null = null;
      if (time > suggestUntil) suggested.clear();
      if (!glint && time > nextGlint && inp.quiet && !inp.typing && !suggested.size) {
        const pool = books.filter(b => b.node.visible && b.glow < 0.01);
        if (pool.length) glint = { id: pool[Math.floor(Math.random() * pool.length)].id, at: time };
        nextGlint = time + 3.5 + Math.random() * 3;
      }
      if (glint && time - glint.at > 0.9) glint = null;
      for (const b of books) {
        const sug = suggested.has(b.id) ? 0.32 + 0.16 * Math.sin(time * 2.6 + b.spine.x * 3) : 0;
        const gl = glint?.id === b.id ? 0.55 * Math.sin(Math.PI * (time - glint.at) / 0.9) : 0;
        const target = Math.max(b.id === inp.hovered ? 0.5 : 0, b.id === matched ? 0.42 + 0.2 * Math.sin(time * 3.2) : 0, sug, gl);
        b.glow += (target - b.glow) * (1 - Math.exp(-dt * (gl > 0 ? 14 : 6)));
        if (b.glow < 0.002 && target === 0) b.glow = 0;
        for (const mat of b.mats) { mat.emissive.copy(GOLD); mat.emissiveIntensity = b.glow; }
        if (b.node.visible && (!brightest || b.glow > brightest.glow)) brightest = b;
      }
      halo.visible = !!brightest && brightest.glow > 0.01 && !inp.reading;
      if (halo.visible && brightest) {
        halo.position.copy(brightest.spine).add(new THREE.Vector3(0, 0, 0.04));
        halo.material.opacity = brightest.glow * (0.3 + 0.35 * uNight.value);
      }

      // --- gaze: the open book, a hovered book (after a beat), the book he just recognised, a glance, or you
      if (inp.hovered !== lastHover) { lastHover = inp.hovered; hoverSince = time; }
      const hoveredBook = books.find(b => b.id === inp.hovered);
      const matchedBook = books.find(b => b.id === matched);
      let at: THREE.Vector3 | null = null;
      if (inp.reading) at = inp.reading;
      else if (hoveredBook && time - hoverSince > 0.35) at = hoveredBook.spine;
      else if (matchedBook && time - matchedAt < 1.4) at = matchedBook.spine;
      else if (pointLook && time < pointLook.until) at = pointLook.at;
      else if (inp.quiet && !inp.typing) {
        if (glance && time > glance.until) glance = null;
        if (!glance && time > nextGlance) {
          nextGlance = time + 4 + Math.random() * 6;
          if (Math.random() < 0.5) {
            const spots = glanceSpots();
            glance = { at: spots[Math.floor(Math.random() * spots.length)], until: time + 1.2 + Math.random() * 1.2 };
          }
        }
        at = glance?.at ?? null;
      }
      if (!inp.quiet || inp.typing) glance = null;
      lib.attention = at;

      // --- errands: left alone long enough, he straightens a book on a shelf he can reach from the floor
      const alone = inp.quiet && !inp.typing && !inp.hovered && !lib.onErrand && lib.state === 'idle' && !lib.speaking;
      quietFor = alone ? quietFor + dt : 0;
      if (quietFor > nextErrand) {
        quietFor = 0;
        nextErrand = 30 + Math.random() * 25;
        const mid = books.filter(b => b.reach === 'mid' && b.node.visible);
        const b = mid[Math.floor(Math.random() * mid.length)];
        if (b) {
          // a neighbour of a topic book, not the topic book itself
          const spot = b.spine.clone().add(new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.12), 0.02, 0));
          void lib.tidy(spot);
        }
      }
    },
    /** Light up these books for a while (his suggestions); he glances at the first. */
    suggest(ids: string[], seconds = 10) {
      suggested = new Set(ids);
      suggestUntil = time + seconds;
      const first = books.find(b => b.id === ids[0]);
      if (first) pointLook = { at: first.spine, until: time + 1.8 };
    },
    /** Visitor did something: no errand for a while (and stop one under way). */
    poke() { quietFor = 0; void lib.interrupt(); },
  };
}

function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.25)');
  grad.addColorStop(0.65, 'rgba(255,255,255,0.07)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
