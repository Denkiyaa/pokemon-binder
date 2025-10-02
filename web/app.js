// web/app.js
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
// EN ÜSTTEKİ img fonksiyonlarını böyle yap:
const preferBig = (u) =>
  u ? u.replace(/\/(60|180)\.(jpg|png)(\?.*)?$/i, '/300.$2$3') : '';

const imgSrc = (u) => (u ? `/img?u=${encodeURIComponent(preferBig(u))}` : '');
const imgProxy = imgSrc; // aynısını kullan

// -------- küçük yardımcılar --------
const toast = (msg) => {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => (t.style.display = 'none'), 2500);
};

const setActiveTab = (name) => {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#gridPanel').style.display = name === 'grid' ? '' : 'none';
  $('#binderPanel').style.display = name === 'binder' ? '' : 'none';
};

const getJSON = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
};


function showLoading(msg = "Yükleniyor…") {
  const m = document.getElementById('loadMask');
  const t = document.getElementById('loadMsg');
  if (!m || !t) return;
  t.textContent = msg;
  m.style.display = 'block';
}
function hideLoading() {
  const m = document.getElementById('loadMask');
  if (m) m.style.display = 'none';
}

// Buton üstünde mini spinner (opsiyonel)
function spinBtn(btn, spinning = true, labelWhenStop = null) {
  if (!btn) return;
  if (spinning) {
    btn.dataset._label = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="btnspin" style="display:inline-block;width:16px;height:16px;border:2px solid #1f2b56;border-top-color:#fff;border-radius:50%;vertical-align:-2px;margin-right:8px;animation:spin .8s linear infinite"></span> Çalışıyor…`;
  } else {
    btn.disabled = false;
    btn.innerHTML = labelWhenStop ?? (btn.dataset._label || 'Tamam');
  }
}


// ---- Global image error handler ----
window.onImgError = function onImgError(ev) {
  const img = ev?.target || ev;
  if (!img) return;

  // Mevcut proxylanmış src içindeki "u" query'sini al
  let currentRaw = "";
  try {
    const url = new URL(img.src, location.href);
    currentRaw = url.searchParams.get("u") ? decodeURIComponent(url.searchParams.get("u")) : "";
  } catch { }

  const originalRaw = img.getAttribute("data-raw") || currentRaw || "";

  // sırayla denenecek varyasyonlar
  const makeVariants = (u) => {
    const out = [u];
    const add = (x) => { if (x && !out.includes(x)) out.push(x); };
    if (/\/300\.(jpg|png)(\?|$)/i.test(u)) { add(u.replace("/300.", "/180.")); add(u.replace("/300.", "/60.")); }
    if (/\/180\.(jpg|png)(\?|$)/i.test(u)) { add(u.replace("/180.", "/60.")); add(u.replace("/180.", "/300.")); }
    if (/\/60\.(jpg|png)(\?|$)/i.test(u)) { add(u.replace("/60.", "/180.")); add(u.replace("/60.", "/300.")); }
    return out;
  };

  const tried = img.getAttribute("data-tried")?.split("|").filter(Boolean) || [];
  const variants = makeVariants(currentRaw || originalRaw).filter(v => !tried.includes(v));

  if (variants.length) {
    const next = variants.shift();
    tried.push(next);
    img.setAttribute("data-tried", tried.join("|"));
    img.onerror = onImgError;
    img.src = `/img?u=${encodeURIComponent(next)}`;
    return;
  }

  // Hepsi biterse gizle
  img.onerror = null;
  img.style.display = "none";
};


// web/app.js (en üste yardımcıların yanına)
function onImgError(imgEl) {
  try {
    const u = new URL(imgEl.src, location.origin);
    const raw = u.searchParams.get('u') || '';
    if (!raw) { imgEl.style.display = 'none'; return; }

    // fallback zinciri: 300 -> 180 -> 60 -> (w param temizle)
    if (/\/300\.(jpg|png)/i.test(raw)) {
      const next = raw.replace(/\/300\.(jpg|png)/i, '/180.$1');
      imgEl.src = `/img?u=${encodeURIComponent(next)}`;
      return;
    }
    if (/\/180\.(jpg|png)/i.test(raw)) {
      const next = raw.replace(/\/180\.(jpg|png)/i, '/60.$1');
      imgEl.src = `/img?u=${encodeURIComponent(next)}`;
      return;
    }

    // query de olabilir: w=...
    if (/\bw=\d+/.test(raw)) {
      const noW = raw.replace(/([?&])w=\d+/g, '$1').replace(/[?&]$/, '');
      imgEl.src = `/img?u=${encodeURIComponent(noW)}`;
      return;
    }
  } catch (_) { /* noop */ }

  // son çare: gizle
  imgEl.style.display = 'none';
}

// -------- Liste (Inbox) --------
function renderGrid(cards) {
  const grid = $('#grid');
  $('#countTxt').textContent = cards.length;
  grid.innerHTML = '';

  if (!cards.length) {
    grid.innerHTML = `<div class="empty">Gösterilecek kart yok.</div>`;
    return;
  }

  for (const c of cards) {
    const key = c.pc_item_id || c.pc_url;
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="row" style="align-items:flex-start">
        <input type="checkbox" class="sel" data-key="${key}" style="margin-right:8px;margin-top:6px">
        <img class="thumb"src="${imgSrc(c.image_url)}"data-raw="${c.image_url || ''}"onerror="onImgError(event)"><div>
          <div class="title">${c.name || '—'}</div>
          <div class="muted">${c.set_name || ''} ${c.collector_number ? '• ' + c.collector_number : ''}</div>
          <div class="muted">${c.condition || ''}</div>
          <div class="price">${c.price_value != null ? ('$' + Number(c.price_value).toFixed(2)) : '—'}</div>
          <a class="link" href="${c.pc_url}" target="_blank" rel="noreferrer">PriceCharting</a>
        </div>
      </div>`;
    grid.appendChild(el);
  }

  // Tümünü seç
  const selectAll = $('#selectAll');
  if (selectAll) {
    selectAll.checked = true;
    $$('#grid .sel').forEach((cb) => (cb.checked = true));
    selectAll.onchange = () =>
      $$('#grid .sel').forEach((cb) => (cb.checked = selectAll.checked));
  }
}

// -------- Binder --------
const PER_PAGE = 9;
let binderPage = 0;

function renderBinderSimple(cards) {
  const grid = $('#binderGrid');
  const info = $('#pageInfo');
  const empty = $('#binderEmpty');
  const prev = $('#prevBtn');
  const next = $('#nextBtn');

  if (!grid || !info || !empty || !prev || !next) return;

  if (!cards.length) {
    empty.style.display = '';
    grid.innerHTML = '';
    info.textContent = '';
    prev.disabled = next.disabled = true;
    return;
  }

  empty.style.display = 'none';

  const totalPages = Math.ceil(cards.length / PER_PAGE);
  binderPage = Math.max(0, Math.min(binderPage, totalPages - 1));

  const start = binderPage * PER_PAGE;
  const slice = cards.slice(start, start + PER_PAGE);

  grid.innerHTML = slice.map((c) => `
  <div class="slot">
    <div class="imgwrap">
    <img class="card"src="${imgSrc(c.image_url)}"data-raw="${c.image_url || ''}"onerror="onImgError(event)"></div>
    <div class="meta" style="font-size:12px;">
    <div class="meta-line" style="font-weight:900;">${c.name || ''}</div>
    <div class="meta-line" style="opacity:.8;">${c.set_name || ''} ${c.collector_number ? '• ' + c.collector_number : ''}</div>

      <div class="title" style="font-weight:900;">${c.name || ''}</div>
      <div class="line" style="opacity:.8;">
        ${c.set_name || ''} ${c.collector_number ? '• ' + c.collector_number : ''}
      </div>
      <div>${c.condition || ''}</div>
      <div style="font-weight:900; margin-top:4px">${c.price_value != null ? '$' + Number(c.price_value).toFixed(2) : '—'
    }</div>
    </div>
  </div>
`).join('');


  // boş slotları 9’a tamamla
  for (let i = slice.length; i < PER_PAGE; i++) grid.innerHTML += `<div class="slot"></div>`;

  info.textContent = `Sayfa ${binderPage + 1}/${totalPages} • Kartlar ${start + 1}-${start + slice.length
    }`;
  prev.disabled = binderPage === 0;
  next.disabled = binderPage >= totalPages - 1;

  prev.onclick = () => {
    binderPage = Math.max(0, binderPage - 1);
    renderBinderSimple(cards);
  };
  next.onclick = () => {
    binderPage = Math.min(totalPages - 1, binderPage + 1);
    renderBinderSimple(cards);
  };
}

async function loadProfiles() {
  const rows = await getJSON('/profiles');
  const sel = $('#profileSel');
  const saved = localStorage.getItem('profile') || 'default';
  sel.innerHTML = rows.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  if ([...sel.options].some(o => o.value === saved)) {
    sel.value = saved;
  } else {
    sel.value = 'default';
  }
}


async function refreshInbox() {
  const pid = $('#profileSel').value || 'default';
  const cards = await getJSON(`/inbox?profile=${encodeURIComponent(pid)}`);
  renderGrid(cards);
}
async function refreshBinder() {
  const pid = $('#profileSel').value || 'default';
  const bid = $('#binderSel').value || 'main';
  const cards = await getJSON(
    `/binder?profile=${encodeURIComponent(pid)}&binder=${encodeURIComponent(bid)}`
  );
  renderBinderSimple(cards);
}
async function refreshUI() {
  await Promise.all([refreshInbox(), refreshBinder()]);
}

// -------- Boot --------
async function boot() {
  try {
    console.log('[UI] boot');

    // Sekmeler
    $$('.tab').forEach((t) =>
      t.addEventListener('click', () => setActiveTab(t.dataset.tab))
    );

    // Profilleri yükle
    await loadProfiles();

    // Başlangıç durumu: GRID (Liste) boş kalsın, sadece BINDER’ı doldur.
    setActiveTab('grid');
    renderGrid([]); // başlangıçta boş göster
    await refreshBinder();

    $('#importBtn').addEventListener('click', async () => {
      const url = $('#urlInput').value.trim();
      const cookie = $('#cookieInput')?.value.trim();
      const profile = $('#profileSel').value || 'default';
      if (!url) return alert('Lütfen PriceCharting linkini yapıştır');

      localStorage.setItem('pc_url', url);
      if (cookie) localStorage.setItem('pc_cookie', cookie);
      $('#openPc').href = url;

      const btn = $('#importBtn');
      showLoading('Koleksiyon içe aktarılıyor…');
      spinBtn(btn, true);

      try {
        const r = await getJSON('/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, cookie, profile }),
        });
        await refreshInbox();
        setActiveTab('grid');
        toast(`İçe aktarılan: ${r.imported ?? 0}`);
      } catch (e) {
        alert('İçe aktarma hatası: ' + e.message);
      } finally {
        hideLoading();
        spinBtn(btn, false, 'Güncelle');
      }
    });


    $('#addToBinderBtn').addEventListener('click', async () => {
      const profile = $('#profileSel').value || 'default';
      const binder = $('#binderSel').value || 'main';
      const keys = $$('#grid .sel:checked').map(cb => cb.dataset.key).filter(Boolean);
      if (!keys.length) return alert('Hiç kart seçmedin.');

      showLoading('Binder’a ekleniyor…');

      try {
        await getJSON('/binder/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile, binder, cardKeys: keys }),
        });
        binderPage = 0;
        setActiveTab('binder');
        await refreshBinder();
        toast(`${keys.length} kart eklendi`);
      } catch (e) {
        alert('Binder ekleme hatası: ' + e.message);
      } finally {
        hideLoading();
      }
    });


    // Yeni profil
    $('#createProfileBtn').addEventListener('click', async () => {
      const name = prompt('Yeni profil adı:');
      if (!name) return;
      const r = await getJSON('/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await loadProfiles();
      $('#profileSel').value = r.id;
      localStorage.setItem('profile', r.id);
      // Yeni profilin inbox’ı boş; listeyi boşaltalım, binder’ı çekelim
      renderGrid([]);
      binderPage = 0;
      await refreshBinder();
    });

    // Değişimler
    $('#profileSel').addEventListener('change', async () => {
      localStorage.setItem('profile', $('#profileSel').value);
      // Profil değişince listeyi o profilin inbox’ı ile dolduracağız; binder da yenilensin
      binderPage = 0;
      await refreshUI();
    });
    $('#binderSel').addEventListener('change', async () => {
      binderPage = 0;
      await refreshBinder();
    });

  } catch (e) {
    console.error('[UI] boot error', e);
    $('#grid').innerHTML = `<div class="empty">Veri alınamadı.</div>`;
  }
}

boot();
