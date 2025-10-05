// api/scraper.js
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import { access, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LAST_HTML_PATH = path.join(__dirname, 'data', 'last.html');

const ABS = (href) => {
  try { return new URL(href, 'https://www.pricecharting.com').toString(); }
  catch { return ''; }
};

const upgradeImg = (u = '') => {
  if (!u) return '';
  u = u.replace(/\/(60|180)\.(jpg|png)(\?.*)?$/i, '/300.$2$3');
  u = u.replace(/([?&])w=\d+/i, '$1w=480');
  return ABS(u);
};

// --- kesinlikle modul seviyesinde hicbir sey calistirma! ---

async function resolveChromePath() {
  // 1) ENV
  if (process.env.CHROME_PATH) {
    try { await access(process.env.CHROME_PATH); return process.env.CHROME_PATH; } catch {}
  }
  // 2) common paths
  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  for (const p of candidates) {
    try { await access(p); return p; } catch {}
  }
  throw new Error('Chrome/Chromium bulunamadi. CHROME_PATH env ver veya chromium/google-chrome kur.');
}

function parseWithCheerio(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $('table.selling_table tr').each((_, tr) => {
    const $tr = $(tr);
    const a = $tr.find('td.meta a[href^="/offer/"]').first();
    if (!a.length) return;

    const pc_url = ABS(a.attr('href'));
    const name = a.text().trim();
    if (!pc_url || !name) return;

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

    const priceText = $tr.find('td.price').text().replace(/\s+/g, ' ').trim();
    let price_value = null, price_currency = 'USD';
    const pm = priceText.match(/\$([\d,]+(?:\.\d+)?)/);
    if (pm) price_value = parseFloat(pm[1].replace(/,/g, ''));

    const collector_number = (name.match(/#(\d+)/)?.[1]) || '';
    const pc_item_id = $tr.attr('data-offer-id') || (pc_url.match(/\/offer\/([^/?#]+)/)?.[1]) || '';
    const condition = '';

    rows.push({ pc_url, pc_item_id, name, set_name, collector_number, condition, price_value, price_currency, image_url });
  });

  // tekillestir
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
  // Import Puppeteer dynamically only here
  const puppeteer = (await import('puppeteer-core')).default;

  const exe = await resolveChromePath();

  const crashpadRoot = path.join(__dirname, '.cache');
  await mkdir(crashpadRoot, { recursive: true }).catch(() => {});
  const configRoot = path.join(crashpadRoot, 'config');
  const cacheRoot = path.join(crashpadRoot, 'cache');
  const tmpRoot = path.join(crashpadRoot, 'tmp');
  await mkdir(configRoot, { recursive: true }).catch(() => {});
  await mkdir(cacheRoot, { recursive: true }).catch(() => {});
  await mkdir(tmpRoot, { recursive: true }).catch(() => {});
  const udd = path.join(crashpadRoot, 'chrome');
  await mkdir(udd, { recursive: true }).catch(() => {});
  const crashpadDir = path.join(udd, 'crashpad');
  await mkdir(crashpadDir, { recursive: true }).catch(() => {});

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: exe,
    userDataDir: udd,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-crash-reporter',
      '--no-crashpad',
      '--window-size=1280,900',
    ],
    env: {
      ...process.env,
      HOME: crashpadRoot,
      USERPROFILE: crashpadRoot,
      XDG_CONFIG_HOME: configRoot,
      XDG_CACHE_HOME: cacheRoot,
      XDG_DATA_HOME: crashpadRoot,
      XDG_RUNTIME_DIR: tmpRoot,
      TMPDIR: tmpRoot,
      CRASHPAD_DATABASE: crashpadDir,
      CRASHDUMP_DIRECTORY: crashpadDir,
      CHROME_CRASHPAD_PIPE_NAME: '',
      PUPPETEER_DISABLE_CRASH_REPORTER: '1'
    },
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9,tr-TR;q=0.8',
      'Referer': 'https://www.pricecharting.com/',
    });

    if (cookieStr) {
      const cookies = cookieStr.split(';').map(s => s.trim()).filter(Boolean).map(pair => {
        const [name, ...rest] = pair.split('=');
        return { name, value: rest.join('='), domain: '.pricecharting.com', path: '/' };
      });
      if (cookies.length) await page.setCookie(...cookies);
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('table.selling_table td.meta a[href^="/offer/"]', { timeout: 15000 }).catch(() => {});

    // Scroll down a bit more to load extra rows
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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

    const html = await page.content();
    try {
      await mkdir(path.dirname(LAST_HTML_PATH), { recursive: true });
      await fs.writeFile(LAST_HTML_PATH, html, 'utf8');
    } catch {}

    const items = parseWithCheerio(html);
    return items.map((it, i) => ({ ...it, order_index: i + 1 }));
  } finally {
    await browser.close();
  }
}

export async function fetchCollection(url, { debug = false, cookie = '' } = {}) {
  const items = await renderWithPuppeteer(url, cookie);
  if (debug) {
    const html = await fs.readFile(LAST_HTML_PATH, 'utf8').catch(() => '');
    return { html, items };
  }
  return items;
}

