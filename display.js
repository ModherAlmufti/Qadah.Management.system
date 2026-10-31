/* ============================================================
   قدّاح — عرض الأصناف للعملاء: ترتيب العرض + الألوان + الشريط المتحرك
   ملف مستقل مثل gallery.js و delivery.js.
   القراءة: product_colors + product_display. الكتابة عبر دوال القاعدة:
     set_products_order  (المدير ومسؤول الأسعار)
     set_product_banner  (المدير ومسؤول الأسعار)
     set_product_colors  (المدير ومسؤول الأسعار والمورد على منتجاته)
   قائمة الألوان نفسها: إضافة/تعديل للمدير ومسؤول الأسعار، حذف للمدير (RLS).
============================================================ */
(function(){
  const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const say = m => (window.toast ? window.toast(m) : alert(m));
  const D = { colors: [], map: {}, ready: false, missing: false };

  let css = false;
  function injectCSS(){
    if(css) return; css = true;
    const s = document.createElement('style');
    s.textContent = `
    .qd-sw{display:inline-block;width:16px;height:16px;border-radius:50%;border:1px solid rgba(1,24,58,.18);vertical-align:middle;flex-shrink:0}
    .qd-sw.mix{background:conic-gradient(#c62828,#f2c94c,#4caf50,#4a74c9,#8e5bb5,#e991a8,#c62828)}
    .qd-swatches{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
    .qd-swatches .qd-sw{width:14px;height:14px}
    .qd-pos{position:absolute;top:12px;left:12px;z-index:2;background:rgba(1,24,58,.82);color:#fdf6ec;font-size:11px;font-weight:800;padding:2px 8px;border-radius:10px}
    .qd-banner-b{align-self:flex-start;border:1px dashed var(--line);background:var(--surface);color:var(--ink-soft);font-family:inherit;font-size:12px;font-weight:700;padding:4px 10px;border-radius:14px;cursor:pointer}
    .qd-banner-b.on{background:var(--navy);border:1px solid var(--navy);color:#fdf6ec}
    .qd-banner-b:disabled{cursor:default}
    /* القائمة المنسدلة للألوان */
    .qd-dd{position:relative}
    .qd-dd-btn{width:100%;min-height:44px;padding:8px 14px;border:1px solid var(--line);border-radius:10px;background:var(--bg);font-family:inherit;font-size:15px;color:var(--ink);display:flex;align-items:center;gap:8px;cursor:pointer;text-align:right}
    .qd-dd-btn:disabled{opacity:.55;cursor:not-allowed}
    .qd-dd-btn .ph{color:var(--ink-soft)}
    .qd-dd-btn .car{margin-inline-start:auto;color:var(--ink-soft)}
    .qd-dd-btn .sel{display:flex;flex-wrap:wrap;gap:6px}
    .qd-dd-btn .sel span{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:700;background:var(--surface);border:1px solid var(--line);padding:2px 8px 2px 10px;border-radius:12px}
    .qd-dd-panel{position:absolute;top:calc(100% + 4px);right:0;left:0;z-index:40;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-lg);max-height:280px;overflow:auto;padding:6px}
    .qd-dd-panel label{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;cursor:pointer;font-size:14px;font-weight:700}
    .qd-dd-panel label:hover{background:var(--bg)}
    .qd-dd-panel input{width:18px;height:18px;accent-color:var(--navy)}
    .qd-dd-panel .off{color:var(--ink-soft);font-weight:500;font-size:12px}
    .qd-dd-foot{border-top:1px solid var(--line);margin-top:4px;padding:8px 10px 4px;display:flex;justify-content:space-between;gap:8px}
    .qd-dd-foot button{border:none;background:none;font-family:inherit;font-weight:700;font-size:13px;color:var(--navy);cursor:pointer;padding:4px}
    /* نافذة الترتيب */
    .qd-list{display:flex;flex-direction:column;gap:6px}
    .qd-row{display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:6px 8px;user-select:none}
    .qd-row.drag{opacity:.55;border-style:dashed}
    .qd-row .h{cursor:grab;touch-action:none;font-size:20px;color:var(--ink-soft);padding:6px 8px;line-height:1}
    .qd-row .n{width:28px;text-align:center;font-weight:800;color:var(--accent);font-size:14px}
    .qd-row img{width:44px;height:44px;border-radius:8px;object-fit:cover;background:var(--card)}
    .qd-row .t{flex:1;min-width:0}
    .qd-row .t b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .qd-row .t small{color:var(--ink-soft);font-size:12px}
    .qd-row .mv{display:flex;gap:4px}
    .qd-row .mv button{width:32px;height:32px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;font-size:13px;color:var(--ink)}
    .qd-row .mv button:disabled{opacity:.3;cursor:default}
    .qd-ban{font-size:11px;font-weight:800;background:var(--navy);color:#fdf6ec;padding:1px 7px;border-radius:9px;margin-inline-start:6px}
    /* إدارة الألوان */
    .qd-ctab{width:100%;border-collapse:collapse}
    .qd-ctab td,.qd-ctab th{padding:8px 6px;border-bottom:1px solid var(--line);font-size:14px;text-align:right;vertical-align:middle}
    .qd-ctab th{font-size:12px;color:var(--ink-soft)}
    .qd-ctab input[type=text]{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:14px;background:var(--bg)}
    .qd-ctab input[type=color]{width:40px;height:34px;border:1px solid var(--line);border-radius:8px;padding:2px;background:var(--surface);cursor:pointer}
    .qd-ctab .act{display:flex;gap:4px;white-space:nowrap}
    .qd-ctab .act button{min-width:32px;height:32px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;font-family:inherit;font-size:13px;font-weight:700}
    .qd-ctab .act .del{color:var(--danger)}
    .qd-ctab tr.hid td{opacity:.6}
    .qd-mixl{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--ink-soft);white-space:nowrap}
    @media(max-width:600px){.qd-row .mv .far{display:none}.qd-ctab .en-col{display:none}}`;
    document.head.appendChild(s);
  }

  function errAr(e){
    const m = (e && e.message) || '';
    if(/does not exist|schema cache|Could not find/i.test(m)) return 'ملف SQL الخاص بالترتيب والألوان لم يُشغَّل بعد في Supabase';
    if(m.includes('not authorized')) return 'ليست لديك صلاحية لهذا التعديل';
    if(m.includes('ids must not repeat')||m.includes('unknown product')) return 'تغيّرت قائمة الأصناف من جهاز آخر، أعد فتح النافذة';
    if(m.includes('unknown color')) return 'أحد الألوان حُذف من القائمة، أعد فتح النافذة';
    if(m.includes('duplicate')||m.includes('product_colors_name_key')) return 'يوجد لون بنفس الاسم';
    if(m.includes('hex')) return 'رمز اللون غير صحيح';
    if(m.includes('row-level security')||m.includes('permission')) return 'ليست لديك صلاحية لهذا التعديل';
    return m || 'حدث خطأ';
  }

  /* ---------- التحميل ---------- */
  async function load(sb){
    injectCSS();
    const [c, d] = await Promise.all([
      sb.from('product_colors').select('*').order('sort_order').order('name_ar'),
      sb.from('product_display').select('product_id,sort_order,in_banner,color_ids')
    ]);
    D.missing = !!(c.error || d.error);
    if(D.missing){ console.warn('display tables', c.error || d.error); }
    D.colors = c.data || [];
    D.map = {};
    (d.data || []).forEach(r => D.map[r.product_id] = r);
    D.ready = true;
  }
  const row = id => D.map[id] || null;
  function sortKey(p){ const r = row(p.id); return r ? r.sort_order : 1000000 + (p.code || 0); }
  const colorIds = id => (row(id) && row(id).color_ids) || [];
  const inBanner = id => !!(row(id) && row(id).in_banner);
  const colorById = id => D.colors.find(c => c.id === id);

  function swatch(c, title){
    if(!c) return '';
    const t = esc(title || c.name_ar);
    if(!c.hex) return `<span class="qd-sw mix" title="${t}"></span>`;
    return `<span class="qd-sw" style="background:${esc(c.hex)}" title="${t}"></span>`;
  }
  function swatchesHTML(productId){
    const list = colorIds(productId).map(colorById).filter(Boolean);
    if(!list.length) return '';
    return `<div class="qd-swatches" title="${esc(list.map(c=>c.name_ar).join('، '))}">${list.map(c=>swatch(c)).join('')}</div>`;
  }
  /* رقم ترتيب الصنف بين الأصناف المعروضة (1 = أول صنف يراه العميل) */
  function positionOf(p, liveList){
    const sorted = liveList.slice().sort((a,b)=>sortKey(a)-sortKey(b) || (a.code||0)-(b.code||0));
    const i = sorted.findIndex(x => x.id === p.id);
    return i < 0 ? null : i + 1;
  }

  /* ---------- الشريط ---------- */
  async function setBanner(sb, productId, on){
    const {error} = await sb.rpc('set_product_banner', {p_product_id: productId, p_on: !!on});
    if(error){ say(errAr(error)); return false; }
    D.map[productId] = Object.assign({product_id: productId, sort_order: 0, color_ids: []}, D.map[productId] || {}, {in_banner: !!on});
    return true;
  }
  async function saveColors(sb, productId, ids){
    const {error} = await sb.rpc('set_product_colors', {p_product_id: productId, p_color_ids: ids});
    if(error){ say(errAr(error)); return false; }
    const ordered = D.colors.filter(c => ids.includes(c.id)).map(c => c.id);
    D.map[productId] = Object.assign({product_id: productId, sort_order: 0, in_banner: false}, D.map[productId] || {}, {color_ids: ordered});
    return true;
  }

  /* ---------- القائمة المنسدلة لاختيار الألوان ---------- */
  function mountColorPicker(box, opts){
    injectCSS();
    const sel = new Set(opts.selected || []);
    const disabled = !!opts.disabled;
    box.innerHTML = `<div class="qd-dd"><button type="button" class="qd-dd-btn" ${disabled?'disabled':''} aria-haspopup="listbox" aria-expanded="false"></button></div>`;
    const dd = box.firstChild, btn = dd.firstChild;
    function paint(){
      const list = D.colors.filter(c => sel.has(c.id));
      btn.innerHTML = (list.length
        ? `<span class="sel">${list.map(c=>`<span>${swatch(c)}${esc(c.name_ar)}</span>`).join('')}</span>`
        : `<span class="ph">${D.colors.length ? 'اختر لوناً أو أكثر' : 'لا توجد ألوان في القائمة بعد'}</span>`) + '<span class="car">▾</span>';
    }
    function close(){ const p = dd.querySelector('.qd-dd-panel'); if(p) p.remove(); btn.setAttribute('aria-expanded','false'); document.removeEventListener('pointerdown', outside, true); }
    function outside(e){ if(!dd.contains(e.target)) close(); }
    function open(){
      if(disabled || dd.querySelector('.qd-dd-panel')) { close(); return; }
      const p = document.createElement('div');
      p.className = 'qd-dd-panel'; p.setAttribute('role','listbox'); p.setAttribute('aria-multiselectable','true');
      const visible = D.colors.filter(c => c.is_active || sel.has(c.id));
      p.innerHTML = (visible.length ? visible.map(c => `<label><input type="checkbox" value="${c.id}" ${sel.has(c.id)?'checked':''}>${swatch(c)}<span>${esc(c.name_ar)}</span>${c.is_active?'':'<span class="off">(مخفي)</span>'}</label>`).join('')
          : '<div class="hint" style="padding:10px">لا توجد ألوان. أضفها من "🎨 قائمة الألوان".</div>') +
        `<div class="qd-dd-foot"><button type="button" data-clear>مسح الاختيار</button>${opts.onManage?'<button type="button" data-manage>🎨 تعديل القائمة</button>':''}<button type="button" data-done>تم</button></div>`;
      p.addEventListener('change', e => { const v = e.target.value; e.target.checked ? sel.add(v) : sel.delete(v); paint(); if(opts.onChange) opts.onChange([...sel]); });
      p.addEventListener('click', e => {
        if(e.target.closest('[data-done]')) close();
        else if(e.target.closest('[data-clear]')){ sel.clear(); p.querySelectorAll('input').forEach(i=>i.checked=false); paint(); if(opts.onChange) opts.onChange([]); }
        else if(e.target.closest('[data-manage]')){ close(); opts.onManage(); }
      });
      dd.appendChild(p); btn.setAttribute('aria-expanded','true');
      setTimeout(()=>document.addEventListener('pointerdown', outside, true), 0);
    }
    btn.addEventListener('click', open);
    paint();
    return {
      get: () => D.colors.filter(c => sel.has(c.id)).map(c => c.id),
      changed(){ const a = this.get().slice().sort().join(), b = (opts.selected||[]).filter(id=>colorById(id)).slice().sort().join(); return a !== b; },
      refresh(){ paint(); }
    };
  }

  /* ---------- نافذة عامة ---------- */
  function modal(title, bodyHTML, footHTML, width){
    injectCSS();
    const ov = document.createElement('div');
    ov.className = 'overlay show'; ov.style.zIndex = 70;
    ov.innerHTML = `<div class="modal" style="max-width:${width||620}px">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="x" data-x aria-label="إغلاق">&times;</button></div>
      <div class="modal-body">${bodyHTML}</div><div class="modal-foot">${footHTML}</div></div>`;
    document.body.appendChild(ov);
    return ov;
  }

  /* ---------- ترتيب العرض ---------- */
  function openOrder(opts){
    const {sb, products, onSaved, img} = opts;
    if(D.missing){ say(errAr({message:'does not exist'})); return; }
    const live = products.filter(p => p.product_status !== 'متوقف');
    let list = live.slice().sort((a,b)=>sortKey(a)-sortKey(b) || (a.code||0)-(b.code||0));
    const start = list.map(p=>p.id).join();
    const ov = modal('ترتيب عرض الأصناف للعملاء',
      `<div class="hint" style="margin:0">الصنف الأول هنا يظهر أولاً في المتجر والميني اب. اسحب من ⠿ أو استخدم الأسهم، ثم اضغط حفظ. الأصناف الموقوفة لا تظهر هنا وتبقى في آخر القائمة.</div>
       <div class="qd-list" id="qdList"></div>`,
      `<button class="btn btn-primary" data-save>حفظ الترتيب</button><button class="btn btn-ghost" data-x>إلغاء</button>`, 640);
    const box = ov.querySelector('#qdList');
    function paint(){
      box.innerHTML = list.map((p,i)=>`<div class="qd-row" data-id="${p.id}">
        <span class="h" aria-label="اسحب لتغيير الترتيب" title="اسحب">⠿</span>
        <span class="n">${i+1}</span>
        <img src="${esc(img(p))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="t"><b>${esc(p.name_ar)}${inBanner(p.id)?'<span class="qd-ban">في الشريط</span>':''}</b><small>صنف ${p.code||''} · ${(+p.price||0).toLocaleString('en-US')} د.ع</small></div>
        <div class="mv"><button type="button" class="far" data-m="top" ${i===0?'disabled':''} title="إلى البداية">⤒</button>
          <button type="button" data-m="up" ${i===0?'disabled':''} title="أعلى">▲</button>
          <button type="button" data-m="down" ${i===list.length-1?'disabled':''} title="أسفل">▼</button>
          <button type="button" class="far" data-m="bottom" ${i===list.length-1?'disabled':''} title="إلى النهاية">⤓</button></div></div>`).join('')
        || '<div class="empty" style="padding:30px">لا توجد أصناف معروضة.</div>';
    }
    function move(id, to){ const i = list.findIndex(p=>p.id===id); if(i<0) return; const [p] = list.splice(i,1); list.splice(Math.max(0,Math.min(list.length,to)),0,p); }
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-m]'); if(!b) return;
      const id = b.closest('.qd-row').dataset.id, i = list.findIndex(p=>p.id===id), m = b.dataset.m;
      move(id, m==='top'?0:m==='bottom'?list.length:m==='up'?i-1:i+1); paint();
      const r = box.querySelector(`[data-id="${id}"]`); if(r) r.scrollIntoView({block:'nearest'});
    });
    /* سحب بالمؤشر (يعمل باللمس والفأرة) */
    let dragId = null;
    box.addEventListener('pointerdown', e => {
      const h = e.target.closest('.h'); if(!h) return;
      e.preventDefault(); dragId = h.closest('.qd-row').dataset.id;
      h.setPointerCapture(e.pointerId);
      h.closest('.qd-row').classList.add('drag');
    });
    box.addEventListener('pointermove', e => {
      if(!dragId) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const over = el && el.closest && el.closest('.qd-row');
      if(over && over.dataset.id !== dragId){
        const to = list.findIndex(p=>p.id===over.dataset.id), from = list.findIndex(p=>p.id===dragId);
        move(dragId, to); paint();
        box.querySelector(`[data-id="${dragId}"]`).classList.add('drag');
        if(from === to) return;
      }
      const r = box.parentElement.getBoundingClientRect();   // تمرير تلقائي قرب الحافة
      if(e.clientY < r.top + 50) box.parentElement.scrollTop -= 14;
      else if(e.clientY > r.bottom - 50) box.parentElement.scrollTop += 14;
    });
    const end = () => { if(!dragId) return; dragId = null; paint(); };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    function close(){ ov.remove(); }
    ov.addEventListener('click', async e => {
      if(e.target.closest('[data-x]')){
        if(list.map(p=>p.id).join() !== start && !confirm('لم تحفظ الترتيب الجديد. إغلاق بدون حفظ؟')) return;
        close(); return;
      }
      const s = e.target.closest('[data-save]'); if(!s) return;
      if(list.map(p=>p.id).join() === start){ close(); return; }
      s.disabled = true; s.textContent = 'جارٍ الحفظ...';
      const {error} = await sb.rpc('set_products_order', {p_ids: list.map(p=>p.id)});
      if(error){ s.disabled = false; s.textContent = 'حفظ الترتيب'; say(errAr(error)); return; }
      await load(sb); close(); say('تم حفظ الترتيب، ويظهر للعملاء الآن'); if(onSaved) onSaved();
    });
    paint();
  }

  /* ---------- إدارة قائمة الألوان ---------- */
  function openColorsManager(opts){
    const {sb, canDelete, onSaved} = opts;
    if(D.missing){ say(errAr({message:'does not exist'})); return; }
    const ov = modal('🎨 قائمة الألوان',
      `<div class="hint" style="margin:0">هذه الألوان تظهر عند تعديل الصنف، وفي فلتر اللون بالمتجر والميني اب (فقط الألوان التي لها أصناف). "مخفي" يُبقي اللون على أصنافه لكن لا يظهر للعملاء.</div>
       <div style="overflow-x:auto"><table class="qd-ctab"><thead><tr><th>اللون</th><th>الاسم</th><th class="en-col">بالإنجليزي</th><th>يظهر</th><th></th></tr></thead><tbody id="qdCt"></tbody></table></div>
       <div class="cost-box" style="background:var(--bg);border-color:var(--line)"><div class="tagline" style="color:var(--accent)">＋ لون جديد</div>
         <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
           <input type="color" id="qdNHex" value="#c98578" style="width:46px;height:40px;border:1px solid var(--line);border-radius:8px;padding:2px">
           <label class="qd-mixl"><input type="checkbox" id="qdNMix"> مشكّل</label>
           <input id="qdNAr" placeholder="الاسم: زهري فاتح" style="flex:1;min-width:140px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-family:inherit;font-size:15px">
           <input id="qdNEn" placeholder="Light pink" class="en" style="width:130px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-family:inherit;font-size:15px">
           <button class="btn btn-primary" data-add>إضافة</button></div></div>`,
      `<button class="btn btn-ghost" data-x>إغلاق</button>`, 680);
    const tb = ov.querySelector('#qdCt');
    const usage = id => Object.values(D.map).filter(r => (r.color_ids||[]).includes(id)).length;
    function paint(){
      tb.innerHTML = D.colors.map((c,i)=>`<tr data-id="${c.id}" class="${c.is_active?'':'hid'}">
        <td><div style="display:flex;align-items:center;gap:6px"><input type="color" data-f="hex" value="${esc(c.hex||'#c98578')}" ${c.hex?'':'disabled'}>
          <label class="qd-mixl"><input type="checkbox" data-f="mix" ${c.hex?'':'checked'}> مشكّل</label></div></td>
        <td><input type="text" data-f="name_ar" value="${esc(c.name_ar)}"></td>
        <td class="en-col"><input type="text" data-f="name_en" class="en" value="${esc(c.name_en||'')}" style="text-align:left"></td>
        <td><input type="checkbox" data-f="is_active" ${c.is_active?'checked':''} style="width:18px;height:18px;accent-color:var(--navy)"></td>
        <td><div class="act"><button data-up ${i===0?'disabled':''}>▲</button><button data-down ${i===D.colors.length-1?'disabled':''}>▼</button>
          ${canDelete?`<button class="del" data-del title="حذف">✕</button>`:''}</div>
          <div class="hint" style="margin:2px 0 0">${usage(c.id)} صنف</div></td></tr>`).join('')
        || '<tr><td colspan="5" class="hint">لا توجد ألوان بعد.</td></tr>';
    }
    async function refresh(){ await load(sb); paint(); if(onSaved) onSaved(); }
    async function upd(id, patch){
      const {error} = await sb.from('product_colors').update(patch).eq('id', id);
      if(error){ say(errAr(error)); paint(); return false; }
      say('تم الحفظ'); await refresh(); return true;
    }
    tb.addEventListener('change', async e => {
      const tr = e.target.closest('tr[data-id]'); if(!tr) return;
      const id = tr.dataset.id, f = e.target.dataset.f;
      if(f === 'name_ar'){ const v = e.target.value.trim(); if(!v){ say('اكتب اسم اللون'); paint(); return; } await upd(id,{name_ar:v}); }
      else if(f === 'name_en') await upd(id,{name_en:e.target.value.trim()||null});
      else if(f === 'hex') await upd(id,{hex:e.target.value});
      else if(f === 'mix') await upd(id,{hex: e.target.checked ? null : (tr.querySelector('[data-f=hex]').value || '#c98578')});
      else if(f === 'is_active') await upd(id,{is_active:e.target.checked});
    });
    tb.addEventListener('click', async e => {
      const tr = e.target.closest('tr[data-id]'); if(!tr) return;
      const id = tr.dataset.id, i = D.colors.findIndex(c=>c.id===id);
      if(e.target.closest('[data-up]')||e.target.closest('[data-down]')){
        const j = e.target.closest('[data-up]') ? i-1 : i+1; if(j<0||j>=D.colors.length) return;
        const arr = D.colors.slice(); const [c] = arr.splice(i,1); arr.splice(j,0,c);
        for(let k=0;k<arr.length;k++){ if(arr[k].sort_order !== (k+1)*10){ const {error} = await sb.from('product_colors').update({sort_order:(k+1)*10}).eq('id',arr[k].id); if(error){ say(errAr(error)); break; } } }
        await refresh();
      }else if(e.target.closest('[data-del]')){
        const c = D.colors[i], n = usage(id);
        if(!confirm(`حذف اللون "${c.name_ar}"؟` + (n?`\nسيُزال من ${n} صنف (الأصناف نفسها لا تُحذف).\nإن أردت إبقاءه على الأصناف، ألغِ "يظهر" بدلاً من الحذف.`:''))) return;
        const {error} = await sb.from('product_colors').delete().eq('id', id);
        if(error){ say(errAr(error)); return; }
        say('تم حذف اللون'); await refresh();
      }
    });
    const nMix = ov.querySelector('#qdNMix'), nHex = ov.querySelector('#qdNHex');
    nMix.onchange = () => nHex.disabled = nMix.checked;
    ov.addEventListener('click', async e => {
      if(e.target.closest('[data-x]')){ ov.remove(); return; }
      const a = e.target.closest('[data-add]'); if(!a) return;
      const name_ar = ov.querySelector('#qdNAr').value.trim();
      if(!name_ar){ say('اكتب اسم اللون'); return; }
      a.disabled = true;
      const max = D.colors.reduce((m,c)=>Math.max(m,c.sort_order||0),0);
      const {error} = await sb.from('product_colors').insert({name_ar, name_en: ov.querySelector('#qdNEn').value.trim()||null,
        hex: nMix.checked ? null : nHex.value, sort_order: max + 10});
      a.disabled = false;
      if(error){ say(errAr(error)); return; }
      ov.querySelector('#qdNAr').value = ''; ov.querySelector('#qdNEn').value = '';
      say('تمت إضافة اللون'); await refresh();
    });
    ov.querySelector('#qdNAr').addEventListener('keydown', e => { if(e.key==='Enter') ov.querySelector('[data-add]').click(); });
    paint();
  }

  /* ---------- ألوان صنف واحد (واجهة المورد) ---------- */
  function openProductColors(opts){
    const {sb, product, onSaved} = opts;
    if(D.missing){ say(errAr({message:'does not exist'})); return; }
    const ov = modal('ألوان: ' + (product.name_ar||''),
      `<div class="field"><label>ألوان الصنف</label><div id="qdPc"></div>
        <div class="hint">تظهر للعميل في فلتر اللون بالمتجر والميني اب.</div></div>`,
      `<button class="btn btn-primary" data-save>حفظ</button><button class="btn btn-ghost" data-x>إلغاء</button>`, 460);
    ov.querySelector('.modal').style.overflow = 'visible';
    ov.querySelector('.modal-body').style.minHeight = '320px';
    const pk = mountColorPicker(ov.querySelector('#qdPc'), {selected: colorIds(product.id)});
    ov.addEventListener('click', async e => {
      if(e.target.closest('[data-x]')){ ov.remove(); return; }
      const s = e.target.closest('[data-save]'); if(!s) return;
      s.disabled = true;
      if(await saveColors(sb, product.id, pk.get())){ ov.remove(); say('تم حفظ الألوان'); if(onSaved) onSaved(); }
      else s.disabled = false;
    });
  }

  window.QadahDisplay = { load, sortKey, colorIds, inBanner, swatch, swatchesHTML, positionOf, setBanner, saveColors,
    mountColorPicker, openOrder, openColorsManager, openProductColors, colorById,
    get colors(){ return D.colors; }, get missing(){ return D.missing; } };
})();
