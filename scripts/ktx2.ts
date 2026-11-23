// KTX2 / Basis Universal textures: 4–8x less GPU memory than PNG/WebP/JPEG, which the GPU holds uncompressed.
// Encoder: the `ktx2-encoder` devDependency (Basis Universal compiled to WASM), so no system install is needed.
//
//   bun scripts/ktx2.ts            lightmaps (2k + 1k) and sky backdrops → public/assets/*.ktx2, + lightmaps.json means
//   import { ktx2Textures } from './ktx2'   the glTF Transform pass used by compress-glb.ts, build-captain.ts, whales/scripts/web.ts
//
// Choices (see README "Textures"): everything is ETC1S, the small-download Basis mode (the GPU gets ETC1/ETC2 on phones,
// BC1/BC7 on desktop: 4–8 bpp instead of 32). UASTC (+RDO +Zstandard) was tried for the lightmaps and the normal maps:
// 4–6x the download (a 1k lightmap: 760–950 KB vs 183 KB) with no visible difference in the scene.
//  - colour / painted maps, sky backdrops, lightmaps: quality 192 (sRGB); fine wood grain (FINE): 255, slower encoder.
//  - normal maps: quality 255, normal-map mode, linear.  metallic/roughness/occlusion: stay WebP (see ktx2Textures).
//  - maps under half of 512² stay WebP: as KTX2 they would download 2x+ bigger for <0.35 MB of GPU memory each.
//  Sizes are rounded to multiples of 4 (resized, not padded, so UVs still line up); mipmaps are generated.
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';
import { Document, NodeIO, type Texture, type Transform } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type Kind = 'color' | 'linear' | 'normal';
/** Maps smaller than half of 512² stay WebP: as KTX2 they download 2x+ bigger and use under 0.35 MB of GPU memory as WebP. */
export const MIN_PIXELS = 512 * 512 / 2;
const big = (size: [number, number] | null): size is [number, number] => !!size && size[0] * size[1] >= MIN_PIXELS;
const ETC1S_QUALITY = 192;
/** Normal maps: the full codebook (a few KB more; keeps the shading of the smooth whale skin free of banding). */
const NORMAL_QUALITY = 255;
const SMOOTH_QUALITY = ETC1S_QUALITY;
/** Fine-grained painted wood: ETC1S at quality 192 smears the grain into 4×4 blocks. The full codebook and a slower
 *  encoder keep it (about +20% on these maps, still a fraction of UASTC). Matched on the texture name or URI. */
const FINE = /wood|planks|mahogany/i;
const FINE_QUALITY = 255, FINE_LEVEL = 4;

/** Encode one image (any format sharp reads) to KTX2. flipY: for images three.js would load with flipY = true. */
export async function encodeImage(src: Uint8Array, kind: Kind, { flipY = false, quality = ETC1S_QUALITY, level = 2 } = {}): Promise<Uint8Array> {
  const meta = await sharp(src).metadata();
  const w = Math.ceil(meta.width! / 4) * 4, h = Math.ceil(meta.height! / 4) * 4;
  let img = sharp(src).ensureAlpha();
  if (w !== meta.width || h !== meta.height) img = img.resize(w, h, { fit: 'fill', kernel: 'lanczos3' });
  if (flipY) img = img.flip();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const imageDecoder = async () => ({ data: new Uint8Array(data), width: info.width, height: info.height });
  const srgb = kind === 'color';
  return encodeToKTX2(src, {
    imageDecoder, isUASTC: false, generateMipmap: true, compressionLevel: level,
    isPerceptual: srgb, isSetKTX2SRGBTransferFunc: srgb, isNormalMap: kind === 'normal',
    qualityLevel: kind === 'normal' ? NORMAL_QUALITY : quality,
  });
}

// The Basis encoder prints its progress through console.log (bound when it first runs); keep the build log readable.
const NOISE = /^(Slice|Total slices|Mode:|basis_compressor|Encoding slice|Comp |ETC1S|UASTC)/;
const log0 = console.log.bind(console);
console.log = (...a: unknown[]) => { if (!(typeof a[0] === 'string' && NOISE.test(a[0]))) log0(...a); };

function kindOf(doc: Document, tex: Texture): Kind {
  const slots = doc.getGraph().listParentEdges(tex).map(e => e.getName());
  if (slots.some(s => /normal/i.test(s))) return 'normal';
  if (slots.some(s => /baseColor|emissive|diffuse|specularColor|sheenColor/i.test(s))) return 'color';
  return 'linear';
}

/** glTF Transform pass: textures of MIN_PIXELS and up → KTX2 (KHR_texture_basisu); smaller ones are left as they are. */
export function ktx2Textures({ log = console.log }: { log?: (s: string) => void } = {}): Transform {
  return async (doc: Document) => {
    let any = false;
    for (const tex of doc.getRoot().listTextures()) {
      if (tex.getMimeType() === 'image/ktx2') { any = true; continue; }
      const size = tex.getSize();
      const name = tex.getName() || tex.getURI() || '(texture)';
      if (!big(size)) { log(`  ${name} ${tex.getSize()?.join('x')}: kept as ${tex.getMimeType()}`); continue; }
      const kind = kindOf(doc, tex);
      // Data maps whose channels mean different things (metallic/roughness/occlusion) stay WebP: ETC1S shares one colour
      // per 4×4 block, so metalness bleeds into roughness (the captain turned darker); UASTC keeps them apart but is
      // ~12x the download (615–695 KB for a 1024² map vs 53 KB).
      if (kind === 'linear') { log(`  ${name} ${size.join('x')}: data map, kept as ${tex.getMimeType()}`); continue; }
      const before = tex.getImage()!.byteLength;
      const fine = kind === 'color' && FINE.test(name);
      tex.setImage(await encodeImage(tex.getImage()!, kind, fine ? { quality: FINE_QUALITY, level: FINE_LEVEL } : {})).setMimeType('image/ktx2');
      if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.\w+$/, '.ktx2'));
      log(`  ${name} ${size.join('x')} ${kind}${fine ? ' (fine)' : ''}: ${kb(before)} → ${kb(tex.getImage()!.byteLength)}`);
      any = true;
    }
    if (any) doc.createExtension(KHRTextureBasisu).setRequired(true);
    // no WebP left → drop EXT_texture_webp
    if (!doc.getRoot().listTextures().some(t => t.getMimeType() === 'image/webp'))
      doc.getRoot().listExtensionsUsed().find(e => e.extensionName === 'EXT_texture_webp')?.dispose();
  };
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

let io: NodeIO | null = null;
export async function glbIO() {
  if (io) return io;
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/** Re-encode a .glb's textures in place. Meshopt-compressed files stay so (same filter mode as `--level high`). */
export async function ktx2GLB(path: string) {
  const io = await glbIO();
  const doc = await io.read(path);
  if (!doc.getRoot().listTextures().some(t => t.getMimeType() !== 'image/ktx2' && big(t.getSize()) && kindOf(doc, t) !== 'linear')) {
    console.log(`${path.split('/').pop()}: textures already KTX2 or small`);
    return;
  }
  const before = statSync(path).size;
  (doc.getRoot().listExtensionsUsed().find(e => e.extensionName === 'EXT_meshopt_compression') as EXTMeshoptCompression | undefined)
    ?.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  console.log(`${path.split('/').pop()}:`);
  await doc.transform(ktx2Textures());
  await io.write(path, doc);
  console.log(`  → ${kb(before)} → ${kb(statSync(path).size)}`);
}

// ---------------------------------------------------------------- plain images (lightmaps, sky backdrops)

/** Mean luminance of the lit texels, as src/lighting.ts used to measure it from the image (64×64, texels > 0.02). */
async function meanLit(src: Buffer) {
  const d = await sharp(src).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 3) {
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    if (l > 0.02) { sum += l; n++; }
  }
  return n ? +(sum / n).toFixed(4) : 0.5;
}

async function images() {
  const dir = join(import.meta.dir, '..', 'public', 'assets');
  const write = async (name: string, src: Buffer, flipY = false) => {
    const out = await encodeImage(src, 'color', { flipY, quality: SMOOTH_QUALITY });
    writeFileSync(join(dir, name), out);
    console.log(`${name}: ${kb(out.byteLength)}`);
  };
  // Lightmaps: the bake writes lightmap_<mode>.webp (2048²); phones get a 1024² copy. Not flipped: three.js loads glTF-style
  // lightmaps with flipY = false. The mean brightness goes to lightmaps.json (lighting.ts can't read a compressed texture).
  const meta = JSON.parse(readFileSync(join(dir, 'lightmaps.json'), 'utf8'));
  for (const mode of ['sunset', 'night']) {
    const src = readFileSync(join(dir, `lightmap_${mode}.webp`));
    await write(`lightmap_${mode}.ktx2`, src);
    await write(`lightmap_${mode}_1k.ktx2`, await sharp(src).resize(1024, 1024, { kernel: 'lanczos3' }).png().toBuffer());
    meta[mode] = { ...meta[mode], mean: await meanLit(src) };
  }
  writeFileSync(join(dir, 'lightmaps.json'), JSON.stringify(meta, null, 1));
  // Sky backdrops (art/sky → public/assets/sky_*.jpg): flipped, since TextureLoader images are flipped at upload.
  for (const s of ['sunset', 'night', 'storm']) {
    const p = join(dir, `sky_${s}.jpg`);
    if (existsSync(p)) await write(`sky_${s}.ktx2`, readFileSync(p), true);
  }
}

if (import.meta.main) await images();
