/* ============================================================
   قدّاح — إدارة أنواع الأصناف من لوحة التحكم
   ملف مستقل مثل display.js و delivery.js.
   الجدول: product_categories (الكتابة للمدير فقط، القراءة لكل الموظفين).
   - تغيير اسم نوع: يتغير تلقائياً على أصنافه (trigger في القاعدة).
   - حذف نوع عليه أصناف: ممنوع، والنافذة تعرض نقل الأصناف الى نوع آخر اولاً.
   عمود products.category يبقى نصاً، فلا يتأثر المتجر ولا التطبيق ولا البوت.
============================================================ */
(function(){
  const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const say = m => (window.toast ? window.toast(m) : alert(m));
  /* القائمة الاحتياطية: تُستعمل فقط اذا لم يُشغَّل ملف SQL بعد */
  const DEFAULTS = ['ورد','زنابق','عباد الشمس','أنثوريوم','أقحوان','صناديق','منوعات','مناسبات كبيرة'];
  const S = { rows: [], missing: false, ready: false };

  let css = false;
  function injectCSS(){
    if(css) return; css = true;
    const s = document.createElement('style');
    s.textContent = `
    .qc-tab{width:100%;border-collapse:collapse}
    .qc-tab th{font-size:12px;color:var(--ink-soft);text-align:right;padding:4px 6px}
    .qc-tab td{padding:5px 6px;vertical-align:middle}
    .qc-tab input[type=text]{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:14px;background:var(--bg);color:var(--ink)}
    .qc-tab .act{display:flex;gap:4px;white-space:nowrap}
    .qc-tab .act button{min-width:32px;height:32px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;font-family:inherit;font-size:13px;font-weight:700}
    .qc-tab .act button:disabled{opacity:.4;cursor:default}
    .qc-tab .act .del{color:var(--danger)}
    .qc-tab tr.hid td{opacity:.6}
    .qc-n{font-size:12px;color:var(--ink-soft);white-space:nowrap}
    @media(max-width:600px){.qc-tab .en-col{display:none}}`;
    document.head.appendChild(s);
  }

  function errAr(e){
    const m = (e && e.message) || '';
    if(/does not exist|schema cache|Could not find/i.test(m)) return 'ملف SQL الخاص بالأنواع لم يُشغَّل بعد في Supabase';
    if(m.includes('category in use')) return 'لا يمكن حذف نوع عليه أصناف، انقلها أولاً';
    if(m.includes('duplicate')||m.includes('product_categories_name_key')) return 'يوجد نوع بنفس الاسم';
    if(m.includes('not authorized')||m.includes('row-level security')||m.includes('permission')) return 'تعديل الأنواع للمدير فقط';
    if(m.includes('unknown category')) return 'النوع المختار حُذف، أعد فتح النافذة';
    return m || 'حدث خطأ';
  }

  async function load(sb){
    injectCSS();
    const {data, error} = await sb.from('product_categories').select('*').order('sort_order').order('name_ar');
    S.missing = !!error;
    if(error) console.warn('product_categories', error);
    S.rows = error ? DEFAULTS.map((n,i)=>({id:'d'+i, name_ar:n, name_en:null, sort_order:(i+1)*10, is_active:true})) : (data || []);
    S.ready = true;
  }
  const names = () => S.rows.filter(r=>r.is_active).map(r=>r.name_ar);
  const defaultName = () => (names()[0] || (S.rows[0] && S.rows[0].name_ar) || DEFAULTS[0]);
  /* خيارات القائمة: الفلاتر تعرض الكل (المخفي بعلامة)، ونافذة الصنف تعرض الظاهر + نوع الصنف الحالي */
  function options(o){
    o = o || {};
    const out = [];
    S.rows.forEach(r=>{
      if(r.is_active || o.withHidden || r.name_ar === o.current)
        out.push({value:r.name_ar, label: r.name_ar + (r.is_active?'':' (مخفي)')});
    });
    if(o.current && !S.rows.some(r=>r.name_ar===o.current)) out.push({value:o.current, label:o.current});
    return out;
  }

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

  function openManager(opts){
    const {sb, getProducts, onSaved} = opts;
    if(S.missing){ say(errAr({message:'does not exist'})); return; }
    const count = name => (getProducts ? getProducts() : []).filter(p=>p.category===name).length;
    const ov = modal('📂 أنواع الأصناف',
      `<div class="hint" style="margin:0">هذه الأنواع تظهر عند تعديل الصنف وفي فلاتر الكتالوج. تغيير الاسم يتغير تلقائياً على أصنافه. "ظاهر" يعني متاح عند اختيار نوع جديد لصنف (الأصناف القديمة تحتفظ بنوعها). النوع الذي عليه أصناف لا يُحذف قبل نقلها.</div>
       <div style="overflow-x:auto"><table class="qc-tab"><thead><tr><th>الاسم</th><th class="en-col">بالإنجليزي</th><th>ظاهر</th><th></th></tr></thead><tbody id="qcT"></tbody></table></div>
       <div class="cost-box" style="background:var(--bg);border-color:var(--line)"><div class="tagline" style="color:var(--accent)">＋ نوع جديد</div>
         <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
           <input id="qcNAr" placeholder="الاسم: بالونات" style="flex:1;min-width:140px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-family:inherit;font-size:15px">
           <input id="qcNEn" placeholder="Balloons" style="width:130px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-family:inherit;font-size:15px;text-align:left">
           <button class="btn btn-primary" data-add>إضافة</button></div></div>`,
      `<button class="btn btn-ghost" data-x>إغلاق</button>`, 640);
    const tb = ov.querySelector('#qcT');
    function paint(){
      tb.innerHTML = S.rows.map((c,i)=>`<tr data-id="${c.id}" class="${c.is_active?'':'hid'}">
        <td><input type="text" data-f="name_ar" value="${esc(c.name_ar)}"></td>
        <td class="en-col"><input type="text" data-f="name_en" value="${esc(c.name_en||'')}" style="text-align:left"></td>
        <td><input type="checkbox" data-f="is_active" ${c.is_active?'checked':''} style="width:18px;height:18px;accent-color:var(--navy)"></td>
        <td><div class="act"><button data-up ${i===0?'disabled':''}>▲</button><button data-down ${i===S.rows.length-1?'disabled':''}>▼</button>
          <button class="del" data-del title="حذف">✕</button></div>
          <div class="qc-n">${count(c.name_ar)} صنف</div></td></tr>`).join('')
        || '<tr><td colspan="4" class="hint">لا توجد أنواع بعد.</td></tr>';
    }
    async function refresh(){ await load(sb); paint(); if(onSaved) await onSaved(); }
    async function upd(id, patch, done){
      const {error} = await sb.from('product_categories').update(patch).eq('id', id);
      if(error){ say(errAr(error)); await load(sb); paint(); return false; }
      say(done || 'تم الحفظ'); await refresh(); return true;
    }
    tb.addEventListener('change', async e => {
      const tr = e.target.closest('tr[data-id]'); if(!tr) return;
      const id = tr.dataset.id, f = e.target.dataset.f, cur = S.rows.find(r=>r.id===id);
      if(f === 'name_ar'){
        const v = e.target.value.trim();
        if(!v){ say('اكتب اسم النوع'); paint(); return; }
        if(v === cur.name_ar){ paint(); return; }
        const n = count(cur.name_ar);
        if(n && !confirm(`تغيير "${cur.name_ar}" إلى "${v}"؟\nسيتغير النوع تلقائياً على ${n} صنف.`)){ paint(); return; }
        await upd(id, {name_ar:v}, n ? `تم تغيير الاسم على ${n} صنف` : 'تم الحفظ');
      }
      else if(f === 'name_en') await upd(id, {name_en:e.target.value.trim()||null});
      else if(f === 'is_active') await upd(id, {is_active:e.target.checked});
    });
    tb.addEventListener('click', async e => {
      const tr = e.target.closest('tr[data-id]'); if(!tr) return;
      const id = tr.dataset.id, i = S.rows.findIndex(c=>c.id===id);
      if(e.target.closest('[data-up]')||e.target.closest('[data-down]')){
        const j = e.target.closest('[data-up]') ? i-1 : i+1; if(j<0||j>=S.rows.length) return;
        const arr = S.rows.slice(); const [c] = arr.splice(i,1); arr.splice(j,0,c);
        for(let k=0;k<arr.length;k++){
          if(arr[k].sort_order !== (k+1)*10){
            const {error} = await sb.from('product_categories').update({sort_order:(k+1)*10}).eq('id',arr[k].id);
            if(error){ say(errAr(error)); break; }
          }
        }
        await refresh();
      }else if(e.target.closest('[data-del]')){
        const c = S.rows[i], n = count(c.name_ar);
        if(S.rows.length <= 1){ say('لا يمكن حذف آخر نوع'); return; }
        if(n === 0){
          if(!confirm(`حذف النوع "${c.name_ar}"؟`)) return;
          const {error} = await sb.from('product_categories').delete().eq('id', id);
          if(error){ say(errAr(error)); await load(sb); paint(); return; }
          say('تم حذف النوع'); await refresh();
        }else askMove(c, n);
      }
    });
    /* نافذة النقل: النوع عليه أصناف */
    function askMove(c, n){
      const others = S.rows.filter(r=>r.id!==c.id);
      const mv = modal('نقل أصناف "' + c.name_ar + '"',
        `<div class="hint" style="margin:0">على هذا النوع <b>${n}</b> صنف. لا يمكن حذفه قبل نقلها. اختر النوع الجديد لها، وبعد النقل يُحذف "${esc(c.name_ar)}".</div>
         <div class="field"><label>انقل الأصناف إلى</label><select id="qcTo">${others.map(r=>`<option value="${esc(r.name_ar)}">${esc(r.name_ar)}${r.is_active?'':' (مخفي)'}</option>`).join('')}</select></div>`,
        `<button class="btn btn-primary" data-go>نقل ثم حذف</button><button class="btn btn-ghost" data-x>إلغاء</button>`, 460);
      mv.style.zIndex = 80;
      mv.addEventListener('click', async e => {
        if(e.target.closest('[data-x]')){ mv.remove(); return; }
        const g = e.target.closest('[data-go]'); if(!g) return;
        g.disabled = true;
        const to = mv.querySelector('#qcTo').value;
        const r1 = await sb.rpc('move_products_category', {p_from:c.name_ar, p_to:to});
        if(r1.error){ say(errAr(r1.error)); g.disabled = false; return; }
        const r2 = await sb.from('product_categories').delete().eq('id', c.id);
        if(r2.error){ say(errAr(r2.error)); g.disabled = false; await refresh(); return; }
        mv.remove(); say(`نُقل ${r1.data} صنف إلى "${to}" وحُذف "${c.name_ar}"`); await refresh();
      });
    }
    ov.addEventListener('click', async e => {
      if(e.target.closest('[data-x]') && e.target.closest('.overlay') === ov){ ov.remove(); return; }
      const a = e.target.closest('[data-add]'); if(!a) return;
      const name_ar = ov.querySelector('#qcNAr').value.trim();
      if(!name_ar){ say('اكتب اسم النوع'); return; }
      a.disabled = true;
      const max = S.rows.reduce((m,c)=>Math.max(m,c.sort_order||0),0);
      const {error} = await sb.from('product_categories').insert({name_ar, name_en: ov.querySelector('#qcNEn').value.trim()||null, sort_order: max + 10});
      a.disabled = false;
      if(error){ say(errAr(error)); return; }
      ov.querySelector('#qcNAr').value = ''; ov.querySelector('#qcNEn').value = '';
      say('تمت إضافة النوع'); await refresh();
    });
    ov.querySelector('#qcNAr').addEventListener('keydown', e => { if(e.key==='Enter') ov.querySelector('[data-add]').click(); });
    paint();
  }

  window.QadahCategories = { load, names, options, defaultName, openManager,
    get rows(){ return S.rows; }, get missing(){ return S.missing; } };
})();
