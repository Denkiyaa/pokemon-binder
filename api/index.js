// api/index.js
import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { fetchCollection } from "./scraper.js";
import fetch from "node-fetch";
import crypto from "crypto";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ------------ storage helpers ------------
const DB_DIR = path.join(__dirname, "data");
await fs.mkdir(DB_DIR, { recursive: true }).catch(() => { });

const pProfiles = () => path.join(DB_DIR, "profiles.json");
const pInbox = (profileId) => path.join(DB_DIR, `inbox-${profileId}.json`);
const pBinder = (profileId, binderId) => path.join(DB_DIR, `binder-${profileId}-${binderId}.json`);

async function readJSON(p, fallback) {
    try { return JSON.parse(await fs.readFile(p, "utf8")); }
    catch { return fallback; }
}
async function writeJSON(p, val) {
    await fs.writeFile(p, JSON.stringify(val, null, 2), "utf8");
}

// ------------ profiles ------------
export async function listProfiles() {
    let rows = await readJSON(pProfiles(), null);
    if (!rows || !Array.isArray(rows) || !rows.length) {
        rows = [{ id: "default", name: "default" }];
        await writeJSON(pProfiles(), rows);
    }
    return rows;
}
export async function createProfile(name = "profile") {
    const profiles = await listProfiles();
    const slugBase = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
    let id = slugBase || "profile";
    let n = 1;
    while (profiles.some(p => p.id === id)) { id = `${slugBase}-${n++}`; }
    const row = { id, name };
    profiles.push(row);
    await writeJSON(pProfiles(), profiles);
    // yeni profil için boş inbox/binder oluşturmak şart değil; istek geldiğinde fallback zaten boş dönüyor.
    return row;
}

// ------------ de-dup helpers ------------
const cardKey = (c) => (c?.pc_item_id || c?.pc_url || "") + "|" + (c?.price_value ?? "");
function dedupCards(arr = []) {
    const seen = new Set();
    const out = [];
    for (const it of arr) {
        const k = cardKey(it);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(it);
    }
    return out;
}

// ------------ routes ------------

// ---- image proxy + disk cache ----
const IMG_DIR = path.join(DB_DIR, "imgcache");
await fs.mkdir(IMG_DIR, { recursive: true }).catch(() => { });

app.get("/img", async (req, res) => {
    const original = (req.query.u || "").toString();
    if (!original) return res.status(400).end("u required");

    // Küçük bir yardımcı: farklı boyut adayları üret
    const candidates = (() => {
        const list = [original];
        const push = (u) => { if (u && !list.includes(u)) list.push(u); };

        // boyut varyasyonları
        if (/\/300\.(jpg|png)(\?|$)/i.test(original)) {
            push(original.replace("/300.", "/180."));
            push(original.replace("/300.", "/60."));
        } else if (/\/180\.(jpg|png)(\?|$)/i.test(original)) {
            push(original.replace("/180.", "/300."));
            push(original.replace("/180.", "/60."));
        } else if (/\/60\.(jpg|png)(\?|$)/i.test(original)) {
            push(original.replace("/60.", "/180."));
            push(original.replace("/60.", "/300."));
        }
        return list;
    })();

    // tek bir URL'i getirip kaydetmeyi dener
    async function fetchOne(u) {
        const key = crypto.createHash("md5").update(u).digest("hex");
        const fp = path.join(IMG_DIR, key);

        // 1) diskten
        try {
            const buf = await fs.readFile(fp);
            res.setHeader("Cache-Control", "public, max-age=604800, immutable");
            if (/\.png(\?|$)/i.test(u)) res.type("png"); else res.type("jpg");
            res.end(buf);
            return true;
        } catch { }

        // 2) ağdan (header'lı → başarısızsa headersız)
        const headersTry = [
            {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer": "https://www.pricecharting.com/",
                "Accept": "image/avif,image/webp,*/*",
            },
            {} // headersız fallback
        ];

        for (const h of headersTry) {
            try {
                const r = await fetch(u, { headers: h });
                if (!r.ok) continue;
                const buf = Buffer.from(await r.arrayBuffer());
                await fs.writeFile(fp, buf);
                res.setHeader("Cache-Control", "public, max-age=604800, immutable");
                if (/\.png(\?|$)/i.test(u)) res.type("png"); else res.type("jpg");
                res.end(buf);
                return true;
            } catch { }
        }
        return false;
    }

    // adayları sırayla dene
    for (const u of candidates) {
        const ok = await fetchOne(u);
        if (ok) return;
    }

    res.status(502).end("img fetch failed");
});



// statik web
app.use("/", express.static(path.join(__dirname, "..", "web")));

// profiles
app.get("/profiles", async (_req, res) => {
    res.json(await listProfiles());
});
app.post("/profiles", async (req, res) => {
    const name = (req.body?.name || "").toString().trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const row = await createProfile(name);
    res.json(row);
});

// inbox: import ile gelen “gelen kutusu”
app.get("/inbox", async (req, res) => {
    const profile = (req.query.profile || "default").toString();
    const items = await readJSON(pInbox(profile), []);
    res.json(items);
});

// binder: seçilenlerin tutulduğu defter
app.get("/binder", async (req, res) => {
    const profile = (req.query.profile || "default").toString();
    const binder = (req.query.binder || "main").toString();
    const items = await readJSON(pBinder(profile, binder), []);
    res.json(items);
});

// binder/add: inbox’tan seçilen anahtarlarla binder’a ekle (duplicate engelle)
app.post("/binder/add", async (req, res) => {
    const profile = (req.body?.profile || "default").toString();
    const binder = (req.body?.binder || "main").toString();
    const keys = Array.isArray(req.body?.cardKeys) ? req.body.cardKeys : [];

    const inbox = await readJSON(pInbox(profile), []);
    const toAdd = inbox.filter(c => keys.includes(c.pc_item_id || c.pc_url));

    const current = await readJSON(pBinder(profile, binder), []);
    const merged = dedupCards([...current, ...toAdd]);
    await writeJSON(pBinder(profile, binder), merged);

    res.json({ added: toAdd.length, total: merged.length });
});

// import: verilen URL’i scrape et → inbox’a YAZ (biriktirmez; “duplicate şişmesi” bitti)
app.post("/import", async (req, res) => {
    try {
        const url = (req.body?.url || "").toString();
        const cookie = (req.body?.cookie || "").toString();
        const profile = (req.body?.profile || "default").toString();
        if (!url) return res.status(400).json({ error: "url required" });

        console.log("[IMPORT] url =", url);
        const items = await fetchCollection(url, { cookie });
        const clean = dedupCards(items);

        // inbox’ı tamamen yenile (artık 4000 satır birikmeyecek)
        await writeJSON(pInbox(profile), clean);

        console.log("[IMPORT] parsed =", clean.length);
        res.json({ imported: clean.length });
    } catch (e) {
        console.error("[IMPORT][ERROR]", e);
        res.status(500).json({ error: e.message || "import failed" });
    }
});

// debug: en son scraped HTML’den say (opsiyonel)
app.post("/debug-scrape", async (_req, res) => {
    try {
        const lastHtmlPath = path.join(__dirname, "data", "last.html");
        const txt = await fs.readFile(lastHtmlPath, "utf8").catch(() => "");
        res.json({ count: (txt.match(/href="\/offer\//g) || []).length });
    } catch {
        res.json({ count: 0 });
    }
});

// eski /cards (Liste sekmesini doldurmak için inbox’ı gösterelim)
app.get("/cards", async (_req, res) => {
    const items = await readJSON(pInbox("default"), []);
    res.json(items);
});

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[STATIC] ${path.join(__dirname, "..", "web")}`);
    console.log(`Binder running: http://localhost:${PORT}`);
});
