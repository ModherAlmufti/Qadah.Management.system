/* ============================================================
   قدّاح — معرض صور الصنف (صور إضافية غير صورة الغلاف)
   ملف مستقل مثل finance.js. يُستدعى من نافذة الصنف وواجهة المورد.
   كل الكتابة عبر دوال القاعدة (add / delete / reorder_product_images)
   فالصلاحية تُفحص في القاعدة: المدير، مسؤول الأسعار، المورد على منتجاته فقط.
   التغييرات تُحفظ فوراً، لا تنتظر زر "حفظ".
============================================================ */
(function(){
  const MAX = 8;
  const BUCKET = 'product-images';
  const MARKER = '/storage/v1/object/public/' + BUCKET + '/';

  let css = false;
  function injectCSS(){
    if(css) return; css = true;
    const s = document.createElement('style');
    s.textContent = `
    .qg-grid{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}
    .qg-item{position:relative;width:92px}
    .qg-item img{width:92px;height:92px;object-fit:cover;border-radius:10px;border:1px solid var(--line);background:var(--card,#f5ede0);display:block}
    .qg-num{position:absolute;top:5px;right:5px;background:var(--navy,#01183a);color:#fff;font-size:11px;font-weight:700;min-width:20px;height:20px;line-height:20px;text-align:center;border-radius:10px;padding:0 5px}
    .qg-del{position:absolute;top:4px;left:4px;width:24px;height:24px;border-radius:50%;border:none;background:rgba(255,255,255,.92);color:var(--danger,#b23a3a);font-size:16px;line-height:24px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.15)}
    .qg-move{display:flex;gap:4px;margin-top:5px}
    .qg-move button{flex:1;height:26px;border:1px solid var(--line);border-radius:7px;background:var(--surface,#fffdfa);color:var(--ink);cursor:pointer;font-size:13px}
    .qg-move button:disabled{opacity:.35;cursor:default}
    .qg-add{width:92px;height:92px;border:1.5px dashed var(--rose-strong,#c98578);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;color:var(--rose-strong,#c98578);font-size:12px;font-weight:700;background:var(--rose-soft,#f4e4df)}
    .qg-add span{font-size:24px;line-height:1}
    .qg-add.off{opacity:.45;cursor:not-allowed}
    .qg-msg{font-size:12px;color:var(--ink-soft,#8f8781);margin-top:6px}
    .qg-busy{pointer-events:none;opacity:.6}`;
    document.head.appendChild(s);
  }

  const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const say = m => (window.toast ? window.toast(m) : alert(m));

  function pathFromUrl(u){
    if(!u || !u.includes(MARKER)) return null;
    return decodeURIComponent(u.split(MARKER)[1].split(/[?#]/)[0]);
  }

  /* ترجمة رسائل القاعدة إلى عربي واضح */
  function errAr(e){
    const m = (e && e.message) || '';
    if(m.includes('max 8')) return 'الحد الأقصى 8 صور إضافية لكل صنف';
    if(m.includes('not authorized')) return 'ليست لديك صلاحية على صور هذا الصنف';
    if(m.includes('must list every image')) return 'تغيّر المعرض من جهاز آخر، أعد فتحه';
    if(m.includes('url must be')) return 'رابط الصورة غير مقبول';
    return m || 'حدث خطأ';
  }

  /* حالة كل حاوية */
  const state = new WeakMap();

  async function load(box){
    const st = state.get(box);
    const {data, error} = await st.sb.from('product_images')
      .select('id,url,sort_order').eq('product_id', st.productId).order('sort_order');
    if(error){ box.innerHTML = '<div class="qg-msg">تعذّر تحميل الصور: '+esc(error.message)+'</div>'; return; }
    st.rows = data || [];
    draw(box);
  }

  function draw(box){
    const st = state.get(box), rows = st.rows, n = rows.length;
    let h = '<div class="qg-grid">';
    rows.forEach((r,i)=>{
      h += `<div class="qg-item">
        <img src="${esc(r.url)}" loading="lazy" alt="">
        <span class="qg-num">${i+1}</span>
        ${st.canEdit ? `<button type="button" class="qg-del" title="حذف" data-del="${r.id}">&times;</button>
        <div class="qg-move">
          <button type="button" title="قبل" data-mv="${i}" data-dir="-1" ${i===0?'disabled':''}>→</button>
          <button type="button" title="بعد" data-mv="${i}" data-dir="1" ${i===n-1?'disabled':''}>←</button>
        </div>` : ''}
      </div>`;
    });
    if(st.canEdit){
      const off = n >= MAX;
      h += `<label class="qg-add ${off?'off':''}"><span>+</span>إضافة صور
        <input type="file" accept="image/*" multiple style="display:none" ${off?'disabled':''}></label>`;
    }
    h += '</div>';
    h += `<div class="qg-msg">${n} من ${MAX}` +
      (st.canEdit ? ' · الصورة رقم 1 تظهر بعد الغلاف · التغيير يُحفظ فوراً' : '') + '</div>';
    if(!n && !st.canEdit) h = '<div class="qg-msg">لا توجد صور إضافية.</div>';
    box.innerHTML = h;
  }

  function busy(box, on){ box.classList.toggle('qg-busy', !!on); }

  async function upload(box, files){
    const st = state.get(box);
    const room = MAX - st.rows.length;
    if(room <= 0){ say('الحد الأقصى 8 صور إضافية لكل صنف'); return; }
    const list = Array.from(files).slice(0, room);
    if(files.length > room) say(`أُضيفت ${room} فقط، الحد الأقصى ${MAX}`);
    busy(box, true);
    let ok = 0;
    for(let i=0;i<list.length;i++){
      const f = list[i];
      say(`جارٍ رفع الصورة ${i+1} من ${list.length}...`);
      let blob = f, type = f.type || 'image/jpeg';
      let ext = ((f.name||'').split('.').pop() || 'jpg').toLowerCase();
      try{
        if(st.compress){
          const c = await st.compress(f);
          if(c && c.blob && c.blob.size < f.size){ blob = c.blob; ext = c.ext; type = c.blob.type; }
        }
      }catch(e){ console.warn('gallery compress skipped', e); }
      const path = `images/gallery/${st.productId}/g_${Date.now()}_${Math.random().toString(36).slice(2,7)}.${ext}`;
      const up = await st.sb.storage.from(BUCKET).upload(path, blob,
        {upsert:false, contentType:type, cacheControl:st.cache || '31536000'});
      if(up.error){ say('تعذّر رفع الصورة'); console.error(up.error); continue; }
      const url = st.sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const {error} = await st.sb.rpc('add_product_image', {p_product_id: st.productId, p_url: url});
      if(error){
        await st.sb.storage.from(BUCKET).remove([path]);   // لا نترك ملفاً بلا صف
        say(errAr(error)); break;
      }
      ok++;
    }
    busy(box, false);
    await load(box);
    if(ok) say(ok === 1 ? 'أُضيفت الصورة' : `أُضيفت ${ok} صور`);
    if(st.onChange) st.onChange();
  }

  async function remove(box, id){
    const st = state.get(box);
    if(!confirm('حذف هذه الصورة من المعرض؟')) return;
    busy(box, true);
    const {data:url, error} = await st.sb.rpc('delete_product_image', {p_image_id: id});
    if(error){ busy(box, false); say(errAr(error)); return; }
    /* حذف الملف: قد لا يُحذف إن رفعه شخص آخر (المورد يحذف ما رفعه فقط).
       الصورة اختفت من المعرض في كل الأحوال، فلا نُظهر خطأ هنا. */
    const p = pathFromUrl(url);
    if(p){ try{ await st.sb.storage.from(BUCKET).remove([p]); }catch(e){ console.warn('gallery file kept', e); } }
    busy(box, false);
    await load(box);
    say('حُذفت الصورة');
    if(st.onChange) st.onChange();
  }

  async function move(box, i, dir){
    const st = state.get(box), j = i + dir;
    if(j < 0 || j >= st.rows.length) return;
    const ids = st.rows.map(r=>r.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    busy(box, true);
    const {error} = await st.sb.rpc('reorder_product_images', {p_product_id: st.productId, p_ids: ids});
    busy(box, false);
    if(error) say(errAr(error));
    await load(box);
    if(!error && st.onChange) st.onChange();
  }

  /* حذف كل ملفات معرض صنف من التخزين (يُستدعى بعد حذف الصنف) */
  async function removeAllFiles(sb, urls){
    const paths = (urls||[]).map(pathFromUrl).filter(Boolean);
    if(!paths.length) return;
    try{ await sb.storage.from(BUCKET).remove(paths); }catch(e){ console.warn('gallery files kept', e); }
  }

  /* opts: {sb, productId, canEdit, compress, cache, onChange} */
  async function mount(box, opts){
    injectCSS();
    if(!box) return;
    if(!opts.productId){
      box.innerHTML = '<div class="qg-msg">احفظ الصنف أولاً، ثم افتحه من جديد لإضافة صور المعرض.</div>';
      return;
    }
    state.set(box, Object.assign({rows:[]}, opts));
    if(!box._qgBound){
      box._qgBound = true;
      box.addEventListener('change', e=>{
        if(e.target.matches('input[type=file]') && e.target.files.length){
          const fs = e.target.files; upload(box, fs).finally(()=>{ e.target.value=''; });
        }
      });
      box.addEventListener('click', e=>{
        const d = e.target.closest('[data-del]'); if(d){ remove(box, d.dataset.del); return; }
        const m = e.target.closest('[data-mv]'); if(m){ move(box, +m.dataset.mv, +m.dataset.dir); }
      });
    }
    box.innerHTML = '<div class="qg-msg">جارٍ تحميل الصور...</div>';
    await load(box);
  }

  window.QadahGallery = { mount, removeAllFiles, MAX };
})();
