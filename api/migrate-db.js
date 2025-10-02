// node api/scripts/migrate-db.js
import fs from 'fs/promises';
import path from 'path';
const DB = path.resolve(process.cwd(), 'data', 'db.json');

function keyOf(c) { return c?.pc_item_id || c?.pc_url || ''; }

(async () => {
  const raw = await fs.readFile(DB, 'utf8').catch(() => '{}');
  const db = JSON.parse(raw || '{}');

  // 1) cards diziyse -> sözlüğe çevir (merge)
  if (Array.isArray(db.cards)) {
    const map = {};
    for (const c of db.cards) {
      const k = keyOf(c);
      if (!k) continue;
      map[k] = { ...(map[k] || {}), ...c };
    }
    db.cards = map;
  }
  if (!db.cards) db.cards = {};

  // 2) profiles yoksa kabaca oluştur
  if (!db.profiles) {
    db.profiles = {
      default: { name: 'Default', inbox: [], binders: { main: { name: 'Ana Binder', items: [] } }, activeBinderId: 'main' }
    };
  }

  // 3) profiller içindeki inbox/binders referanslarını dedupe et
  for (const pid of Object.keys(db.profiles)) {
    const p = db.profiles[pid];

    // inbox
    p.inbox = Array.from(new Set((p.inbox || []).filter(k => db.cards[k])));

    // binders
    if (!p.binders) p.binders = {};
    for (const bid of Object.keys(p.binders)) {
      const b = p.binders[bid];
      b.items = Array.from(new Set((b.items || []).filter(k => db.cards[k])));
    }
  }

  await fs.writeFile(DB, JSON.stringify(db, null, 2), 'utf8');
  console.log('✅ Migration OK');
})();
