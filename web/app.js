// -------- API helper --------
const API = '/api';
async function getJSON(url, opts) {
  const r = await fetch(API + url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${API + url}`);
  return r.json();
}

// -------- DOM helpers --------
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// -------- img helpers --------
const preferBig = (u) => u ? u.replace(/\/(60|180)\.(jpg|png)(\?.*)?$/i, '/300.$2$3') : '';
const imgSrc = (u) => (u ? `${API}/img?u=${encodeURIComponent(preferBig(u))}` : '');

function onImgError(ev) {
  const img = ev?.target || ev;
  if (!img) return;
  let raw = '';
  try {
    const u = new URL(img.src, location.href);
    raw = u.searchParams.get('u') ? decodeURIComponent(u.searchParams.get('u')) : '';
  } catch {}
  raw ||= img.getAttribute('data-raw') || '';
  if (!raw) { img.style.display='none'; return; }
  // 300→180→60 düş
  if (/\/300\.(jpg|png)/i.test(raw)) { img.src = `${API}/img?u=${encodeURIComponent(raw.replace(/\/300\.(jpg|png)/i, '/180.$1'))}`; return; }
  if (/\/180\.(jpg|png)/i.test(raw)) { img.src = `${API}/img?u=${encodeURIComponent(raw.replace(/\/180\.(jpg|png)/i, '/60.$1'))}`;  return; }
  // bitti
  img.style.display='none';
}

// -------- Toast --------
const toast = (msg) => {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.style.display='block';
  setTimeout(()=>t.style.display='none', 2500);
};

// -------- State --------
let binderPage = 0;
const PER_PAGE = 9;

// -------- Binder UI --------
function renderBinderSimple(cards) {
  const grid = $('#binderGrid');
  const info = $('#pageInfo');
  const empty = $('#binderEmpty');
  const prev = $('#prevBtn');
  const next = $('#nextBtn');
  if (!grid || !info || !empty || !prev || !next) return;

  if (!cards.length) {
    empty.style.display='';
    grid.innerHTML='';
    info.textContent='';
    prev.disabled=next.disabled=true;
    return;
  }
  empty.style.display='none';

  const totalPages = Math.ceil(cards.length / PER_PAGE);
  binderPage = Math.max(0, Math.min(binderPage, totalPages - 1));
  const start = binderPage * PER_PAGE;
  const slice = cards.slice(start, start + PER_PAGE);

  grid.innerHTML = slice.map((c)=>`
    <div class="slot" style="display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:start;background:#0f1736;border:1px dashed #2a3568;border-radius:12px;padding:10px">
      <div class="imgwrap" style="width:120px;aspect-ratio:63/88;background:#0e152b;border-radius:8px;overflow:hidden;flex:0 0 auto">
        <img class="card" src="${imgSrc(c.image_url)}" data-raw="${c.image_url||''}" onerror="onImgError(event)" style="width:100%;height:100%;object-fit:contain;display:block">
      </div>
      <div class="meta" style="min-width:0">
        <div class="title" style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name||''}</div>
        <div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.set_name||''} ${c.collector_number?('• '+c.collector_number):''}</div>
        <div class="muted">${c.condition||''}</div>
        <div class="price" style="font-weight:900;margin-top:4px">${c.price_value!=null?('$'+Number(c.price_value).toFixed(2)):'—'}</div>
      </div>
    </div>
  `).join('');

  for (let i = slice.length; i < PER_PAGE; i++) grid.innerHTML += `<div class="slot"></div>`;

  info.textContent = `Sayfa ${binderPage + 1}/${totalPages} • Kartlar ${start + 1}-${start + slice.length}`;
  prev.disabled = binderPage === 0;
  next.disabled = binderPage >= totalPages - 1;
  prev.onclick = () => { binderPage = Math.max(0, binderPage - 1); renderBinderSimple(cards); };
  next.onclick = () => { binderPage = Math.min(totalPages - 1, binderPage + 1); renderBinderSimple(cards); };
}

async function refreshBinder() {
  const pid = $('#profileSel').value || 'default';
  const bid = $('#binderSel').value || 'main';
  const cards = await getJSON(`/binder?profile=${encodeURIComponent(pid)}&binder=${encodeURIComponent(bid)}`);
  renderBinderSimple(cards);
}

// -------- Import Modal logic --------
function openModal() {
  const modal = $('#importModal');
  if (!modal) return;
  modal.classList.add('is-open');
  document.body.classList.add('modal-open');
  modal.setAttribute('aria-hidden', 'false');
  window.requestAnimationFrame(() => {
    const panel = modal.querySelector('.modal__panel');
    panel?.focus?.();
  });
}

function closeModal() {
  const modal = $('#importModal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  const reset = () => {
    const grid = $('#importGrid');
    const count = $('#importCount');
    if (grid) grid.innerHTML = '';
    if (count) count.textContent = '0';
    const selAll = $('#selectAll');
    if (selAll) {
      selAll.checked = false;
      selAll.indeterminate = false;
    }
  };
  window.setTimeout(reset, 220);
}

function renderImportGrid(cards) {
  const grid = $('#importGrid');
  const count = $('#importCount');
  grid.innerHTML = '';

  const syncSelectionHighlight = () => {
    $$('#importGrid .card').forEach(card => {
      const checkbox = card.querySelector('.sel');
      if (checkbox) card.classList.toggle('is-selected', checkbox.checked);
    });
  };

  grid.onchange = (ev) => {
    const target = ev.target;
    if (!target || typeof target.matches !== 'function' || !target.matches('.sel')) return;
    const selectAllInput = $('#selectAll');
    if (selectAllInput) {
      const checkboxes = $$('#importGrid .sel');
      const allChecked = checkboxes.every(cb => cb.checked);
      const someChecked = checkboxes.some(cb => cb.checked);
      selectAllInput.checked = allChecked;
      selectAllInput.indeterminate = !allChecked && someChecked;
    }
    syncSelectionHighlight();
  };

  if (!cards.length) {
    grid.innerHTML = '<div class="empty">Gösterilecek kart yok.</div>';
    count.textContent = '0';
    return;
  }
  count.textContent = String(cards.length);

  for (const c of cards) {
    const key = c.pc_item_id || c.pc_url;
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="row">
        <input type="checkbox" class="sel" data-key="${key}">
        <img class="thumb" src="${imgSrc(c.image_url)}" data-raw="${c.image_url||''}" onerror="onImgError(event)">
        <div>
          <div class="title">${c.name || '—'}</div>
          <div class="muted">${c.set_name||''} ${c.collector_number?('• '+c.collector_number):''}</div>
          <div class="muted">${c.condition||''}</div>
          <div class="price">${c.price_value!=null?('$'+Number(c.price_value).toFixed(2)):'—'}</div>
          <a class="link" href="${c.pc_url}" target="_blank" rel="noreferrer">PriceCharting</a>
        </div>
      </div>`;
    grid.appendChild(el);
  }

  const selectAll = $('#selectAll');
  if (selectAll) {
    selectAll.checked = true;
    selectAll.indeterminate = false;
    $$('#importGrid .sel').forEach(cb => (cb.checked = true));
    selectAll.onchange = () => {
      $$('#importGrid .sel').forEach(cb => {
        cb.checked = selectAll.checked;
      });
      selectAll.indeterminate = false;
      syncSelectionHighlight();
    };
  }

  syncSelectionHighlight();
}

// -------- Boot --------
async function loadProfiles() {
  const rows = await getJSON('/profiles');
  const sel = $('#profileSel');
  const saved = localStorage.getItem('profile') || 'default';
  sel.innerHTML = rows.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  sel.value = rows.some(r=>r.id===saved) ? saved : (rows[0]?.id || 'default');
}

async function boot() {
  try {
    await loadProfiles();
    await refreshBinder();

    // Profil / Binder değişimleri sadece binder'ı yenilesin
    $('#profileSel').addEventListener('change', async () => {
      localStorage.setItem('profile', $('#profileSel').value);
      binderPage = 0;
      await refreshBinder(); // Liste modali yok, sadece binder
    });
    $('#binderSel').addEventListener('change', async () => {
      binderPage = 0;
      await refreshBinder();
    });

    // Yeni profil
    $('#createProfileBtn').addEventListener('click', async () => {
      const name = prompt('Yeni profil adı:');
      if (!name) return;
      const r = await getJSON('/profiles', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name })
      });
      await loadProfiles();
      $('#profileSel').value = r.id;
      localStorage.setItem('profile', r.id);
      binderPage = 0;
      await refreshBinder();
    });

    // Güncelle → import et ve modal aç
    $('#importBtn').addEventListener('click', async () => {
      const url = $('#urlInput').value.trim();
      const cookie = $('#cookieInput')?.value.trim();
      const profile = $('#profileSel').value || 'default';
      if (!url) return alert('Lütfen PriceCharting linkini yapıştır');

      // kaynak linkini set et
      $('#openPc').href = url;

      // butonda mini spinner
      const btn = $('#importBtn');
      const prev = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span style="display:inline-block;width:16px;height:16px;border:2px solid #1f2b56;border-top-color:#fff;border-radius:50%;vertical-align:-2px;margin-right:8px;animation:spin .8s linear infinite"></span> Çalışıyor…`;

      try {
        const r = await getJSON('/import', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ url, cookie, profile })
        });
        // import sonrası inbox'ı çek ve modalda göster
        const cards = await getJSON(`/inbox?profile=${encodeURIComponent(profile)}`);
        renderImportGrid(cards);
        openModal();
        toast(`İçe aktarılan: ${r.imported ?? 0}`);
      } catch (e) {
        alert('İçe aktarma hatası: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });

    // Modal: kapat
    $('#closeModalBtn').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      const modalEl = $('#importModal');
      if (modalEl?.classList?.contains('is-open')) {
        ev.preventDefault();
        closeModal();
      }
    });

    // Modal: seçileni binder’a ekle
    $('#addToBinderBtn').addEventListener('click', async () => {
      const profile = $('#profileSel').value || 'default';
      const binder  = $('#binderSel').value || 'main';
      const keys = $$('#importGrid .sel:checked').map(cb => cb.dataset.key).filter(Boolean);
      if (!keys.length) return alert('Hiç kart seçmedin.');

      const btn = $('#addToBinderBtn');
      const prev = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span style="display:inline-block;width:16px;height:16px;border:2px solid #1f2b56;border-top-color:#fff;border-radius:50%;vertical-align:-2px;margin-right:8px;animation:spin .8s linear infinite"></span> Ekleniyor…`;

      try {
        await getJSON('/binder/add', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ profile, binder, cardKeys: keys })
        });
        binderPage = 0;
        await refreshBinder();
        toast(`${keys.length} kart eklendi`);
        // MODAL’I TEMİZLE & KAPAT
        closeModal();
      } catch (e) {
        alert('Binder ekleme hatası: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });

  } catch (e) {
    console.error('[UI] boot error', e);
    alert('Önyükleme hatası: ' + (e.message || e));
  }
}

boot();
