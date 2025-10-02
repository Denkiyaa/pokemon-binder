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

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ---------- MariaDB (yalnızca profiles) ----------
const pool = await mysql.createPool({
  host:     process.env.DB_HOST || 'localhost',
  user:     process.env.DB_USER || 'binderapp',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'pokemon_binder',
  waitForConnections: true,
  connectionLimit: 10,
});

// (güvenlik için bir kez tabloyu ve default kaydı garanti altına alalım)
await pool.query(`
  CREATE TABLE IF NOT EXISTS profiles (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`);
await pool.query(`INSERT IGNORE INTO profiles (id,name) VALUES ('default','default')`);

// DB tabanlı profile helpers
async function listProfiles() {
  const [rows] = await pool.query(`SELECT id, name FROM profiles ORDER BY name`);
  return rows;
}
async function createProfile(name = 'profile') {
  const base = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '') || 'profile';
  let id = base, n = 1;
  // benzersiz yap
  for (;;) {
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

// ---------- JSON storage (inbox/binder + image cache) ----------
const DB_DIR = path.join(__dirname, 'data');
await fs.mkdir(DB_DIR, { recursive: true }).catch(() => {});
const IMG_DIR = path.join(DB_DIR, 'imgcache');
await fs.mkdir(IMG_DIR, { recursive: true }).catch(() => {});

const pInbox  = (pid) => path.join(DB_DIR, `inbox-${pid}.json`);
const pBinder = (p,b) => path.join(DB_DIR, `binder-${p}-${b}.json`);

const readJSON  = async (p, fb) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fb; } };
const writeJSON = (p, v) => fs.writeFile(p, JSON.stringify(v, null, 2), 'utf8');

const cardKey = (c) => (c?.pc_item_id || c?.pc_url || '') + '|' + (c?.price_value ?? '');
const dedupCards = (arr=[]) => {
  const seen = new Set(); const out=[];
  for (const it of arr) {
    const k = cardKey(it); if (!k || seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
};

// ---------- API (prefix /api) ----------
const api = express.Router();

// health
api.get('/health', (_req,res)=> res.json({ok:true}));

// profiles (DB)
api.get('/profiles', async (_req,res) => {
  try { res.json(await listProfiles()); }
  catch (e) { console.error('[profiles][get]', e); res.status(500).json({error:'profiles get failed'}); }
});
api.post('/profiles', async (req,res) => {
  try {
    const name = (req.body?.name || '').toString().trim();
    if (!name) return res.status(400).json({ error:'name required' });
    const row = await createProfile(name);
    res.json(row);
  } catch (e) {
    console.error('[profiles][post]', e);
    res.status(500).json({error:'profile create failed'});
  }
});

// image proxy + disk cache (+fallback sizes)
api.get('/img', async (req,res) => {
  const original = (req.query.u || '').toString();
  if (!original) return res.status(400).end('u required');

  const candidates = (() => {
    const list=[original]; const add=(u)=>{ if(u && !list.includes(u)) list.push(u); };
    if (/\/300\.(jpg|png)(\?|$)/i.test(original)) { add(original.replace('/300.','/180.')); add(original.replace('/300.','/60.')); }
    else if (/\/180\.(jpg|png)(\?|$)/i.test(original)) { add(original.replace('/180.','/300.')); add(original.replace('/180.','/60.')); }
    else if (/\/60\.(jpg|png)(\?|$)/i.test(original))  { add(original.replace('/60.','/180.'));  add(original.replace('/60.','/300.')); }
    return list;
  })();

  async function fetchOne(u) {
    const key = crypto.createHash('md5').update(u).digest('hex');
    const fp  = path.join(IMG_DIR, key);
    try {
      const buf = await fs.readFile(fp);
      res.setHeader('Cache-Control','public, max-age=604800, immutable');
      if (/\.png(\?|$)/i.test(u)) res.type('png'); else res.type('jpg');
      res.end(buf); return true;
    } catch {}
    for (const headers of [
      { 'User-Agent':'Mozilla/5.0', 'Referer':'https://www.pricecharting.com/', 'Accept':'image/avif,image/webp,*/*' },
      {}
    ]) {
      try {
        const r = await fetch(u, { headers });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        await fs.writeFile(fp, buf);
        res.setHeader('Cache-Control','public, max-age=604800, immutable');
        if (/\.png(\?|$)/i.test(u)) res.type('png'); else res.type('jpg');
        res.end(buf); return true;
      } catch {}
    }
    return false;
  }

  for (const u of candidates) { if (await fetchOne(u)) return; }
  res.status(502).end('img fetch failed');
});

// inbox / binder (JSON)
api.get('/inbox',  async (req,res)=> {
  const pid = (req.query.profile || 'default').toString();
  res.json(await readJSON(pInbox(pid), []));
});
api.get('/binder', async (req,res)=> {
  const pid = (req.query.profile || 'default').toString();
  const bid = (req.query.binder  || 'main').toString();
  res.json(await readJSON(pBinder(pid,bid), []));
});
api.post('/binder/add', async (req,res)=> {
  const pid  = (req.body?.profile || 'default').toString();
  const bid  = (req.body?.binder  || 'main').toString();
  const keys = Array.isArray(req.body?.cardKeys) ? req.body.cardKeys : [];
  const inbox   = await readJSON(pInbox(pid), []);
  const toAdd   = inbox.filter(c => keys.includes(c.pc_item_id || c.pc_url));
  const current = await readJSON(pBinder(pid,bid), []);
  const merged  = dedupCards([...current, ...toAdd]);
  await writeJSON(pBinder(pid,bid), merged);
  res.json({ added: toAdd.length, total: merged.length });
});

// import (Listeyi inbox.json’a yazar)
api.post('/import', async (req,res)=> {
  try {
    const url    = (req.body?.url    || '').toString();
    const cookie = (req.body?.cookie || '').toString();
    const pid    = (req.body?.profile|| 'default').toString();
    if (!url) return res.status(400).json({ error:'url required' });

    console.log('[IMPORT] url =', url);
    const items = await fetchCollection(url, { cookie });
    const clean = dedupCards(items);
    await writeJSON(pInbox(pid), clean);
    console.log('[IMPORT] parsed =', clean.length);
    res.json({ imported: clean.length });
  } catch (e) {
    console.error('[IMPORT][ERROR]', e);
    res.status(500).json({ error: e.message || 'import failed' });
  }
});

// API router'ı mount et
app.use('/api', api);

// statik web
app.use('/', express.static(path.join(__dirname, '..', 'web')));

// start
const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`[STATIC] ${path.join(__dirname, '..', 'web')}`);
  console.log(`Binder running: http://localhost:${PORT}`);
});
