import fs from 'fs-extra';
const { ensureDirSync, pathExistsSync, readJsonSync, writeJsonSync } = fs;

ensureDirSync('./data');
const DB_PATH = './data/db.json';

function load() {
    if (!pathExistsSync(DB_PATH)) {
        writeJsonSync(DB_PATH, { cards: [], price_history: [], _seq: 0 }, { spaces: 2 });
    }
    return readJsonSync(DB_PATH);
}
function save(db) {
    writeJsonSync(DB_PATH, db, { spaces: 2 });
}

export function upsertCard(item) {
    const db = load();
    const idx = db.cards.findIndex(c => c.pc_url === item.pc_url);
    const now = new Date().toISOString();

    if (idx === -1) {
        const id = ++db._seq;
        db.cards.push({
            id,
            pc_url: item.pc_url,
            pc_item_id: item.pc_item_id || '',
            name: item.name || '',
            set_name: item.set_name || '',
            collector_number: item.collector_number || '',
            collector_number_num: parseInt(String(item.collector_number).match(/\d+/)?.[0] || '0', 10),
            condition: item.condition || '',
            price_value: item.price_value ?? null,
            price_currency: item.price_currency || 'USD',
            image_url: item.image_url || '',
            order_index: item.order_index ?? null,  // << ekledik
            last_seen: now,
            updated_at: now
        });
        save(db);
        return { created: true, id };
    } else {
        const prev = db.cards[idx];
        const updated = {
            ...prev,
            ...item,
            collector_number_num: parseInt(String(item.collector_number ?? prev.collector_number).match(/\d+/)?.[0] || '0', 10),
            price_currency: item.price_currency || prev.price_currency || 'USD',
            order_index: item.order_index ?? prev.order_index ?? null, // << ekledik
            last_seen: now,
            updated_at: now
        };
        db.cards[idx] = updated;
        save(db);
        return { created: false, id: updated.id, prev_price: prev.price_value, new_price: updated.price_value };
    }
}


export function findCardByUrl(url) {
    const db = load();
    return db.cards.find(c => c.pc_url === url) || null;
}

export function addPriceHistory(card_id, price_value, price_currency = 'USD') {
    const db = load();
    db.price_history.push({
        id: (db.price_history.at(-1)?.id || 0) + 1,
        card_id,
        price_value,
        price_currency,
        seen_at: new Date().toISOString()
    });
    save(db);
}

export function getAllCards() {
    const db = load();
    return db.cards.slice().sort((a, b) => {
        // 1) order_index varsa ona göre (sayfadaki görünüm)
        if (a.order_index != null && b.order_index != null) return a.order_index - b.order_index;
        // 2) sonra set + collector number
        const s = (a.set_name || '').localeCompare(b.set_name || '', 'tr', { sensitivity: 'base' });
        if (s !== 0) return s;
        return (a.collector_number_num || 0) - (b.collector_number_num || 0);
    });
}

export function getCardWithHistory(id) {
    const db = load();
    const card = db.cards.find(c => String(c.id) === String(id));
    if (!card) return null;
    const history = db.price_history
        .filter(h => String(h.card_id) === String(id))
        .sort((a, b) => b.seen_at.localeCompare(a.seen_at));
    return { ...card, history };
}

export function ensureProfile(pid='default'){
  const db = read();
  if (!db.profiles) db.profiles = {};
  if (!db.profiles[pid]) {
    db.profiles[pid] = { name: pid, inbox: [], binders: {}, activeBinderId: '' };
    write(db);
  }
  return pid;
}

export function listProfiles(){
  const db = read();
  return Object.entries(db.profiles||{}).map(([id,p]) => ({id, name:p.name}));
}

export function upsertCards(cardList){
  const db = read();
  if (!db.cards) db.cards = {};
  for (const c of cardList){
    const key = c.pc_item_id || c.pc_url;
    if (!key) continue;
    db.cards[key] = { ...db.cards[key], ...c }; // merge
  }
  write(db);
  return cardList.map(c => c.pc_item_id || c.pc_url).filter(Boolean);
}

export function setInbox(pid, keys){
  const db = read();
  ensureProfile(pid);
  db.profiles[pid].inbox = [...new Set(keys)];
  write(db);
}

export function addToBinder(pid, binderId, keys){
  const db = read();
  ensureProfile(pid);
  const prof = db.profiles[pid];
  if (!prof.binders[binderId]) prof.binders[binderId] = { name: binderId, items: [] };
  const arr = prof.binders[binderId].items;
  for (const k of keys) if (!arr.includes(k)) arr.push(k);
  write(db);
}

export function getCardsByKeys(keys){
  const db = read();
  return keys.map(k => db.cards?.[k]).filter(Boolean);
}

