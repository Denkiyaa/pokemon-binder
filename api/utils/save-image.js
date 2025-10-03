// api/utils/save-image.js
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import fetch from 'node-fetch';

export async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true }).catch(() => {});
}

export async function saveToLocal(url, rootDir) {
  const key = crypto.createHash('md5').update(url).digest('hex');
  const sub = path.join(rootDir, key.slice(0, 2));
  await ensureDir(sub);
  const fp = path.join(sub, `${key}.jpg`);

  try { await fs.access(fp); return { key, fp }; } catch {}

  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.pricecharting.com/'
    }
  });
  if (!r.ok) throw new Error(`img ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(fp, buf);
  return { key, fp };
}
