// The card catalogue: a small wooden drawer cabinet on the table, one drawer pulled out with index cards standing
// in it and a brass label. Clicking it opens the catalogue spread (book3d.openCatalogue).
import * as THREE from 'three';

export function catalogueDrawer(tableDrop: THREE.Vector3, maps: { wood?: THREE.Texture | null; brass?: THREE.Texture | null } = {}) {
  const group = new THREE.Group();
  group.name = 'CardCatalogue';
  // the room's own painted wood and brass, so it matches the table
  const wood = new THREE.MeshStandardMaterial({ map: maps.wood ?? null, color: maps.wood ? '#ffffff' : '#6b3424', roughness: 0.55, emissive: '#000000' });
  const dark = new THREE.MeshStandardMaterial({ map: maps.wood ?? null, color: maps.wood ? '#7a5a50' : '#3d1d15', roughness: 0.65 });
  const brass = new THREE.MeshStandardMaterial({ map: maps.brass ?? null, color: maps.brass ? '#ffffff' : '#d9a63f', roughness: 0.35, metalness: 0.6 });
  const card = new THREE.MeshStandardMaterial({ color: '#efe2c0', roughness: 0.9, side: THREE.DoubleSide });
  const W = 0.2, H = 0.12, D = 0.16;
  // cabinet with two drawer fronts; the lower one is pulled out
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wood);
  cab.position.y = H / 2;
  group.add(cab);
  const front = (y: number, z: number) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, H / 2 - 0.014, 0.008), dark);
    f.position.set(0, y, z);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.04, 8), brass);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0, y - 0.012, z + 0.008);
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.002), brass);
    label.position.set(0, y + 0.01, z + 0.005);
    group.add(f, handle, label);
  };
  front(H * 0.75, D / 2 + 0.002);
  const pull = 0.09;
  front(H * 0.25, D / 2 + pull);
  // the pulled-out drawer: sides and floor, cards standing in it
  const tray = new THREE.Mesh(new THREE.BoxGeometry(W - 0.024, 0.006, pull), dark);
  tray.position.set(0, 0.012, D / 2 + pull / 2 - 0.004);
  group.add(tray);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.006, H / 2 - 0.02, pull), dark);
    side.position.set(sx * (W / 2 - 0.015), H / 4, D / 2 + pull / 2 - 0.004);
    group.add(side);
  }
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.05, 0.07), card);
    c.position.set(0, 0.05, D / 2 + 0.012 + i * 0.011);
    c.rotation.x = -0.18 - (i % 3) * 0.04;
    group.add(c);
  }
  // a tab card sticking up, as a visual cue
  const tab = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.03), new THREE.MeshStandardMaterial({ color: '#c9473a', side: THREE.DoubleSide }));
  tab.position.set(0.045, 0.094, D / 2 + 0.03);
  tab.rotation.x = -0.2;
  group.add(tab);
  // on the table, to the right of where books are opened, turned a little toward the visitor
  group.position.copy(tableDrop).add(new THREE.Vector3(0.32, 0, -0.18));
  group.rotation.y = -0.35;
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  group.updateMatrixWorld(true);
  let lit = false;
  return {
    group,
    hit(ray: THREE.Raycaster) { return ray.intersectObject(group, true).length > 0; },
    highlight(on: boolean) {
      if (on === lit) return;
      lit = on;
      wood.emissive.set(on ? '#b7862e' : '#000000');
      wood.emissiveIntensity = on ? 0.35 : 0;
    },
  };
}
