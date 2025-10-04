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

  const localSrc = img.getAttribute('data-local') || '';
  const remoteSrc = img.getAttribute('data-remote') || '';
  const rawAttr = img.getAttribute('data-raw') || '';

  if (localSrc && img.src === localSrc && img.dataset.localTried !== '1') {
    img.dataset.localTried = '1';
    if (remoteSrc) {
      img.src = remoteSrc;
      return;
    }
  }

  if (remoteSrc && img.src !== remoteSrc && img.dataset.remoteTried !== '1') {
    img.dataset.remoteTried = '1';
    img.src = remoteSrc;
    return;
  }
  if (remoteSrc && img.src === remoteSrc) {
    img.dataset.remoteTried = '1';
  }

  let raw = rawAttr;
  if (!raw && remoteSrc) {
    try {
      const u = new URL(remoteSrc, location.href);
      raw = u.searchParams.get('u') ? decodeURIComponent(u.searchParams.get('u')) : '';
    } catch {}
  }

  if (!raw) {
    img.style.display = 'none';
    return;
  }

  if (!img.dataset.baseRaw) img.dataset.baseRaw = raw;
  const base = img.dataset.baseRaw;
  let step = Number(img.dataset.fallbackStep || '0');
  const variants = [base];
  if (/\/300\.(jpg|png)(\?|$)/i.test(base)) {
    variants.push(base.replace('/300.', '/180.'));
    variants.push(base.replace('/300.', '/60.'));
  } else if (/\/180\.(jpg|png)(\?|$)/i.test(base)) {
    variants.push(base.replace('/180.', '/300.'));
    variants.push(base.replace('/180.', '/60.'));
  } else if (/\/60\.(jpg|png)(\?|$)/i.test(base)) {
    variants.push(base.replace('/60.', '/180.'));
    variants.push(base.replace('/60.', '/300.'));
  }

  if (step >= variants.length) {
    img.style.display = 'none';
    return;
  }

  img.dataset.fallbackStep = String(step + 1);
  const nextRaw = variants[step];
  img.src = `${API}/img?u=${encodeURIComponent(nextRaw)}`;
}

if (typeof window !== 'undefined') {
  window.onImgError = onImgError;
}

// -------- Toast --------
const toast = (msg) => {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.style.display='block';
  setTimeout(()=>t.style.display='none', 2500);
};

// -------- State --------
const PER_PAGE = 9;

const binderState = {
  all: [],
  filtered: [],
  page: 0,
  query: '',
  edit: false,
};

const binderEmptyDefault = $('#binderEmpty')?.innerHTML || '';

const htmlEscape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attrEscape = (value) => htmlEscape(value).replace(/"/g, '&quot;');
const makeCardKey = (card = {}) => {
  const id = card?.pc_item_id || card?.pc_url || '';
  const price = card?.price_value ?? '';
  return `${id}|${price}`;
};

function normalizeBinderCard(card, idx) {
  const key = card?.binderKey || card?.binder_key || card?.card_key || card?.pc_item_id || card?.pc_url || `card-${idx}`;
  return {
    ...card,
    binderKey: key,
    count: Math.max(1, Number(card?.count ?? card?.quantity ?? 1) || 1),
    sortOrder: Number(card?.sortOrder ?? card?.sort_order ?? idx)
  };
}

function updateBinderEditUi() {
  const btn = $('#toggleEditBtn');
  if (btn) btn.textContent = binderState.edit ? 'Duzenlemeyi Bitir' : 'Duzenle';
  document.body.classList.toggle('binder-edit', binderState.edit);
}

function binderSetData(cards, { keepPage = false } = {}) {
  const normalized = Array.isArray(cards) ? cards.map((card, idx) => normalizeBinderCard(card, idx)) : [];
  normalized.sort((a, b) => a.sortOrder - b.sortOrder);
  binderState.all = normalized;
  if (!binderState.all.length && binderState.edit) {
    binderState.edit = false;
    updateBinderEditUi();
  }
  applyBinderFilter(!keepPage);
}

function applyBinderFilter(resetPage = false) {
  const query = (binderState.query || '').trim().toLowerCase();
  binderState.filtered = !query
    ? binderState.all.slice()
    : binderState.all.filter(card => {
        return [
          card.name,
          card.set_name,
          card.collector_number,
          card.condition
        ].some(value => (value || '').toString().toLowerCase().includes(query));
      });

  const totalPages = Math.max(1, Math.ceil(Math.max(binderState.filtered.length, 1) / PER_PAGE));
  binderState.page = resetPage ? 0 : Math.min(binderState.page, totalPages - 1);
  renderBinder();
}

function binderSetQuery(value) {
  binderState.query = value ?? '';
  applyBinderFilter(true);
}

function binderChangePage(delta) {
  if (!delta) return;
  const totalPages = Math.max(1, Math.ceil(Math.max(binderState.filtered.length, 1) / PER_PAGE));
  const nextPage = Math.min(Math.max(binderState.page + delta, 0), totalPages - 1);
  if (nextPage === binderState.page) return;
  binderState.page = nextPage;
  renderBinder();
}

function binderSetEdit(flag) {
  binderState.edit = Boolean(flag);
  updateBinderEditUi();
  renderBinder();
}

function binderCardHTML(card) {
  const key = attrEscape(card.binderKey || '');
  const countBadge = card.count > 1 ? `<span class="count-badge">x${card.count}</span>` : '';
  const extraInfo = !binderState.edit && card.count > 1 ? `<div class="muted">Adet: ${card.count}</div>` : '';
  const editControls = !binderState.edit ? '' : `
        <div class="edit-controls" data-key="${key}">
          <button class="btn-ghost" data-action="move-prev" data-key="${key}" title="Bir onceki siraya tasi">&lt;</button>
          <button class="btn-ghost" data-action="move-next" data-key="${key}" title="Bir sonraki siraya tasi">&gt;</button>
          <div class="qty-control">
            <button class="btn-ghost" data-action="qty-minus" data-key="${key}" title="Adedi azalt">-</button>
            <button class="btn-ghost qty-display" data-action="qty-set" data-key="${key}" title="Adedi duzenle">${card.count}</button>
            <button class="btn-ghost" data-action="qty-plus" data-key="${key}" title="Adedi artir">+</button>
          </div>
          <button class="btn-ghost danger" data-action="remove" data-key="${key}" title="Karti sil">Sil</button>
        </div>
  `;

  const rawImage = card.image_url || '';
  const remoteSrc = imgSrc(rawImage);
  const localSrc = card.master_id ? `${API}/img-local/${encodeURIComponent(String(card.master_id))}` : '';
  const primarySrc = localSrc || remoteSrc;
  const displaySrc = attrEscape(primarySrc);
  const safeRemote = attrEscape(remoteSrc);
  const safeLocal = attrEscape(localSrc);
  const safeRaw = attrEscape(rawImage);
  const titleText = htmlEscape(card.name || '');
  const setLine = htmlEscape(card.set_name || '');
  const collector = card.collector_number ? ' #' + htmlEscape(card.collector_number) : '';
  const condition = htmlEscape(card.condition || '');
  const priceText = card.price_value != null ? ('$' + Number(card.price_value).toFixed(2)) : '&mdash;';

  return `
    <div class="slot" data-key="${key}" style="display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:flex-start;background:#0f1736;border:1px dashed #2a3568;border-radius:12px;padding:12px;position:relative">
      <div class="imgwrap">
        <img class="card" src="${displaySrc}" data-raw="${safeRaw}" data-remote="${safeRemote}" data-local="${safeLocal}" onerror="onImgError(event)" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block">
        ${countBadge}
      </div>
      <div class="meta" style="min-width:0;display:flex;flex-direction:column;gap:4px;">
        <div class="title" style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${titleText}</div>
        <div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${setLine}${collector}</div>
        <div class="muted">${condition}</div>
        <div class="price" style="font-weight:900;margin-top:4px">${priceText}</div>
        ${extraInfo}
        ${editControls}
      </div>
    </div>
  `;
}


function renderBinder() {
  const grid = $('#binderGrid');
  const info = $('#pageInfo');
  const empty = $('#binderEmpty');
  const prev = $('#prevBtn');
  const next = $('#nextBtn');
  if (!grid || !info || !empty || !prev || !next) return;

  const total = binderState.filtered.length;
  if (!total) {
    empty.style.display = '';
    if (binderState.query) {
      empty.innerHTML = `"<strong>${htmlEscape(binderState.query)}</strong>" icin kart bulunamadi.`;
    } else {
      empty.innerHTML = binderEmptyDefault;
    }
    grid.innerHTML = '';
    info.textContent = '';
    prev.disabled = true;
    next.disabled = true;
    return;
  }

  empty.style.display = 'none';

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  binderState.page = Math.max(0, Math.min(binderState.page, totalPages - 1));
  const start = binderState.page * PER_PAGE;
  const slice = binderState.filtered.slice(start, Math.min(start + PER_PAGE, total));

  grid.innerHTML = slice.map(binderCardHTML).join('');
  for (let i = slice.length; i < PER_PAGE; i++) {
    grid.innerHTML += '<div class="slot slot--empty"></div>';
  }

  let summary = `Sayfa ${binderState.page + 1}/${totalPages} - Kartlar ${start + 1}-${start + slice.length} - Toplam ${total}`;
  if (binderState.query) {
    summary += ` - Arama: "${binderState.query}"`;
  }
  info.textContent = summary;
  prev.disabled = binderState.page === 0;
  next.disabled = binderState.page >= totalPages - 1;
}

let binderBusy = false;

async function refreshBinder(options = {}) {
  const { keepPage = false } = options;
  const pid = $('#profileSel').value || 'default';
  const bid = $('#binderSel').value || 'main';
  try {
    const cards = await getJSON(`/binder?profile=${encodeURIComponent(pid)}&binder=${encodeURIComponent(bid)}`);
    binderSetData(Array.isArray(cards) ? cards : [], { keepPage });
  } catch (e) {
    console.error('[binder] fetch error', e);
    alert('Binder yuklenemedi: ' + e.message);
  }
}

const binderAction = (path, payload = {}) => {
  const profile = $('#profileSel').value || 'default';
  const binder = $('#binderSel').value || 'main';
  return getJSON(`/binder/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, binder, ...payload })
  });
};

async function binderRemove(keys) {
  if (!Array.isArray(keys) || !keys.length || binderBusy) return;
  binderBusy = true;
  try {
    await binderAction('remove', { cardKeys: keys });
    toast(keys.length === 1 ? 'Kart silindi' : `${keys.length} kart silindi`);
    await refreshBinder({ keepPage: true });
  } catch (e) {
    console.error('[binder] remove', e);
    alert('Kart silme hatasi: ' + e.message);
  } finally {
    binderBusy = false;
  }
}

async function binderSetCount(key, nextCount) {
  if (!key || binderBusy) return;
  const card = binderState.all.find(c => c.binderKey === key);
  if (!card) return;
  const normalized = Math.max(0, Math.round(Number(nextCount)));
  if (!Number.isFinite(normalized) || normalized === card.count) return;
  binderBusy = true;
  try {
    await binderAction('update-count', { cardKey: key, count: normalized });
    toast(normalized <= 0 ? 'Kart silindi' : 'Adet guncellendi');
    await refreshBinder({ keepPage: true });
  } catch (e) {
    console.error('[binder] update-count', e);
    alert('Adet guncelleme hatasi: ' + e.message);
  } finally {
    binderBusy = false;
  }
}

function binderAdjustCount(key, delta) {
  if (!delta) return;
  const card = binderState.all.find(c => c.binderKey === key);
  if (!card) return;
  binderSetCount(key, card.count + delta);
}

async function binderMove(key, delta) {
  if (!key || !delta || binderBusy) return;
  const index = binderState.all.findIndex(c => c.binderKey === key);
  if (index === -1) return;
  const target = index + delta;
  if (target < 0 || target >= binderState.all.length) return;
  const reordered = binderState.all.slice();
  const [item] = reordered.splice(index, 1);
  reordered.splice(target, 0, item);
  binderState.all = reordered;
  binderState.page = Math.floor(target / PER_PAGE);
  applyBinderFilter(false);

  binderBusy = true;
  try {
    await binderAction('reorder', { order: binderState.all.map(c => c.binderKey) });
    toast('Siralama guncellendi');
    await refreshBinder({ keepPage: true });
  } catch (e) {
    console.error('[binder] reorder', e);
    alert('Siralama hatasi: ' + e.message);
    await refreshBinder({ keepPage: true });
  } finally {
    binderBusy = false;
  }
}

async function binderAutoSort() {
  if (binderBusy || !binderState.all.length) return;
  const btn = $('#autoSortBtn');
  const original = btn?.textContent;
  binderBusy = true;
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Siralaniyor...';
    }
    await binderAction('auto-sort', {});
    toast('Seri siralamasi tamamlandi');
    await refreshBinder();
  } catch (e) {
    console.error('[binder] auto-sort', e);
    alert('Otomatik siralama hatasi: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original || 'Seriye Gore Sirala';
    }
    binderBusy = false;
  }
}

function binderGridClickHandler(ev) {
  const target = ev.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const key = target.dataset.key;
  if (!key) return;
  if (action === 'remove') {
    binderRemove([key]);
  } else if (action === 'move-prev') {
    binderMove(key, -1);
  } else if (action === 'move-next') {
    binderMove(key, 1);
  } else if (action === 'qty-minus') {
    binderAdjustCount(key, -1);
  } else if (action === 'qty-plus') {
    binderAdjustCount(key, 1);
  } else if (action === 'qty-set') {
    const card = binderState.all.find(c => c.binderKey === key);
    const current = card?.count ?? 1;
    const input = prompt('Yeni adet:', current);
    if (input == null) return;
    const value = Number(input);
    if (!Number.isFinite(value)) {
      alert('Gecerli bir sayi gir.');
      return;
    }
    binderSetCount(key, value);
  }
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
    grid.innerHTML = '<div class="empty">GÃ¶sterilecek kart yok.</div>';
    count.textContent = '0';
    return;
  }
  count.textContent = String(cards.length);

  for (const c of cards) {
    const key = c.card_key || makeCardKey(c);
    const safeKey = attrEscape(key);
    const rawImage = c.image_url || '';
    const remoteSrc = imgSrc(rawImage);
    const localSrc = c.master_id ? `${API}/img-local/${encodeURIComponent(String(c.master_id))}` : '';
    const primarySrc = localSrc || remoteSrc;
    const displaySrc = attrEscape(primarySrc);
    const safeRemote = attrEscape(remoteSrc);
    const safeLocal = attrEscape(localSrc);
    const dataRaw = attrEscape(rawImage);
    const name = htmlEscape(c.name || '-');
    const setName = htmlEscape(c.set_name || '');
    const collector = c.collector_number ? ' #' + htmlEscape(c.collector_number) : '';
    const condition = htmlEscape(c.condition || '');
    const priceText = c.price_value != null ? `$${Number(c.price_value).toFixed(2)}` : '-';
    const price = htmlEscape(priceText);
    const pcLink = attrEscape(c.pc_url || '');
    const el = document.createElement('div');
    c.card_key = key;
    el.className = 'card import-card';
    el.innerHTML = `
      <input type="checkbox" class="sel" data-key="${safeKey}">
      <div class="import-card__figure">
        <img class="thumb" src="${displaySrc}" data-raw="${dataRaw}" data-remote="${safeRemote}" data-local="${safeLocal}" onerror="onImgError(event)">
      </div>
      <div class="import-card__meta">
        <div class="title">${name}</div>
        <div class="muted">${setName}${collector}</div>
        <div class="muted">${condition}</div>
        <div class="price">${price}</div>
        <a class="link" href="${pcLink}" target="_blank" rel="noreferrer">PriceCharting</a>
      </div>
    `;
    grid.appendChild(el);
    const checkbox = el.querySelector('.sel');
    if (checkbox) checkbox.dataset.key = key;
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
    updateBinderEditUi();

    const binderSearch = $('#binderSearch');
    if (binderSearch) binderSearch.addEventListener('input', (ev) => binderSetQuery(ev.target.value));

    const toggleEditBtn = $('#toggleEditBtn');
    if (toggleEditBtn) toggleEditBtn.addEventListener('click', () => binderSetEdit(!binderState.edit));

    const autoSortBtn = $('#autoSortBtn');
    if (autoSortBtn) autoSortBtn.addEventListener('click', binderAutoSort);

    const binderGrid = $('#binderGrid');
    if (binderGrid) binderGrid.addEventListener('click', binderGridClickHandler);

    const prevBtn = $('#prevBtn');
    const nextBtn = $('#nextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => binderChangePage(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => binderChangePage(1));

    await refreshBinder();

    $('#profileSel').addEventListener('change', async () => {
      localStorage.setItem('profile', $('#profileSel').value);
      binderState.page = 0;
      binderState.query = '';
      if (binderSearch) binderSearch.value = '';
      if (binderState.edit) {
        binderState.edit = false;
        updateBinderEditUi();
      } else {
        updateBinderEditUi();
      }
      await refreshBinder();
    });
    $('#binderSel').addEventListener('change', async () => {
      binderState.page = 0;
      binderState.query = '';
      if (binderSearch) binderSearch.value = '';
      if (binderState.edit) {
        binderState.edit = false;
        updateBinderEditUi();
      }
      await refreshBinder();
    });

    $('#createProfileBtn').addEventListener('click', async () => {
      const name = prompt('Yeni profil adi:');
      if (!name) return;
      const r = await getJSON('/profiles', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name })
      });
      await loadProfiles();
      $('#profileSel').value = r.id;
      localStorage.setItem('profile', r.id);
      binderState.page = 0;
      binderState.query = '';
      if (binderSearch) binderSearch.value = '';
      if (binderState.edit) {
        binderState.edit = false;
        updateBinderEditUi();
      }
      await refreshBinder();
    });

    $('#importBtn').addEventListener('click', async () => {
      const url = $('#urlInput').value.trim();
      const cookie = $('#cookieInput')?.value.trim();
      const profile = $('#profileSel').value || 'default';
      if (!url) return alert('Lutfen PriceCharting linkini yapistir');

      $('#openPc').href = url;

      const btn = $('#importBtn');
      const prev = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span style="display:inline-block;width:16px;height:16px;border:2px solid #1f2b56;border-top-color:#fff;border-radius:50%;vertical-align:-2px;margin-right:8px;animation:spin .8s linear infinite"></span> Calisiyor...`;

      try {
        const r = await getJSON('/import', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ url, cookie, profile })
        });
        const cards = await getJSON(`/inbox?profile=${encodeURIComponent(profile)}`);
        renderImportGrid(cards);
        openModal();
        toast(`Ice aktarilan: ${r.imported ?? 0}`);
      } catch (e) {
        alert('Ice aktarma hatasi: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });

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

    $('#addToBinderBtn').addEventListener('click', async () => {
      const profile = $('#profileSel').value || 'default';
      const binder  = $('#binderSel').value || 'main';
      const keys = $$('#importGrid .sel:checked').map(cb => cb.dataset.key).filter(Boolean);
      if (!keys.length) return alert('Hic kart secmedin.');

      const btn = $('#addToBinderBtn');
      const prev = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span style="display:inline-block;width:16px;height:16px;border:2px solid #1f2b56;border-top-color:#fff;border-radius:50%;vertical-align:-2px;margin-right:8px;animation:spin .8s linear infinite"></span> Ekleniyor...`;

      try {
        await getJSON('/binder/add', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ profile, binder, cardKeys: keys })
        });
        binderState.page = 0;
        await refreshBinder();
        toast(`${keys.length} kart eklendi`);
        closeModal();
      } catch (e) {
        alert('Binder ekleme hatasi: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });

  } catch (e) {
    console.error('[UI] boot error', e);
    alert('Onyukleme hatasi: ' + (e.message || e));
  }
}

boot();







