// api/index.js
import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// --- path’ler
const DATA_DIR = path.join(__dirname, "data");
await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
const IMG_DIR  = path.join(DATA_DIR, "imgcache");
await fs.mkdir(IMG_DIR, { recursive: true }).catch(() => {});

// --- küçük yardımcılar (dosya güvenli okuma/yazma)
async function readJSON(filePath, fallback) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); }
  catch { return fallback; }
}
async function writeJSON(filePath, val) {
  await fs.writeFile(filePath, JSON.stringify(val, null, 2), "utf8");
}

// eski JSON dosya şeması (DB’ye geçene kadar)
const pProfiles = () => path.join(DATA_DIR, "profiles.json");
const pInbox    = (pid) => path.join(DATA_DIR, `inbox-${pid}.json`);
const pBinder   = (pid, bid) => path.join(DATA_DIR, `binder-${pid}-${bid}.json`);

// de-dup
const cardKey = (c) => (c?.pc_item_id || c?.pc_url || "") + "|" + (c?.price_value ?? "");
function dedupCards(arr = []) {
  const seen = new Set(); const out = [];
  for (const it of arr) {
    const k = cardKey(it);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}

// health
app.get("/api/health", (_req, res) => res.json({ ok:true }));

// --- image proxy (disk cache + boyut fallback)
app.get("/api/img", async (req, res) => {
  const original = (req.query.u || "").toString();
  if (!original) return res.status(400).end("u required");

  const candidates = (() => {
    const list = [original];
    const push = (u) => { if (u && !list.includes(u)) list.push(u); };
    if (/\/300\.(jpg|png)(\?|$)/i.test(original)) { push(original.replace("/300.","/180.")); push(original.replace("/300.","/60.")); }
    else if (/\/180\.(jpg|png)(\?|$)/i.test(original)) { push(original.replace("/180.","/60.")); push(original.replace("/180.","/300.")); }
    else if (/\/60\.(jpg|png)(\?|$)/i.test(original))  { push(original.replace("/60.","/180.")); push(original.replace("/60.","/300.")); }
    return list;
  })();

  async function fetchOne(u) {
    const key = crypto.createHash("md5").update(u).digest("hex");
    const fp  = path.join(IMG_DIR, key);

    try {
      const buf = await fs.readFile(fp);
      res.setHeader("Cache-Control","public, max-age=604800, immutable");
      if (/\.png(\?|$)/i.test(u)) res.type("png"); else res.type("jpg");
      res.end(buf); return true;
    } catch {}

    const tries = [
      { "User-Agent":"Mozilla/5.0", "Referer":"https://www.pricecharting.com/", "Accept":"image/avif,image/webp,*/*" },
      {}
    ];
    for (const h of tries) {
      try {
        const r = await fetch(u, { headers:h });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        await fs.writeFile(fp, buf);
        res.setHeader("Cache-Control","public, max-age=604800, immutable");
        if (/\.png(\?|$)/i.test(u)) res.type("png"); else res.type("jpg");
        res.end(buf); return true;
      } catch {}
    }
    return false;
  }

  for (const u of candidates) {
    const ok = await fetchOne(u);
    if (ok) return;
  }
  res.status(502).end("img fetch failed");
});

// --- scraper (mevcut scraper.js’in fetchCollection’ını kullanıyoruz)
import { fetchCollection } from "./scraper.js";

// --- PROFILES: asla çökme
app.get("/api/profiles", async (_req, res) => {
  try {
    let rows = await readJSON(pProfiles(), null);
    if (!rows || !Array.isArray(rows) || !rows.length) {
      rows = [{ id:"default", name:"default" }];
      await writeJSON(pProfiles(), rows);
    }
    res.json(rows);
  } catch (e) {
    console.error("[/profiles] error", e);
    res.json([{ id:"default", name:"default" }]); // güvenli fallback
  }
});

app.post("/api/profiles", async (req, res) => {
  const name = (req.body?.name || "").toString().trim();
  if (!name) return res.status(400).json({ error:"name required" });
  const rows = await readJSON(pProfiles(), []);
  const slug = name.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9_-]/g,"") || "profile";
  let id = slug, n = 1;
  while (rows.some(r => r.id === id)) id = `${slug}-${n++}`;
  rows.push({ id, name });
  await writeJSON(pProfiles(), rows);
  res.json({ id, name });
});

// --- INBOX / BINDER (JSON)
app.get("/api/inbox", async (req, res) => {
  const profile = (req.query.profile || "default").toString();
  const items = await readJSON(pInbox(profile), []);
  res.json(items);
});
app.get("/api/binder", async (req, res) => {
  const profile = (req.query.profile || "default").toString();
  const binder  = (req.query.binder  || "main").toString();
  const items = await readJSON(pBinder(profile, binder), []);
  res.json(items);
});
app.post("/api/binder/add", async (req, res) => {
  const profile = (req.body?.profile || "default").toString();
  const binder  = (req.body?.binder  || "main").toString();
  const keys    = Array.isArray(req.body?.cardKeys) ? req.body.cardKeys : [];
  const inbox   = await readJSON(pInbox(profile), []);
  const toAdd   = inbox.filter(c => keys.includes(c.pc_item_id || c.pc_url));
  const current = await readJSON(pBinder(profile, binder), []);
  const merged  = dedupCards([...current, ...toAdd]);
  await writeJSON(pBinder(profile, binder), merged);
  res.json({ added: toAdd.length, total: merged.length });
});

// --- IMPORT (inbox’ı tamamen yeniler)
app.post("/api/import", async (req, res) => {
  try {
    const url     = (req.body?.url    || "").toString();
    const cookie  = (req.body?.cookie || "").toString();
    const profile = (req.body?.profile|| "default").toString();
    if (!url) return res.status(400).json({ error:"url required" });

    console.log("[IMPORT] url =", url);
    const items = await fetchCollection(url, { cookie });
    const clean = dedupCards(items);
    await writeJSON(pInbox(profile), clean);
    console.log("[IMPORT] parsed =", clean.length);
    res.json({ imported: clean.length });
  } catch (e) {
    console.error("[IMPORT][ERROR]", e);
    res.status(500).json({ error: e.message || "import failed" });
  }
});

// --- statikler (web)
app.use("/", express.static(path.join(__dirname, "..", "web")));

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`[STATIC] ${path.join(__dirname, "..", "web")}`);
  console.log(`Binder running: http://localhost:${PORT}`);
});
