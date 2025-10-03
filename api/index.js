// api/index.js
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { fetchCollection } from './scraper.js';
import dotenv from 'dotenv';
import { masterSlug } from './utils/slug.js';
import { candidatesForHigher } from './utils/img-candidate.js';
import { saveToLocal, ensureDir } from './utils/save-image.js';

dotenv.config();

// ------------------------------------------------------------------
// Paths (ÖNCE DB_DIR, sonra türevleri)
// ------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DB_DIR = path.join(__dirname, 'data');
const IMG_DIR = path.join(DB_DIR, 'imgcache');             // proxy cache
const IMG_MASTER_DIR = path.join(DB_DIR, 'imgcache_master'); // yüksek çözünürlük cache

await fs.mkdir(DB_DIR, { recursive: true }).catch(() => {});
await fs.mkdir(IMG_DIR, { recursive: true }).catch(() => {});
await ensureDir(IMG_MASTER_DIR); // util fonksiyonu

// JSON dosyaları (inbox/binder)
const pInbox  = (pid)    => path.join(DB_DIR, `inbox-${pid}.json`);
const pBinder = (p, b)   => path.join(DB_DIR, `binder-${p}-${b}.json`);

const readJSON  = async (p, fb) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fb; } };
const writeJSON = (p, v) => fs.writeFile(p, JSON.stringify(v, null, 2), 'utf8');

const cardKey = (c) => (c?.pc_item_id || c?.pc_url || '') + '|' + (c?.price_value ?? '');
const dedupCards = (arr = []) => {
  const seen = new Set(); const out = [];
  for (const it of arr) {
    const k = cardKey(it);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
};

// ------------------------------------------------------------------
// MariaDB (profiles + master katalog)
// ------------------------------------------------------------------
const pool = await mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306), 
  user: process.env.DB_USER || 'binderapp',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'pokemon_binder',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z'
});

// Tabloları garantiye al
await pool.query(`
  CREATE TABLE IF NOT EXISTS profiles (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`);
await pool.query(`INSERT IGNORE INTO profiles (id,name) VALUES ('default','default')`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS cards_master (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    slug VARCHAR(255) NOT NULL UNIQUE,
    name TEXT NULL,
    set_name TEXT NULL,
    collector_no VARCHAR(64) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS cards_sources (
    source VARCHAR(64) NOT NULL,
    source_key VARCHAR(255) NOT NULL,
    master_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (source, source_key),
    KEY idx_master (master_id),
    CONSTRAINT fk_sources_master FOREIGN KEY (master_id)
      REFERENCES cards_master(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS images (
    master_id BIGINT UNSIGNED NOT NULL,
    quality_tag VARCHAR(16) NOT NULL, -- '1000','600','300','180','60','orig'
    source_url TEXT NOT NULL,
    local_path TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (master_id, quality_tag),
    KEY idx_master (master_id),
    CONSTRAINT fk_images_master FOREIGN KEY (master_id)
      REFERENCES cards_master(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`);

// DB helpers
async function listProfiles() {
  const [rows] = await pool.query(`SELECT id, name FROM profiles ORDER BY name`);
  return rows;
}

async function createProfile(name = 'profile') {
  const base = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '') || 'profile';
  let id = base, n = 1;
  // benzersiz yap
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pool.query(`INSERT INTO profiles (id, name) VALUES (?, ?)`, [id, name]);
      break;
    } catch (e) {
      if (e?.code === 'ER_DUP_ENTRY') { id = `${base}-${n++}`; continue; }
      throw e;
    }
  }
  return { id, name };
}

function qualityTagFromUrl(u = '') {
  if (/\/1000\./i.test(u)) return '1000';
  if (/\/600\./i.test(u))  return '600';
  if (/\/300\./i.test(u))  return '300';
  if (/\/180\./i.test(u))  return '180';
  if (/\/60\./i.test(u))   return '60';
  return 'orig';
}

async function upsertMasterCard(card) {
  const slug = masterSlug({
    set_name: card.set_name,
    collector_number: card.collector_number,
    name: card.name
  });

  const [rows] = await pool.query(`SELECT id FROM cards_master WHERE slug=?`, [slug]);
  let id = rows?.[0]?.id;

  if (!id) {
    const [r2] = await pool.query(
      `INSERT INTO cards_master (slug,name,set_name,collector_no) VALUES (?,?,?,?)`,
      [slug, card.name || null, card.set_name || null, card.collector_number || null]
    );
    id = r2.insertId;
  } else {
    await pool.query(
      `UPDATE cards_master SET name=?, set_name=?, collector_no=? WHERE id=?`,
      [card.name || null, card.set_name || null, card.collector_number || null, id]
    );
  }

  const source_key = card.pc_item_id || card.pc_url || '';
  if (source_key) {
    await pool.query(
      `INSERT IGNORE INTO cards_sources (source, source_key, master_id) VALUES (?,?,?)`,
      ['pricecharting', source_key, id]
    );
  }
  return id;
}

async function ensureHiResImage(masterId, baseUrl) {
  const list = candidatesForHigher(baseUrl);
  for (const u of list) {
    try {
      const { fp } = await saveToLocal(u, IMG_MASTER_DIR);
      const tag = qualityTagFromUrl(u);
      await pool.query(
        `INSERT INTO images (master_id,quality_tag,source_url,local_path)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE source_url=VALUES(source_url), local_path=VALUES(local_path)`,
        [masterId, tag, u, fp]
      );
      return { tag, local_path: fp };
    } catch {
      // devam et, diğer varyantı dene
    }
  }
  // hi-res bulunamadı; en azından base'i kaydet
  try {
    const { fp } = await saveToLocal(baseUrl, IMG_MASTER_DIR);
    await pool.query(
      `INSERT INTO images (master_id,quality_tag,source_url,local_path)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE local_path=VALUES(local_path)`,
      [masterId, qualityTagFromUrl(baseUrl), baseUrl, fp]
    );
  } catch {}
  return null;
}

// ------------------------------------------------------------------
// Express
// ------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// ---- API router (/api) ----
const api = express.Router();

// health
api.get('/health', (_req, res) => res.json({ ok: true }));

// profiles (DB)
api.get('/profiles', async (_req, res) => {
  try { res.json(await listProfiles()); }
  catch (e) { console.error('[profiles][get]', e); res.status(500).json({ error: 'profiles get failed' }); }
});
api.post('/profiles', async (req, res) => {
  try {
    const name = (req.body?.name || '').toString().trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const row = await createProfile(name);
    res.json(row);
  } catch (e) {
    console.error('[profiles][post]', e);
    res.status(500).json({ error: 'profile create failed' });
  }
});

// image proxy + disk cache (+fallback sizes)
api.get('/img', async (req, res) => {
  const original = (req.query.u || '').toString();
  if (!original) return res.status(400).end('u required');

  const candidates = (() => {
    const list = [original]; const add = (u) => { if (u && !list.includes(u)) list.push(u); };
    if (/\/300\.(jpg|png)(\?|$)/i.test(original)) { add(original.replace('/300.', '/180.')); add(original.replace('/300.', '/60.')); }
    else if (/\/180\.(jpg|png)(\?|$)/i.test(original)) { add(original.replace('/180.', '/300.')); add(original.replace('/180.', '/60.')); }
    else if (/\/60\.(jpg|png)(\?|$)/i.test(original))  { add(original.replace('/60.', '/180.'));  add(original.replace('/60.', '/300.')); }
    return list;
  })();

  async function fetchOne(u) {
    const key = crypto.createHash('md5').update(u).digest('hex');
    const fp  = path.join(IMG_DIR, key);
    try {
      const buf = await fs.readFile(fp);
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      if (/\.png(\?|$)/i.test(u)) res.type('png'); else res.type('jpg');
      res.end(buf); return true;
    } catch {}
    for (const headers of [
      { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.pricecharting.com/', 'Accept': 'image/avif,image/webp,*/*' },
      {}
    ]) {
      try {
        const r = await fetch(u, { headers });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        await fs.writeFile(fp, buf);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        if (/\.png(\?|$)/i.test(u)) res.type('png'); else res.type('jpg');
        res.end(buf); return true;
      } catch {}
    }
    return false;
  }

  for (const u of candidates) { if (await fetchOne(u)) return; }
  res.status(502).end('img fetch failed');
});

// master'dan en iyi kaliteyi dön
api.get('/img-local/:id', async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).end('id');

  const [rows] = await pool.query(
    `SELECT local_path FROM images
     WHERE master_id=? ORDER BY FIELD(quality_tag,'1000','600','300','180','60','orig') LIMIT 1`,
    [id]
  );
  const fp = rows?.[0]?.local_path;
  if (!fp) return res.status(404).end('no image');

  try {
    const buf = await fs.readFile(fp);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.type('jpg').end(buf);
  } catch {
    res.status(500).end('fs');
  }
});

// inbox / binder (JSON)
api.get('/inbox', async (req, res) => {
  const pid = (req.query.profile || 'default').toString();
  res.json(await readJSON(pInbox(pid), []));
});
api.get('/binder', async (req, res) => {
  const pid = (req.query.profile || 'default').toString();
  const bid = (req.query.binder || 'main').toString();
  res.json(await readJSON(pBinder(pid, bid), []));
});
api.post('/binder/add', async (req, res) => {
  const pid  = (req.body?.profile || 'default').toString();
  const bid  = (req.body?.binder  || 'main').toString();
  const keys = Array.isArray(req.body?.cardKeys) ? req.body.cardKeys : [];
  const inbox   = await readJSON(pInbox(pid), []);
  const toAdd   = inbox.filter(c => keys.includes(c.pc_item_id || c.pc_url));
  const current = await readJSON(pBinder(pid, bid), []);
  const merged  = dedupCards([...current, ...toAdd]);
  await writeJSON(pBinder(pid, bid), merged);
  res.json({ added: toAdd.length, total: merged.length });
});

// import + master’a yaz + görseli indir
api.post('/import', async (req, res) => {
  try {
    const url = (req.body?.url || '').toString();
    const cookie = (req.body?.cookie || '').toString();
    const pid = (req.body?.profile || 'default').toString();
    if (!url) return res.status(400).json({ error: 'url required' });

    console.log('[IMPORT] url =', url);
    const items = await fetchCollection(url, { cookie });
    const clean = dedupCards(items);

    for (const it of clean) {
      const mid = await upsertMasterCard(it);
      it.master_id = mid;
      if (it.image_url) {
        await ensureHiResImage(mid, it.image_url);
      }
    }

    await writeJSON(pInbox(pid), clean);
    console.log('[IMPORT] parsed =', clean.length);
    res.json({ imported: clean.length });
  } catch (e) {
    console.error('[IMPORT][ERROR]', e);
    res.status(500).json({ error: e.message || 'import failed' });
  }
});

// Mount & static
app.use('/api', api);
app.use('/', express.static(path.join(__dirname, '..', 'web')));

// start
const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`[STATIC] ${path.join(__dirname, '..', 'web')}`);
  console.log(`Binder running: http://localhost:${PORT}`);
});
