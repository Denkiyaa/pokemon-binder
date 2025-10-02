// api/scraper.js
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';

const ABS = (href) => {
    try { return new URL(href, 'https://www.pricecharting.com').toString(); }
    catch { return ''; }
};
const PROD_URL = (id) => `https://www.pricecharting.com/products/${id}`;

const pickImg = ($row) =>
    $row.find('img').first().attr('data-src') ||
    $row.find('img').first().attr('src') || '';

// dosya başına ekle
const upgradeImg = (u = '') => {
    if (!u) return '';
    u = u.replace(/\/(60|180)\.(jpg|png)(\?.*)?$/i, '/300.$2$3'); // 60/180 -> 300
    u = u.replace(/([?&])w=\d+/i, '$1w=480');                     // varsa w= paramını büyüt
    return ABS(u);
};

function parseWithCheerio(html) {
    const $ = cheerio.load(html);
    const rows = [];

    // A) PriceCharting koleksiyon satırları (tek sayfa listesi)
    $('table.selling_table tr').each((_, tr) => {
        const $tr = $(tr);
        const a = $tr.find('td.meta a[href^="/offer/"]').first();
        if (!a.length) return;

        const pc_url = ABS(a.attr('href'));
        const name = a.text().trim();
        if (!pc_url || !name) return;

        // set adı: <p class="title"> içindeki anchor harici text
        let set_name = '';
        const titleP = $tr.find('td.meta p.title').first();
        if (titleP.length) {
            const texts = titleP.contents()
                .filter((i, el) => el.type === 'text')
                .map((i, el) => $(el).text().trim())
                .get()
                .filter(Boolean);
            set_name = texts[0] || '';
        }

        const raw = $tr.find('td.photo img').first().attr('data-src')
            || $tr.find('td.photo img').first().attr('src') || '';
        const image_url = upgradeImg(raw);

        // fiyat
        const priceText = $tr.find('td.price').text().replace(/\s+/g, ' ').trim();
        let price_value = null, price_currency = 'USD';
        const pm = priceText.match(/\$([\d,]+(?:\.\d+)?)/);
        if (pm) price_value = parseFloat(pm[1].replace(/,/g, ''));

        const collector_number = (name.match(/#(\d+)/)?.[1]) || '';
        const pc_item_id = $tr.attr('data-offer-id') || (pc_url.match(/\/offer\/([^/?#]+)/)?.[1]) || '';
        const condition = '';

        rows.push({ pc_url, pc_item_id, name, set_name, collector_number, condition, price_value, price_currency, image_url });
    });





    // tekilleştir
    const seen = new Set();
    const out = [];
    for (const it of rows) {
        const key = it.pc_item_id || it.pc_url;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(it);
    }
    return out;
}


async function renderWithPuppeteer(url, cookieStr) {
    const puppeteer = (await import('puppeteer-extra')).default;
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    puppeteer.use(StealthPlugin());

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,900'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9,tr-TR;q=0.8',
            'Referer': 'https://www.pricecharting.com/'
        });

        if (cookieStr) {
            const cookies = cookieStr.split(';').map(s => s.trim()).filter(Boolean).map(pair => {
                const [name, ...rest] = pair.split('=');
                return { name, value: rest.join('='), domain: '.pricecharting.com', path: '/' };
            });
            if (cookies.length) await page.setCookie(...cookies);
        }

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // İlk satırlar görünsün
        await page.waitForSelector('table.selling_table td.meta a[href^="/offer/"]', { timeout: 15000 }).catch(() => { });

        // Otomatik scroll – içerik artmazsa 3 tur üst üste dur
        await page.evaluate(async () => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            let prev = 0, same = 0;
            for (let i = 0; i < 80; i++) {
                window.scrollTo(0, document.documentElement.scrollHeight);
                await sleep(500);
                const cur = document.documentElement.scrollHeight;
                if (cur <= prev) { same++; if (same >= 3) break; }
                else { same = 0; prev = cur; }
            }
            await sleep(600);
        });

        const domCount = await page.evaluate(() =>
            document.querySelectorAll('table.selling_table td.meta a[href^="/offer/"]').length
        );
        console.log('[SCRAPE] domCount=', domCount);

        const html = await page.content();
        try { await fs.writeFile('./data/last.html', html, 'utf8'); } catch { }

        const items = parseWithCheerio(html);
        console.log(`[SCRAPE] page1 count=${items.length}`);
        return items.map((it, i) => ({ ...it, order_index: i + 1 }));
    } finally {
        await browser.close();
    }
}

function bumpImage(u = '') {
    if (!u) return '';
    try {
        // .../60.jpg → .../300.jpg (varsa query param w= değiştirelim)
        u = u.replace(/\/(\d+)\.(jpg|png)(\?.*)?$/i, '/300.$2$3');
        u = u.replace(/([?&])w=\d+/i, '$1w=480'); // varsa genişlik param
        return new URL(u, 'https://www.pricecharting.com').toString();
    } catch (_) { return u; }
}



export async function fetchCollection(url, { debug = false, cookie = '' } = {}) {
    const items = await renderWithPuppeteer(url, cookie);
    if (debug) {
        const html = await fs.readFile('./data/last.html', 'utf8').catch(() => '');
        return { html, items };
    }
    return items;
}

