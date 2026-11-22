// Procedural skin for an individual whale, layered over the species' painted texture in the fragment shader:
// this individual's tint and countershading, mottling, pale patches, rake scars, barnacle clusters, and the moss
// that creeps down from its island. Evaluated in the whale's rest space (3D noise: no seams, sharp at any distance),
// so it also gives close-up detail the 2k texture cannot.
import * as THREE from 'three';
import type { Genome } from './genome';
import type { IslandInfo } from './ecosystem';

export const SKIN_PARS = /* glsl */`
  uniform vec3 uSkinTint; uniform vec3 uSkinPatch; uniform vec3 uSkinMoss;
  uniform vec4 uSkinA;      // mottle, scars, barnacles, moss
  uniform vec4 uSkinB;      // countershade, patch amount, seed, 1 / length
  uniform vec4 uSkinIsland; // centre z, half length, half width, back height
  float sh31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float sn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(sh31(i), sh31(i + vec3(1, 0, 0)), f.x), mix(sh31(i + vec3(0, 1, 0)), sh31(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(sh31(i + vec3(0, 0, 1)), sh31(i + vec3(1, 0, 1)), f.x), mix(sh31(i + vec3(0, 1, 1)), sh31(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
  float sfbm(vec3 p) { return sn3(p) * 0.5 + sn3(p * 2.03 + 7.1) * 0.3 + sn3(p * 4.1 + 3.7) * 0.2; }
  // albedo in/out; returns roughness
  float skinDetail(vec3 rest, inout vec3 alb) {
    vec3 q = rest * uSkinB.w; float seed = uSkinB.z;
    float top = uSkinIsland.w, low = 1.0 - smoothstep(top - 0.15 / uSkinB.w, top - 0.02 / uSkinB.w, rest.y);
    alb *= uSkinTint;
    alb *= mix(1.0 - uSkinB.x * 0.22, 1.0 + uSkinB.x * 0.3, low);
    // mottling: fine grain and larger pale blotches
    float grain = sfbm(q * 46.0 + seed);
    alb *= 1.0 + (grain - 0.5) * 0.55 * uSkinA.x;
    float blot = smoothstep(0.56, 0.7, sn3(q * 15.0 + seed * 3.1));
    alb = mix(alb, alb * 1.22 + 0.035, blot * uSkinA.x * 0.6);
    // pale patches on the underside
    float pch = smoothstep(0.5, 0.68, sfbm(q * 6.5 + seed * 7.3)) * low;
    alb = mix(alb, uSkinPatch, pch * uSkinB.y * 0.85);
    // rake scars: thin pale lines running mostly along the body
    float region = smoothstep(0.55, 0.75, sn3(q * 4.0 + seed * 5.0));
    float line = abs(sn3(vec3(q.x * 70.0 + q.z * 9.0, q.y * 70.0, q.z * 7.0) + seed * 2.0) - 0.5);
    float scar = (1.0 - smoothstep(0.003, 0.016, line)) * region * uSkinA.y;
    alb = mix(alb, alb * 1.5 + 0.1, scar * 0.7);
    // barnacles: pale crusty dots in clusters, thickest on the head
    vec3 bc = q * 130.0; vec3 bi = floor(bc), bf = fract(bc);
    vec3 centre = vec3(sh31(bi + seed), sh31(bi + 11.0), sh31(bi + 23.0)) * 0.6 + 0.2;
    float dot3 = (1.0 - smoothstep(0.16, 0.3, length(bf - centre)));
    float cluster = smoothstep(0.62, 0.8, sn3(q * 9.0 + seed * 11.0) + smoothstep(0.1, 0.45, q.z) * 0.14) * uSkinA.z;
    float barn = dot3 * cluster;
    alb = mix(alb, vec3(0.84, 0.81, 0.73) * (0.75 + 0.5 * sh31(bi)), barn * 0.9);
    // moss and lichen creeping from the island down the flanks
    float u = (rest.z - uSkinIsland.x) / uSkinIsland.y, v = rest.x / uSkinIsland.z;
    float rn = pow(pow(abs(u), 2.5) + pow(abs(v), 2.5), 0.4);
    float mn = sfbm(q * 30.0 + seed * 1.7);
    float moss = (1.0 - smoothstep(0.96, 1.0 + 0.2 * uSkinA.w, rn + (mn - 0.5) * 0.3)) * smoothstep(top - 0.075 / uSkinB.w, top - 0.03 / uSkinB.w, rest.y);
    alb = mix(alb, uSkinMoss * (0.55 + 0.7 * mn), moss * 0.88);
    return clamp(0.42 + grain * 0.12 + moss * 0.45 + barn * 0.4 + scar * 0.2, 0.2, 1.0);
  }
`;

export interface SkinUniforms {
  [k: string]: THREE.IUniform;
  uSkinTint: { value: THREE.Color }; uSkinPatch: { value: THREE.Color }; uSkinMoss: { value: THREE.Color };
  uSkinA: { value: THREE.Vector4 }; uSkinB: { value: THREE.Vector4 }; uSkinIsland: { value: THREE.Vector4 }; uSkinRest: { value: THREE.Matrix4 };
}

/** The matrix taking the body's (quantised) position attribute to the whale's rest space. */
export function restMatrix(body: THREE.SkinnedMesh, obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  const sk = body.skeleton;
  return new THREE.Matrix4().copy(obj.matrixWorld).invert().multiply(body.matrixWorld).multiply(body.bindMatrixInverse)
    .multiply(sk.bones[0].matrixWorld).multiply(sk.boneInverses[0]).multiply(body.bindMatrix);
}

export function skinUniforms(g: Genome, island: IslandInfo, backY: number, L: number, rest: THREE.Matrix4): SkinUniforms {
  const s = g.skin;
  return {
    uSkinTint: { value: new THREE.Color().setRGB(...s.tint) }, uSkinPatch: { value: new THREE.Color().setRGB(...s.patch) },
    uSkinMoss: { value: new THREE.Color(g.biome.moss) },
    uSkinA: { value: new THREE.Vector4(s.mottle, s.scars, s.barnacles, s.moss) },
    uSkinB: { value: new THREE.Vector4(s.countershade, s.patchAmount, s.seed, 1 / L) },
    uSkinIsland: { value: new THREE.Vector4(island.center[2], island.halfLength, island.halfWidth, backY) },
    uSkinRest: { value: rest },
  };
}

/** Layer the procedural skin onto a three.js lit material (standard / toon). */
export function patchSkin(mat: THREE.Material, U: SkinUniforms) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n uniform mat4 uSkinRest; varying vec3 vSkinRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vSkinRest = (uSkinRest * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec3 vSkinRest; float skinRough;\n${SKIN_PARS}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\n skinRough = skinDetail(vSkinRest, diffuseColor.rgb);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = skinRough;');
  };
  mat.customProgramCacheKey = () => 'whale-skin';
  mat.needsUpdate = true;
}
