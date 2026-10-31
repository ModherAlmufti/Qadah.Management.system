/* ============================================================
   قدّاح — محرر صورة الصنف (قص وتكبير وتحسين قبل الرفع)
   QadahImageEditor.open(source, opts) → Promise<File|null>
     source: ملف (File/Blob) أو رابط صورة موجودة
     النتيجة: ملف WebP جديد جاهز للرفع (null عند الإلغاء)
   الأدوات: تكبير/تصغير (شريط، أزرار، عجلة الفأرة، إصبعين)، تحريك بالسحب،
   تدوير 90°، استقامة دقيقة، قلب أفقي، نسبة الإطار، خلفية عند التصغير،
   سطوع، تباين، تشبع، دفء، حدة، ودليل "مساحة الشعار الآمنة".
   الصورة النهائية تُحفظ بأقصى ضلع 1600px (بدون تكبير يفقد الجودة).
============================================================ */
(function(){
  const OUT_MAX = 1600, OUT_MIN = 600, QUALITY = 0.86, PREVIEW_MAX = 1400;
  const RATIOS = [ {id:'4:5', r:4/5, l:'4:5 (موصى به)'}, {id:'1:1', r:1, l:'مربع 1:1'}, {id:'3:4', r:3/4, l:'3:4'}, {id:'orig', r:null, l:'الأصلية'} ];
  const BG = [ {id:'blur', l:'ضبابية من الصورة'}, {id:'#FFFFFF', l:'أبيض'}, {id:'#FBF6EE', l:'كريمي'}, {id:'#01183A', l:'كحلي'} ];
  const ADJ = [ {k:'bright', l:'السطوع', min:-50, max:50}, {k:'contrast', l:'التباين', min:-50, max:50},
                {k:'sat', l:'التشبع', min:-60, max:60}, {k:'warm', l:'الدفء', min:-40, max:40}, {k:'sharp', l:'الحدة', min:0, max:100} ];
  const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  let css = false;
  function injectCSS(){
    if(css) return; css = true;
    const s = document.createElement('style');
    s.textContent = `
    .qe-ov{position:fixed;inset:0;z-index:90;background:rgba(20,16,12,.72);display:flex;align-items:center;justify-content:center;padding:14px}
    .qe{background:var(--surface,#fffdfa);border-radius:18px;width:100%;max-width:980px;max-height:96vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35)}
    .qe-head{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--line,#ece2d4)}
    .qe-head h2{font-size:18px;color:var(--ink,#24303c)}
    .qe-head .x{background:none;border:none;font-size:26px;cursor:pointer;color:var(--ink-soft,#8f8781);line-height:1}
    .qe-main{display:grid;grid-template-columns:1fr 330px;gap:0;min-height:0;flex:1;overflow:hidden}
    .qe-stagewrap{background:#2a2622;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:10px;min-height:0}
    .qe-stage{position:relative;touch-action:none;cursor:grab;box-shadow:0 0 0 9999px rgba(0,0,0,.0);max-width:100%}
    .qe-stage.drag{cursor:grabbing}
    .qe-stage canvas{display:block;width:100%;height:100%;border-radius:4px}
    .qe-safe{position:absolute;inset:8%;border:1.5px dashed rgba(255,255,255,.85);border-radius:4px;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,.25)}
    .qe-safe span{position:absolute;top:-22px;right:0;font-size:11px;color:#fff;background:rgba(0,0,0,.45);padding:1px 6px;border-radius:6px;white-space:nowrap}
    .qe-grid{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .15s;
      background:linear-gradient(to right,transparent calc(33.33% - .5px),rgba(255,255,255,.5) calc(33.33% - .5px),rgba(255,255,255,.5) calc(33.33% + .5px),transparent calc(33.33% + .5px),transparent calc(66.66% - .5px),rgba(255,255,255,.5) calc(66.66% - .5px),rgba(255,255,255,.5) calc(66.66% + .5px),transparent calc(66.66% + .5px)),
      linear-gradient(to bottom,transparent calc(33.33% - .5px),rgba(255,255,255,.5) calc(33.33% - .5px),rgba(255,255,255,.5) calc(33.33% + .5px),transparent calc(33.33% + .5px),transparent calc(66.66% - .5px),rgba(255,255,255,.5) calc(66.66% - .5px),rgba(255,255,255,.5) calc(66.66% + .5px),transparent calc(66.66% + .5px))}
    .qe-stage.drag .qe-grid{opacity:1}
    .qe-zoom{display:flex;align-items:center;gap:8px;color:#fff;width:100%;max-width:420px}
    .qe-zoom button{width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);color:#fff;font-size:20px;cursor:pointer;flex-shrink:0}
    .qe-zoom input{flex:1;accent-color:#dca096}
    .qe-zoom b{font-size:12px;min-width:44px;text-align:center}
    .qe-info{font-size:12px;color:#d9d2c8;text-align:center}
    .qe-info.warn{color:#ffb4a8;font-weight:700}
    .qe-side{overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:14px;border-inline-start:1px solid var(--line,#ece2d4)}
    .qe-sec h3{font-size:13px;color:var(--ink-soft,#8f8781);margin-bottom:7px;font-weight:800}
    .qe-btns{display:flex;flex-wrap:wrap;gap:6px}
    .qe-btns button{flex:1 1 auto;min-height:38px;padding:6px 10px;border:1px solid var(--line,#ece2d4);border-radius:10px;background:var(--bg,#fbf6ee);color:var(--ink,#24303c);font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}
    .qe-btns button.on{background:var(--navy,#01183a);border-color:var(--navy,#01183a);color:#fdf6ec}
    .qe-sl{display:grid;grid-template-columns:62px 1fr 38px;align-items:center;gap:8px;font-size:13px;font-weight:700;margin-bottom:4px}
    .qe-sl input{width:100%;accent-color:var(--navy,#01183a)}
    .qe-sl output{font-size:12px;color:var(--ink-soft,#8f8781);text-align:center;direction:ltr}
    .qe-chk{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;cursor:pointer}
    .qe-chk input{width:17px;height:17px;accent-color:var(--navy,#01183a)}
    .qe-foot{display:flex;gap:10px;padding:12px 20px;border-top:1px solid var(--line,#ece2d4);flex-wrap:wrap;align-items:center}
    .qe-foot .sp{flex:1}
    .qe-load{color:#fff;font-weight:700;padding:60px}
    @media(max-width:820px){
      .qe-ov{padding:0}.qe{max-height:100vh;height:100%;border-radius:0}
      .qe-main{display:block;overflow-y:auto}
      .qe-stagewrap{padding:10px;min-height:auto}
      .qe-side{border-inline-start:none;border-top:1px solid var(--line,#ece2d4);overflow:visible}
    }`;
    document.head.appendChild(s);
  }

  async function toBitmap(blob){
    try{ return await createImageBitmap(blob, {imageOrientation:'from-image'}); }
    catch(e){
      return await new Promise((res,rej)=>{ const u = URL.createObjectURL(blob), im = new Image();
        im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('تعذّر قراءة الصورة')); }; im.src = u; });
    }
  }
  function scaled(src, max){
    const k = Math.min(1, max / Math.max(src.width, src.height));
    if(k === 1) return src;
    const c = document.createElement('canvas'); c.width = Math.round(src.width*k); c.height = Math.round(src.height*k);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  /* ---------- الرسم ---------- */
  function frameRatio(st){
    if(st.ratio) return st.ratio;
    const odd = st.rot % 2 === 1;
    return odd ? st.full.height / st.full.width : st.full.width / st.full.height;
  }
  function coverScale(st, W, H, img){
    const odd = st.rot % 2 === 1;
    const iw = odd ? img.height : img.width, ih = odd ? img.width : img.height;
    // نأخذ زاوية الاستقامة في الحساب حتى لا تظهر زوايا فارغة عند zoom = 1
    const a = Math.abs(st.angle) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    const needW = W*cos + H*sin, needH = W*sin + H*cos;
    return Math.max(needW / iw, needH / ih);
  }
  function draw(ctx, W, H, st, img, small){
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if(st.bg === 'blur'){
      const t = st.tiny; const k = Math.max(W / t.width, H / t.height) * 1.15;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(t, (W - t.width*k)/2, (H - t.height*k)/2, t.width*k, t.height*k);
      ctx.fillStyle = 'rgba(251,246,238,.18)'; ctx.fillRect(0, 0, W, H);
    }else{ ctx.fillStyle = st.bg; ctx.fillRect(0, 0, W, H); }
    const s = coverScale(st, W, H, img) * st.zoom;
    ctx.translate(W/2 + st.ox*W, H/2 + st.oy*H);
    ctx.rotate((st.rot*90 + st.angle) * Math.PI / 180);
    ctx.scale(st.flip ? -1 : 1, 1);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -img.width*s/2, -img.height*s/2, img.width*s, img.height*s);
    ctx.restore();
    adjust(ctx, W, H, st, small);
  }
  /* سطوع/تباين/تشبع/دفء/حدة بمعالجة البكسلات (تعمل في كل المتصفحات، ومنها Safari) */
  function adjust(ctx, W, H, st, small){
    const b = st.bright, c = st.contrast, sa = st.sat, wm = st.warm, sh = st.sharp;
    if(!b && !c && !sa && !wm && !sh) return;
    const im = ctx.getImageData(0, 0, W, H), d = im.data;
    const bo = b * 2.2, cf = (259 * (c*2.2 + 255)) / (255 * (259 - c*2.2)), sf = 1 + sa/100, wr = wm * 0.9;
    for(let i = 0; i < d.length; i += 4){
      let r = d[i], g = d[i+1], bl = d[i+2];
      r += bo; g += bo; bl += bo;
      r = cf*(r-128)+128; g = cf*(g-128)+128; bl = cf*(bl-128)+128;
      const l = 0.299*r + 0.587*g + 0.114*bl;
      r = l + (r-l)*sf; g = l + (g-l)*sf; bl = l + (bl-l)*sf;
      r += wr; bl -= wr;
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i+1] = g < 0 ? 0 : g > 255 ? 255 : g; d[i+2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
    }
    if(sh){
      const amt = sh / 100 * (small ? 0.6 : 1), src = new Uint8ClampedArray(d), w4 = W*4;
      for(let y = 1; y < H-1; y++){
        for(let x = 1; x < W-1; x++){
          const i = y*w4 + x*4;
          for(let k = 0; k < 3; k++){
            const v = src[i+k], blur = (src[i+k-4] + src[i+k+4] + src[i+k-w4] + src[i+k+w4]) / 4;
            d[i+k] = v + (v - blur) * amt * 1.6;
          }
        }
      }
    }
    ctx.putImageData(im, 0, 0);
  }

  /* ---------- النافذة ---------- */
  async function open(source, opts){
    opts = opts || {};
    injectCSS();
    const ov = document.createElement('div');
    ov.className = 'qe-ov';
    ov.innerHTML = `<div class="qe" role="dialog" aria-label="تعديل الصورة"><div class="qe-head"><h2>${esc(opts.title || 'تعديل صورة الصنف')}</h2><button class="x" data-cancel aria-label="إغلاق">&times;</button></div>
      <div class="qe-main"><div class="qe-stagewrap"><div class="qe-load">جارٍ تحميل الصورة...</div></div><div class="qe-side"></div></div>
      <div class="qe-foot"><button class="btn btn-ghost" data-reset>↺ البداية</button><span class="sp"></span>
        <button class="btn btn-ghost" data-cancel>إلغاء</button><button class="btn btn-primary" data-ok disabled>✓ استخدم الصورة</button></div></div>`;
    document.body.appendChild(ov);
    let resolveFn; const result = new Promise(r => resolveFn = r);
    const finish = v => { ov.remove(); document.removeEventListener('keydown', onKey); resolveFn(v); };
    const onKey = e => { if(e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    ov.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => finish(null));

    let full;
    try{
      let blob = source;
      if(typeof source === 'string'){
        const res = await fetch(source, {cache:'no-store'});
        if(!res.ok) throw new Error('تعذّر تحميل الصورة الحالية');
        blob = await res.blob();
      }
      full = await toBitmap(blob);
    }catch(e){
      ov.querySelector('.qe-load').textContent = e.message || 'تعذّر قراءة الصورة';
      return result;
    }

    const st = { full, prev: scaled(full, PREVIEW_MAX), tiny: scaled(full, 28),
      ratio: 4/5, ratioId: '4:5', rot: 0, angle: 0, flip: false, zoom: 1, ox: 0, oy: 0, bg: 'blur', safe: true,
      bright: 0, contrast: 0, sat: 0, warm: 0, sharp: 0 };
    if(opts.ratio === 'orig'){ st.ratio = null; st.ratioId = 'orig'; }
    const initial = JSON.stringify({ratio:st.ratio, ratioId:st.ratioId});

    const wrap = ov.querySelector('.qe-stagewrap'), side = ov.querySelector('.qe-side');
    wrap.innerHTML = `<div class="qe-stage"><canvas></canvas><div class="qe-grid"></div><div class="qe-safe"><span>داخل هذا الإطار: مساحة آمنة للشعار</span></div></div>
      <div class="qe-zoom"><button type="button" data-z="-" aria-label="تصغير">−</button><input type="range" min="0.4" max="5" step="0.01" value="1" aria-label="التكبير"><button type="button" data-z="+" aria-label="تكبير">+</button><b>100%</b></div>
      <div class="qe-info"></div>`;
    side.innerHTML = `
      <div class="qe-sec"><h3>شكل الإطار</h3><div class="qe-btns" data-g="ratio">${RATIOS.map(r=>`<button type="button" data-v="${r.id}">${r.l}</button>`).join('')}</div></div>
      <div class="qe-sec"><h3>تدوير وقلب</h3><div class="qe-btns">
        <button type="button" data-a="rl">⟲ 90°</button><button type="button" data-a="rr">⟳ 90°</button><button type="button" data-a="flip">⇋ قلب</button><button type="button" data-a="center">⌖ توسيط</button></div>
        <div class="qe-sl" style="margin-top:8px"><span>استقامة</span><input type="range" data-k="angle" min="-15" max="15" step="0.5" value="0"><output>0°</output></div></div>
      <div class="qe-sec"><h3>الخلفية عند التصغير</h3><div class="qe-btns" data-g="bg">${BG.map(b=>`<button type="button" data-v="${b.id}">${b.l}</button>`).join('')}</div></div>
      <div class="qe-sec"><h3>الألوان والوضوح</h3>${ADJ.map(a=>`<div class="qe-sl"><span>${a.l}</span><input type="range" data-k="${a.k}" min="${a.min}" max="${a.max}" step="1" value="0"><output>0</output></div>`).join('')}
        <div class="qe-btns" style="margin-top:6px"><button type="button" data-a="auto">✨ تحسين تلقائي</button><button type="button" data-a="clearadj">بدون تعديل ألوان</button></div></div>
      <div class="qe-sec"><label class="qe-chk"><input type="checkbox" data-a="safe" checked> إظهار المساحة الآمنة للشعار (8%)</label>
        <div class="hint" style="margin-top:4px">اجعل شعار قدّاح داخل الإطار المتقطع حتى لا يُقص في البطاقات والصفحات.</div></div>`;

    const stage = wrap.querySelector('.qe-stage'), cv = stage.querySelector('canvas'), ctx = cv.getContext('2d', {willReadFrequently:true});
    const zr = wrap.querySelector('.qe-zoom input'), zb = wrap.querySelector('.qe-zoom b'), info = wrap.querySelector('.qe-info');
    let W = 0, H = 0, raf = 0;

    function layout(){
      const fr = frameRatio(st);
      const maxW = Math.min(wrap.clientWidth - 32, 560), maxH = Math.max(240, Math.min(window.innerHeight * (window.innerWidth <= 820 ? .5 : .62), 640));
      let w = maxW, h = w / fr; if(h > maxH){ h = maxH; w = h * fr; }
      stage.style.width = Math.round(w) + 'px'; stage.style.height = Math.round(h) + 'px';
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.width = Math.round(w * dpr); H = cv.height = Math.round(h * dpr);
      render();
    }
    function outSize(){
      const fr = frameRatio(st);
      let ow = fr >= 1 ? OUT_MAX : Math.round(OUT_MAX * fr), oh = fr >= 1 ? Math.round(OUT_MAX / fr) : OUT_MAX;
      // لا نكبّر أكثر من دقة الصورة الأصلية داخل الإطار
      const s = coverScale(st, ow, oh, st.full) * st.zoom;   // بكسل ناتج لكل بكسل أصلي
      let longSide = Math.max(ow, oh);
      if(s > 1) longSide = Math.round(longSide / s);
      longSide = Math.max(OUT_MIN, Math.min(OUT_MAX, longSide));
      // الطول والعرض من نفس النسبة حتى يبقى الإطار 4:5 بالضبط
      if(fr >= 1){ ow = longSide; oh = Math.round(longSide / fr); } else { oh = longSide; ow = Math.round(longSide * fr); }
      return {ow, oh, src: Math.round(Math.max(ow, oh) * Math.max(1, s))};
    }
    function render(){
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        draw(ctx, W, H, st, st.prev, true);
        const o = outSize(), low = Math.max(o.ow, o.oh) < 1000 && st.zoom > 1;
        info.className = 'qe-info' + (low ? ' warn' : '');
        info.textContent = `الصورة النهائية ${o.ow}×${o.oh}` + (low ? ' · تكبير كبير، قد تقل الجودة' : '');
        zr.value = st.zoom; zb.textContent = Math.round(st.zoom * 100) + '%';
        side.querySelectorAll('[data-g=ratio] button').forEach(b => b.classList.toggle('on', b.dataset.v === st.ratioId));
        side.querySelectorAll('[data-g=bg] button').forEach(b => b.classList.toggle('on', b.dataset.v === st.bg));
        side.querySelectorAll('.qe-sl input').forEach(i => { i.value = st[i.dataset.k]; i.nextElementSibling.textContent = st[i.dataset.k] + (i.dataset.k === 'angle' ? '°' : ''); });
        stage.querySelector('.qe-safe').style.display = st.safe ? '' : 'none';
      });
    }
    const clampZ = z => Math.max(0.4, Math.min(5, z));
    function zoomAt(z, fx, fy){   // fx,fy: نقطة التكبير نسبة لمركز الإطار (-0.5..0.5)
      const nz = clampZ(z), k = nz / st.zoom;
      st.ox = fx - (fx - st.ox) * k; st.oy = fy - (fy - st.oy) * k; st.zoom = nz; render();
    }

    // أدوات الجانب
    side.addEventListener('click', e => {
      const g = e.target.closest('[data-g] button');
      if(g){
        const grp = g.parentElement.dataset.g;
        if(grp === 'ratio'){ const r = RATIOS.find(x => x.id === g.dataset.v); st.ratioId = r.id; st.ratio = r.r; layout(); }
        else { st.bg = g.dataset.v; render(); }
        return;
      }
      const a = e.target.closest('button[data-a]'); if(!a) return;
      const act = a.dataset.a;
      if(act === 'rl'){ st.rot = (st.rot + 3) % 4; layout(); }
      else if(act === 'rr'){ st.rot = (st.rot + 1) % 4; layout(); }
      else if(act === 'flip'){ st.flip = !st.flip; render(); }
      else if(act === 'center'){ st.ox = 0; st.oy = 0; render(); }
      else if(act === 'auto'){ Object.assign(st, {bright: 4, contrast: 10, sat: 12, warm: 3, sharp: 25}); render(); }
      else if(act === 'clearadj'){ Object.assign(st, {bright: 0, contrast: 0, sat: 0, warm: 0, sharp: 0}); render(); }
    });
    side.addEventListener('input', e => {
      if(e.target.dataset.k){ st[e.target.dataset.k] = +e.target.value; render(); }
      else if(e.target.dataset.a === 'safe'){ st.safe = e.target.checked; render(); }
    });
    zr.addEventListener('input', () => zoomAt(+zr.value, 0, 0));
    wrap.querySelectorAll('[data-z]').forEach(b => b.onclick = () => zoomAt(st.zoom * (b.dataset.z === '+' ? 1.15 : 1/1.15), 0, 0));

    // سحب، وتكبير بإصبعين، وعجلة الفأرة
    const pts = new Map(); let last = null, pinch = null;
    stage.addEventListener('pointerdown', e => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, {x:e.clientX, y:e.clientY}); stage.classList.add('drag');
      if(pts.size === 2){ const [p1, p2] = [...pts.values()]; pinch = {d: Math.hypot(p1.x-p2.x, p1.y-p2.y), z: st.zoom}; } last = {x:e.clientX, y:e.clientY}; });
    stage.addEventListener('pointermove', e => {
      if(!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
      const r = stage.getBoundingClientRect();
      if(pts.size >= 2 && pinch){
        const [p1, p2] = [...pts.values()], d = Math.hypot(p1.x-p2.x, p1.y-p2.y);
        const cx = ((p1.x+p2.x)/2 - r.left)/r.width - .5, cy = ((p1.y+p2.y)/2 - r.top)/r.height - .5;
        zoomAt(pinch.z * d / pinch.d, cx, cy); return;
      }
      if(last){ st.ox += (e.clientX - last.x) / r.width; st.oy += (e.clientY - last.y) / r.height; last = {x:e.clientX, y:e.clientY}; render(); }
    });
    const up = e => { pts.delete(e.pointerId); if(pts.size < 2) pinch = null; if(!pts.size){ stage.classList.remove('drag'); last = null; } else { const p = [...pts.values()][0]; last = {x:p.x, y:p.y}; } };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', e => { e.preventDefault(); const r = stage.getBoundingClientRect();
      zoomAt(st.zoom * (e.deltaY < 0 ? 1.08 : 1/1.08), (e.clientX - r.left)/r.width - .5, (e.clientY - r.top)/r.height - .5); }, {passive:false});
    stage.addEventListener('dblclick', () => { st.zoom = 1; st.ox = 0; st.oy = 0; render(); });

    ov.querySelector('[data-reset]').onclick = () => {
      Object.assign(st, {rot:0, angle:0, flip:false, zoom:1, ox:0, oy:0, bg:'blur', bright:0, contrast:0, sat:0, warm:0, sharp:0}, JSON.parse(initial)); layout();
    };
    const okBtn = ov.querySelector('[data-ok]');
    okBtn.disabled = false;
    okBtn.onclick = async () => {
      okBtn.disabled = true; okBtn.textContent = 'جارٍ التجهيز...';
      await new Promise(r => setTimeout(r, 30));
      try{
        const o = outSize(), c = document.createElement('canvas'); c.width = o.ow; c.height = o.oh;
        draw(c.getContext('2d', {willReadFrequently:true}), o.ow, o.oh, st, st.full, false);
        const toBlob = t => new Promise(r => c.toBlob(r, t, QUALITY));
        let blob = await toBlob('image/webp'), ext = 'webp';
        if(!blob || blob.type !== 'image/webp'){ blob = await toBlob('image/jpeg'); ext = 'jpg'; }
        if(!blob) throw new Error('تعذّر حفظ الصورة');
        const file = new File([blob], 'edited.' + ext, {type: blob.type});
        file._qadahEdited = true;    // جاهزة: لا تُضغط مرة ثانية عند الرفع
        finish(file);
      }catch(e){ okBtn.disabled = false; okBtn.textContent = '✓ استخدم الصورة'; alert(e.message || 'تعذّر حفظ الصورة'); }
    };
    window.addEventListener('resize', layout, {once:false});
    const ro = new MutationObserver(() => { if(!document.body.contains(ov)){ window.removeEventListener('resize', layout); ro.disconnect(); } });
    ro.observe(document.body, {childList:true});
    layout();
    return result;
  }

  window.QadahImageEditor = { open };
})();
