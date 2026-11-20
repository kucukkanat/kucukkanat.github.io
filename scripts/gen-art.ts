// Generate images through OpenRouter from a JSON spec.
// Key: OPENROUTER_API_KEY or the file in OPENROUTER_KEY_FILE (default ~/.config/openrouter/key). Never commit it.
// Usage: bun scripts/gen-art.ts <spec.json> [id ...]
// spec: { "style": "...", "out": "art/textures", "aspect": "1:1", "jobs": [{ "id": "wood", "prompt": "...", "aspect"?: "16:9", "ref"?: "path.png" }] }
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const MODEL = process.env.OPENROUTER_IMAGE_MODEL ?? 'openai/gpt-5.4-image-2';
const keyFile = process.env.OPENROUTER_KEY_FILE ?? join(homedir(), '.config/openrouter/key');
const key = process.env.OPENROUTER_API_KEY ?? readFileSync(keyFile, 'utf8').trim();

const [specPath, ...only] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const root = join(import.meta.dir, '..');
const outDir = join(root, spec.out);
mkdirSync(outDir, { recursive: true });
const force = process.env.FORCE === '1';

async function one(job: any): Promise<number> {
  const out = join(outDir, `${job.id}.png`);
  if (existsSync(out) && !force) { console.log(`${job.id}: exists, skip`); return 0; }
  const text = `${spec.style}\n\n${job.prompt}`;
  const content: any[] = [{ type: 'text', text }];
  if (job.ref) content.push({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + readFileSync(join(root, job.ref)).toString('base64') } });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'personal-site-art' },
        body: JSON.stringify({ model: MODEL, modalities: ['image', 'text'], messages: [{ role: 'user', content }],
          image_config: { aspect_ratio: job.aspect ?? spec.aspect ?? '1:1' } }),
      });
      const data: any = await res.json();
      const url = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!url) throw new Error(JSON.stringify(data).slice(0, 200));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
      const cost = data.usage?.cost ?? 0;
      console.log(`${job.id}: ok ($${cost.toFixed(3)})`);
      return cost;
    } catch (e) { console.log(`${job.id}: attempt ${attempt} failed: ${(e as Error).message}`); }
  }
  return 0;
}

const jobs = spec.jobs.filter((j: any) => !only.length || only.includes(j.id));
const queue = [...jobs]; let total = 0;
await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
  while (queue.length) { const cost = await one(queue.shift()); total += cost; }
}));
console.log(`total $${total.toFixed(2)}`);
