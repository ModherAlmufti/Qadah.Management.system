/* =====================================================================
   Qadah dashboard: Bulk pricing tab (التسعير الجماعي). Admin + editor (pricing officer).
   One table for every product: cost, profit %, price, with a save button per row,
   "save all", and Excel export / import.

   Reads (from the dashboard, through getters): products, product_costs map, suppliers.
   Writes: products (price, margin only), product_costs (supplier_price only).
   No SQL needed: the same RLS and triggers as the product window apply
   (the pricing officer may change price / margin only).

   Meaning of the percentage (same as the product window): profit over cost.
       price  = cost x (1 + margin / 100), rounded to the nearest 500
       margin = (price - cost) / cost x 100

   Usage (inside index.html):
     <script src="pricing.js"></script>
     QadahPricing.mount(el, { sb, getProducts, getCosts, getSuppliers, onSaved });
     QadahPricing.refresh();   // call again whenever the tab is opened
   ===================================================================== */
(function () {
  'use strict';

  var STEP = 500;
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  var sb = null, root = null, opts = null, mounted = false;
  var S = { rows: [], byId: {}, q: '', view: 'live', saving: false, msg: null };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function roundTo(n, step) { return Math.round(n / step) * step; }
  /* Arabic-Indic digits, thousands separators, spaces and % are removed */
  function norm(v) {
    if (v == null) return '';
    return String(v)
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/٫/g, '.')
      .replace(/[٬,،\s%٪]/g, '');
  }
  function isNum(s) { return s !== '' && s != null && isFinite(Number(s)); }
  function num(s) { return isNum(s) ? Number(s) : NaN; }
  function today() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  /* ---------- rows ---------- */
  function makeRow(p, cost) {
    var c = cost && cost.supplier_price != null ? String(cost.supplier_price) : '';
    var o = { cost: c, margin: p.margin == null ? '' : String(p.margin), price: String(p.price == null ? '' : p.price), nameEn: p.name_en || '' };
    return {
      id: p.id, code: p.code, name: p.name_ar || '', nameEn: p.name_en || '', status: p.product_status || '', img: p.image_url || '',
      supplierId: cost ? cost.supplier_id : null, hasCostRow: !!cost,
      orig: o, cur: { cost: o.cost, margin: o.margin, price: o.price, nameEn: o.nameEn }, err: '', busy: false
    };
  }
  function isDirty(r) {
    return r.cur.cost !== r.orig.cost || r.cur.margin !== r.orig.margin || r.cur.price !== r.orig.price || r.cur.nameEn !== r.orig.nameEn;
  }
  function dirtyRows() { return S.rows.filter(isDirty); }

  function rebuild() {
    var prods = opts.getProducts() || [], costs = opts.getCosts() || {}, old = S.byId, byId = {};
    S.rows = prods.map(function (p) {
      var r = makeRow(p, costs[p.id]);
      var prev = old[p.id];
      if (prev && isDirty(prev)) { r.cur = prev.cur; r.err = prev.err; }   // keep unsaved edits
      byId[p.id] = r;
      return r;
    });
    S.byId = byId;
  }

  /* The same rules as the product window (recalcPricing in index.html) */
  function applyEdit(r, field, value) {
    var c = r.cur;
    c[field] = value;
    var cost = num(c.cost), had = num(r.orig.cost) > 0;
    if (field === 'price') {
      if (cost > 0 && isNum(c.price)) c.margin = String(Math.round((num(c.price) - cost) / cost * 100));
    } else if (field === 'margin') {
      if (cost > 0 && isNum(c.margin)) c.price = String(roundTo(cost * (1 + num(c.margin) / 100), STEP));
    } else if (cost > 0) {            // cost edited
      if (!had) { if (isNum(c.price)) c.margin = String(Math.round((num(c.price) - cost) / cost * 100)); }
      else if (isNum(c.margin)) c.price = String(roundTo(cost * (1 + num(c.margin) / 100), STEP));
    }
  }

  function validate(r) {
    var c = r.cur;
    if (!/^\d+$/.test(c.price)) return 'السعر يجب أن يكون رقماً صحيحاً';
    if (c.cost !== '' && !/^\d+$/.test(c.cost)) return 'التكلفة يجب أن تكون رقماً صحيحاً';
    if (c.margin !== '' && !isNum(c.margin)) return 'نسبة الربح غير صحيحة';
    if (c.nameEn.length > 200) return 'الاسم الإنجليزي طويل جداً';
    return '';
  }

  /* ---------- saving ---------- */
  async function saveRow(r) {
    var e = validate(r);
    if (e) { r.err = e; paintRow(r); return false; }
    r.busy = true; r.err = ''; paintRow(r);
    var ok = true;
    try {
      var c = r.cur, o = r.orig;
      if (c.price !== o.price || c.margin !== o.margin || c.nameEn !== o.nameEn) {
        var upd = {};
        if (c.price !== o.price) upd.price = parseInt(c.price, 10);
        if (c.margin !== o.margin && c.margin !== '') upd.margin = Math.round(Number(c.margin));
        if (c.nameEn !== o.nameEn) upd.name_en = c.nameEn;
        if (Object.keys(upd).length) {
          var res = await sb.from('products').update(upd).eq('id', r.id).select('id');
          if (res.error) throw res.error;
          if (!res.data || !res.data.length) throw new Error('لا توجد صلاحية لتعديل هذا الصنف');
          if (upd.price != null) o.price = String(upd.price);
          if (upd.margin != null) o.margin = String(upd.margin);
          if (upd.name_en != null) o.nameEn = upd.name_en;
        }
        c.price = o.price; c.margin = o.margin;     // margin cleared by hand goes back to the saved one
      }
      if (c.cost !== o.cost) {
        var sp = c.cost === '' ? null : parseInt(c.cost, 10), now = new Date().toISOString();
        var rc = r.hasCostRow
          ? await sb.from('product_costs').update({ supplier_price: sp, updated_at: now }).eq('product_id', r.id).select('product_id')
          : await sb.from('product_costs').insert({ product_id: r.id, supplier_id: null, supplier_price: sp, updated_at: now }).select('product_id');
        if (rc.error) throw rc.error;
        if (!rc.data || !rc.data.length) throw new Error('لا توجد صلاحية لتعديل التكلفة');
        r.hasCostRow = true; o.cost = c.cost;
      }
    } catch (ex) {
      ok = false; r.err = ex && ex.message ? ex.message : 'تعذّر الحفظ';
    }
    r.busy = false;
    paintRow(r); paintBar();
    return ok;
  }

  async function saveOne(id) {
    var r = S.byId[id]; if (!r || S.saving || !isDirty(r)) return;
    var ok = await saveRow(r);
    if (ok) { await afterSave(); toast('تم حفظ: ' + r.name); }
    else toast('تعذّر حفظ الصنف');
  }

  async function saveAll() {
    if (S.saving) return;
    var list = dirtyRows();
    if (!list.length) return;
    var bad = list.filter(function (r) { return validate(r); });
    bad.forEach(function (r) { r.err = validate(r); paintRow(r); });
    list = list.filter(function (r) { return !validate(r); });
    if (!list.length) { toast('صحّح الأخطاء أولاً'); return; }
    var big = list.filter(function (r) {
      var a = num(r.orig.price), b = num(r.cur.price);
      return a > 0 && Math.abs(b - a) / a > 0.5;
    }).length;
    var text = 'سيتم حفظ تعديلات ' + list.length + ' صنف.' +
      (big ? '\n\nتنبيه: ' + big + ' صنف تغيّر سعره بأكثر من 50%. راجعها قبل المتابعة.' : '') +
      (bad.length ? '\n\n' + bad.length + ' صنف فيه أخطاء ولن يُحفظ.' : '') + '\n\nمتابعة؟';
    if (!window.confirm(text)) return;

    S.saving = true; paintBar();
    var done = 0, fail = 0, i = 0;
    async function worker() {
      while (i < list.length) {
        var r = list[i++];
        var ok = await saveRow(r);
        if (ok) done++; else fail++;
        paintBar('جارٍ الحفظ ' + (done + fail) + ' / ' + list.length);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    S.saving = false;
    await afterSave();
    setMsg(fail ? 'err' : 'ok',
      'تم حفظ ' + done + ' صنف' + (fail ? ' وفشل ' + fail + ' (ظاهرة بالأحمر في الجدول).' : '.'));
  }

  async function afterSave() {
    try { if (opts.onSaved) await opts.onSaved(); } catch (e) { console.warn('pricing onSaved', e); }
    rebuild(); renderBody(); paintBar();
  }

  function discardAll() {
    var n = dirtyRows().length; if (!n || S.saving) return;
    if (!window.confirm('التراجع عن ' + n + ' تعديل غير محفوظ؟')) return;
    S.rows.forEach(function (r) { r.cur = { cost: r.orig.cost, margin: r.orig.margin, price: r.orig.price, nameEn: r.orig.nameEn }; r.err = ''; });
    setMsg(null); renderBody(); paintBar();
  }

  /* ---------- Excel / CSV ---------- */
  var xlsxPromise = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = function () { window.XLSX ? res(window.XLSX) : rej(new Error('xlsx')); };
      s.onerror = function () { xlsxPromise = null; rej(new Error('xlsx load')); };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  var HEAD = ['رقم الصنف', 'اسم الصنف', 'الاسم بالإنجليزي', 'الحالة', 'المورد', 'التكلفة', 'نسبة الربح %', 'السعر'];

  function supplierName(r) {
    var list = (opts.getSuppliers && opts.getSuppliers()) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === r.supplierId) return list[i].name || '';
    return '';
  }
  function exportRows() {
    return S.rows.map(function (r) {
      return [r.code, r.name, r.cur.nameEn, r.status, supplierName(r),
        r.cur.cost === '' ? '' : Number(r.cur.cost),
        r.cur.margin === '' ? '' : Number(r.cur.margin),
        isNum(r.cur.price) ? Number(r.cur.price) : r.cur.price];
    });
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  async function exportFile() {
    var rows = exportRows();
    try {
      var X = await loadXlsx();
      var ws = X.utils.aoa_to_sheet([HEAD].concat(rows));
      ws['!cols'] = [{ wch: 10 }, { wch: 34 }, { wch: 34 }, { wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
      var help = X.utils.aoa_to_sheet([
        ['كيف تستخدم هذا الملف'],
        ['1. عدّل الأعمدة: التكلفة، نسبة الربح %، السعر. لا تغيّر عمود "رقم الصنف" لأنه المفتاح.'],
        ['2. غيّر عموداً واحداً فقط من الثلاثة لكل صنف، والباقي يُحسب عند الاستيراد: السعر = التكلفة × (1 + النسبة)، ويُقرَّب لأقرب 500.'],
        ['3. إن غيّرت السعر، تُحسب النسبة من السعر والتكلفة. وإن غيّرت الاثنين معاً فالسعر هو المعتمد.'],
        ['4. يمكنك تعديل عمود "الاسم بالإنجليزي" أيضاً (للمدير فقط). الخلية الفارغة تعني "بدون تغيير" في كل الأعمدة.'],
        ['5. ارفع الملف من زر "استيراد Excel". يظهر الجدول معدّلاً دون حفظ، ثم اضغط "حفظ الكل".']
      ]);
      help['!cols'] = [{ wch: 110 }];
      var wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, 'الأسعار');
      X.utils.book_append_sheet(wb, help, 'تعليمات');
      var out = X.write(wb, { bookType: 'xlsx', type: 'array' });
      download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), today() + '_catalog_prices.xlsx');
      setMsg('ok', 'تم تنزيل ملف Excel.');
    } catch (e) {
      /* offline or CDN blocked: fall back to CSV (opens in Excel) */
      var lines = [HEAD].concat(rows).map(function (row) {
        return row.map(function (v) { v = v == null ? '' : String(v); return '"' + v.replace(/"/g, '""') + '"'; }).join(',');
      });
      download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), today() + '_catalog_prices.csv');
      setMsg('ok', 'تعذّر تحميل مكتبة Excel، فنُزّل الملف بصيغة CSV (يفتح في Excel).');
    }
  }

  function headerKey(h) {
    var s = String(h == null ? '' : h).toLowerCase().replace(/[\s%()٪_\-]/g, '');
    if (!s) return null;
    if (s.indexOf('إنجليزي') >= 0 || s.indexOf('انجليزي') >= 0 || s.indexOf('english') >= 0 || s.indexOf('nameen') >= 0 || s.indexOf('name_en') >= 0) return 'nameEn';
    if (s.indexOf('رقم') >= 0 || s.indexOf('الكود') >= 0 || s === 'code' || s === 'id' || s.indexOf('item') >= 0) return 'code';
    if (s.indexOf('تكلفة') >= 0 || s.indexOf('cost') >= 0) return 'cost';
    if (s.indexOf('نسبة') >= 0 || s.indexOf('margin') >= 0 || s.indexOf('ربح') >= 0) return 'margin';
    if (s.indexOf('سعر') >= 0 || s.indexOf('price') >= 0) return 'price';
    return null;
  }

  async function importFile(file) {
    if (!file) return;
    var rep = { matched: 0, changed: 0, unknown: [], invalid: [], names: 0, namesSkipped: 0 };
    try {
      var X = await loadXlsx(), wb;
      if (/\.csv$/i.test(file.name)) wb = X.read(await file.text(), { type: 'string' });
      else wb = X.read(await file.arrayBuffer(), { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var data = X.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
      if (!data.length) throw new Error('الملف فارغ');
      var cols = {}, hdr = data[0];
      hdr.forEach(function (h, i) { var k = headerKey(h); if (k && cols[k] == null) cols[k] = i; });
      if (cols.code == null) throw new Error('لم أجد عمود "رقم الصنف" في الصف الأول');
      if (cols.cost == null && cols.margin == null && cols.price == null && cols.nameEn == null) throw new Error('لم أجد أعمدة التكلفة أو النسبة أو السعر أو الاسم الإنجليزي');
      var byCode = {};
      S.rows.forEach(function (r) { byCode[String(r.code)] = r; });

      for (var n = 1; n < data.length; n++) {
        var row = data[n];
        var code = norm(row[cols.code]);
        if (code === '') continue;
        var r = byCode[code];
        if (!r) { rep.unknown.push(code); continue; }
        rep.matched++;
        var before = JSON.stringify(r.cur);
        ['cost', 'margin', 'price'].forEach(function (f) {
          if (cols[f] == null) return;
          var raw = row[cols[f]];
          if (raw === '' || raw == null) return;             // empty = no change
          var v = norm(raw);
          if (!isNum(v) || Number(v) < 0 && f !== 'margin') { rep.invalid.push(r.code + ' (' + f + ')'); return; }
          if (f !== 'margin') v = String(Math.round(Number(v)));
          else v = String(Number(v));
          if (v === r.orig[f]) return;                         // same as the saved value = not changed in the file
          applyEdit(r, f, v);
        });
        if (cols.nameEn != null) {
          var nm = String(row[cols.nameEn] == null ? '' : row[cols.nameEn]).replace(/\s+/g, ' ').trim();
          if (nm !== '' && nm !== r.orig.nameEn) {
            if (!opts.canEditNames) rep.namesSkipped++;
            else if (nm.length > 200) rep.invalid.push(r.code + ' (name)');
            else { r.cur.nameEn = nm; rep.names++; }
          }
        }
        if (JSON.stringify(r.cur) !== before) rep.changed++;
      }
      renderBody(); paintBar();
      var t = 'قُرئ الملف: ' + rep.matched + ' صنف مطابق، ' + rep.changed + ' منها تغيّرت. التعديلات غير محفوظة حتى تضغط "حفظ الكل".';
      if (rep.names) t += ' أسماء إنجليزية معدّلة: ' + rep.names + '.';
      if (rep.namesSkipped) t += ' تعديل الأسماء الإنجليزية للمدير فقط، فتم تجاهل ' + rep.namesSkipped + ' اسم.';
      if (rep.unknown.length) t += ' أرقام غير موجودة (تم تجاهلها): ' + rep.unknown.slice(0, 8).join('، ') + (rep.unknown.length > 8 ? '…' : '') + '.';
      if (rep.invalid.length) t += ' قيم غير صالحة (تم تجاهلها): ' + rep.invalid.slice(0, 8).join('، ') + (rep.invalid.length > 8 ? '…' : '') + '.';
      setMsg(rep.unknown.length || rep.invalid.length || rep.namesSkipped ? 'warn' : 'ok', t);
      if (rep.changed) { S.view = 'changed'; var sel = root.querySelector('#qpView'); if (sel) sel.value = 'changed'; renderBody(); }
    } catch (e) {
      setMsg('err', 'تعذّر قراءة الملف: ' + (e && e.message ? e.message : e));
    }
  }

  /* ---------- UI ---------- */
  var CSS = [
    '.qp{font-family:inherit;color:var(--ink,#24303c)}',
    '.qp h2{font-size:20px;margin-bottom:4px}',
    '.qp-sub{color:var(--ink-soft,#8f8781);font-size:13px;margin-bottom:14px}',
    '.qp-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}',
    '.qp-tools input[type=search],.qp-tools select{padding:9px 12px;border:1px solid var(--line,#ece2d4);border-radius:12px;background:var(--surface,#fffdfa);font:inherit;color:inherit}',
    '.qp-tools input[type=search]{min-width:220px;flex:1;max-width:340px}',
    '.qp-btn{padding:9px 16px;border-radius:12px;border:1px solid var(--line,#ece2d4);background:var(--surface,#fffdfa);color:var(--ink,#24303c);font:inherit;font-weight:700;cursor:pointer}',
    '.qp-btn:hover:not(:disabled){border-color:var(--rose-strong,#c98578)}',
    '.qp-btn:disabled{opacity:.45;cursor:default}',
    '.qp-btn.primary{background:var(--navy,#01183a);color:#fdf6ec;border-color:var(--navy,#01183a)}',
    '.qp-spacer{flex:1}',
    '.qp-msg{padding:10px 14px;border-radius:12px;margin-bottom:12px;font-size:14px;display:flex;gap:10px;align-items:flex-start;justify-content:space-between}',
    '.qp-msg.ok{background:var(--green-soft,#E9EDE0);color:#3d4a2c}',
    '.qp-msg.warn{background:#fbf0d9;color:#6b4a0f}',
    '.qp-msg.err{background:#f8e1e1;color:#8c2a2a}',
    '.qp-msg button{background:none;border:0;font-size:18px;cursor:pointer;color:inherit;line-height:1}',
    '.qp-wrap{overflow:auto;max-height:68vh;border:1px solid var(--line,#ece2d4);border-radius:16px;background:var(--surface,#fffdfa)}',
    '.qp table{width:100%;min-width:780px;border-collapse:collapse}',
    '.qp th{position:sticky;top:0;z-index:2;background:var(--card,#f5ede0);text-align:right;font-size:13px;padding:10px 10px;border-bottom:1px solid var(--line,#ece2d4);white-space:nowrap}',
    '.qp td{padding:8px 10px;border-bottom:1px solid var(--line,#ece2d4);vertical-align:middle}',
    '.qp tr.dirty td{background:var(--rose-soft,#f4e4df)}',
    '.qp tr.stopped .qp-name b{color:var(--ink-soft,#8f8781)}',
    '.qp tr.haserr td{box-shadow:inset 0 -2px 0 var(--danger,#B23A3A)}',
    '.qp-code{color:var(--ink-soft,#8f8781);font-size:13px;direction:ltr;text-align:center}',
    '.qp-name{display:flex;gap:10px;align-items:center;min-width:230px}',
    '.qp-name img{width:42px;height:42px;border-radius:10px;object-fit:cover;background:var(--card,#f5ede0);flex:none}',
    '.qp-name small{display:block;color:var(--ink-soft,#8f8781);font-size:12px}',
    '.qp-en{text-align:left}',
    '.qp-en.ch{color:var(--rose-strong,#c98578);font-weight:700}',
    '.qp-err{display:block;color:var(--danger,#B23A3A);font-size:12px;font-weight:700}',
    '.qp input.qp-in{width:112px;padding:8px 10px;border:1px solid var(--line,#ece2d4);border-radius:10px;font:inherit;text-align:left;direction:ltr;background:#fff;color:inherit}',
    '.qp input.qp-in.m{width:78px}',
    '.qp input.qp-in:focus{outline:2px solid var(--rose,#dca096);border-color:var(--rose-strong,#c98578)}',
    '.qp input.qp-in.ch{border-color:var(--rose-strong,#c98578);background:#fffaf7}',
    '.qp-note{display:block;font-size:12px;color:var(--ink-soft,#8f8781);direction:ltr;text-align:left;min-height:16px}',
    '.qp-warn{color:var(--gold,#B8863B);font-size:12px;cursor:help;margin-inline-start:4px}',
    '.qp-profit{white-space:nowrap;direction:ltr;text-align:left;font-weight:700}',
    '.qp-profit.neg{color:var(--danger,#B23A3A)}',
    '.qp-profit small{display:block;font-weight:400;color:var(--ink-soft,#8f8781)}',
    '.qp-bar{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px;padding:12px 14px;background:var(--surface,#fffdfa);border:1px solid var(--line,#ece2d4);border-radius:14px;box-shadow:var(--shadow,0 2px 10px rgba(1,24,58,.06))}',
    '.qp-count{font-weight:700}',
    '.qp-empty{padding:30px;text-align:center;color:var(--ink-soft,#8f8781)}'
  ].join('\n');

  function toast(t) { var el = document.getElementById('toast'); if (!el) return; el.textContent = t; el.classList.add('show'); setTimeout(function () { el.classList.remove('show'); }, 2600); }

  function setMsg(kind, text) { S.msg = kind ? { kind: kind, text: text } : null; paintMsg(); }
  function paintMsg() {
    var box = root.querySelector('#qpMsg'); if (!box) return;
    box.innerHTML = S.msg ? '<div class="qp-msg ' + S.msg.kind + '"><span>' + esc(S.msg.text) + '</span><button type="button" data-act="closeMsg" aria-label="إغلاق">×</button></div>' : '';
  }

  function visible(r) {
    var v = S.view;
    if (v === 'live' && r.status === 'متوقف') return false;
    if (v === 'stopped' && r.status !== 'متوقف') return false;
    if (v === 'changed' && !isDirty(r)) return false;
    if (v === 'nocost' && num(r.cur.cost) > 0) return false;
    if (S.q) {
      var q = S.q.toLowerCase();
      if ((r.name + ' ' + r.cur.nameEn + ' ' + r.code).toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }

  function rowHtml(r) {
    return '<tr data-id="' + esc(r.id) + '">' +
      '<td class="qp-code">' + esc(r.code) + '</td>' +
      '<td><div class="qp-name">' + (r.img ? '<img loading="lazy" decoding="async" alt="" src="' + esc(r.img) + '">' : '<img alt="">') +
      '<div><b>' + esc(r.name) + '</b><small>' + esc([supplierName(r), r.status && r.status !== 'نشط' ? r.status : ''].filter(Boolean).join(' · ')) + '</small><small class="qp-en" data-n="en" dir="ltr"></small>' +
      '<span class="qp-err"></span></div></div></td>' +
      '<td><input class="qp-in" data-f="cost" inputmode="numeric" autocomplete="off" aria-label="التكلفة"><span class="qp-note" data-n="cost"></span></td>' +
      '<td><input class="qp-in m" data-f="margin" inputmode="decimal" autocomplete="off" aria-label="نسبة الربح"><span class="qp-warn" data-n="warn" hidden>⚠</span></td>' +
      '<td><input class="qp-in" data-f="price" inputmode="numeric" autocomplete="off" aria-label="السعر"><span class="qp-note" data-n="price"></span></td>' +
      '<td class="qp-profit" data-n="profit"></td>' +
      '<td><button type="button" class="qp-btn" data-act="save">حفظ</button></td></tr>';
  }

  function renderBody() {
    var body = root.querySelector('#qpBody'); if (!body) return;
    var list = S.rows.filter(visible);
    body.innerHTML = list.length ? list.map(rowHtml).join('') : '<tr><td colspan="7" class="qp-empty">لا توجد أصناف مطابقة</td></tr>';
    list.forEach(function (r) { paintRow(r); });
    var cnt = root.querySelector('#qpShown');
    if (cnt) cnt.textContent = list.length + ' من ' + S.rows.length + ' صنف';
  }

  function paintRow(r, skipField) {
    var tr = root.querySelector('tr[data-id="' + (window.CSS && CSS.escape ? CSS.escape(r.id) : r.id) + '"]');
    if (!tr) return;
    var dirty = isDirty(r);
    tr.classList.toggle('dirty', dirty);
    tr.classList.toggle('haserr', !!r.err);
    tr.classList.toggle('stopped', r.status === 'متوقف');
    ['cost', 'margin', 'price'].forEach(function (f) {
      var inp = tr.querySelector('input[data-f="' + f + '"]');
      if (f !== skipField && inp.value !== r.cur[f]) inp.value = r.cur[f];
      inp.classList.toggle('ch', r.cur[f] !== r.orig[f]);
      inp.disabled = r.busy || S.saving;
    });
    tr.querySelector('.qp-err').textContent = r.err || '';
    var en = tr.querySelector('[data-n="en"]');
    en.textContent = r.cur.nameEn;
    en.classList.toggle('ch', r.cur.nameEn !== r.orig.nameEn);
    en.title = r.cur.nameEn !== r.orig.nameEn ? 'كان: ' + (r.orig.nameEn || '(فارغ)') : '';
    var cost = num(r.cur.cost), price = num(r.cur.price);
    var oPrice = num(r.orig.price);
    var pn = tr.querySelector('[data-n="price"]');
    pn.textContent = isNaN(price) ? '' : fmt(price) + (r.cur.price !== r.orig.price && !isNaN(oPrice)
      ? '  (\u200E' + (price - oPrice >= 0 ? '+' : '-') + fmt(Math.abs(price - oPrice)) + ')' : '');
    var cn = tr.querySelector('[data-n="cost"]');
    cn.textContent = isNaN(cost) ? '' : fmt(cost);
    var pf = tr.querySelector('[data-n="profit"]');
    if (cost > 0 && !isNaN(price)) {
      var profit = price - cost;
      pf.innerHTML = fmt(profit) + '<small>' + (Math.round(profit / cost * 100)) + '% على التكلفة</small>';
      pf.classList.toggle('neg', profit < 0);
    } else { pf.textContent = '—'; pf.classList.remove('neg'); }
    /* the saved percentage does not match price and cost (old data from before the auto calculation) */
    var warn = tr.querySelector('[data-n="warn"]');
    var mism = cost > 0 && !isNaN(price) && isNum(r.cur.margin) && Math.abs(Math.round((price - cost) / cost * 100) - num(r.cur.margin)) > 1;
    warn.hidden = !mism;
    if (mism) warn.title = 'النسبة المخزّنة لا تطابق السعر والتكلفة. النسبة الفعلية ' + Math.round((price - cost) / cost * 100) + '%';
    var btn = tr.querySelector('[data-act="save"]');
    btn.disabled = !dirty || r.busy || S.saving;
    btn.textContent = r.busy ? '...' : 'حفظ';
  }

  function paintBar(progress) {
    var n = dirtyRows().length;
    var c = root.querySelector('#qpCount'); if (c) c.textContent = progress || (n ? n + ' تعديل غير محفوظ' : 'لا توجد تعديلات غير محفوظة');
    var a = root.querySelector('#qpSaveAll'); if (a) { a.disabled = !n || S.saving; a.textContent = S.saving ? 'جارٍ الحفظ...' : 'حفظ الكل' + (n ? ' (' + n + ')' : ''); }
    var d = root.querySelector('#qpDiscard'); if (d) d.disabled = !n || S.saving;
  }

  function build() {
    if (!document.getElementById('qpStyle')) {
      var st = document.createElement('style'); st.id = 'qpStyle'; st.textContent = CSS; document.head.appendChild(st);
    }
    root.innerHTML =
      '<div class="qp">' +
      '<h2>التسعير الجماعي</h2>' +
      '<div class="qp-sub">عدّل التكلفة أو نسبة الربح أو السعر مباشرة، والباقي يُحسب تلقائياً. الأسماء الإنجليزية تُعدَّل من ملف Excel. نسبة الربح على التكلفة: السعر = التكلفة × (1 + النسبة)، ويُقرَّب لأقرب 500. التعديلات لا تُحفظ حتى تضغط حفظ.</div>' +
      '<div class="qp-tools">' +
      '<input type="search" id="qpSearch" placeholder="بحث بالاسم أو الرقم" aria-label="بحث">' +
      '<select id="qpView" aria-label="عرض"><option value="live">الأصناف المعروضة</option><option value="stopped">الأصناف الموقوفة</option><option value="all">كل الأصناف</option><option value="nocost">بدون تكلفة</option><option value="changed">المعدّلة فقط</option></select>' +
      '<span id="qpShown" class="qp-sub" style="margin:0"></span><span class="qp-spacer"></span>' +
      '<button type="button" class="qp-btn" data-act="export">تصدير Excel</button>' +
      '<button type="button" class="qp-btn" data-act="import">استيراد Excel</button>' +
      '<input type="file" id="qpFile" accept=".xlsx,.xls,.csv" hidden>' +
      '</div>' +
      '<div id="qpMsg"></div>' +
      '<div class="qp-wrap"><table><thead><tr><th>الرقم</th><th>الصنف</th><th>التكلفة (د.ع)</th><th>نسبة الربح %</th><th>السعر (د.ع)</th><th>الربح</th><th></th></tr></thead><tbody id="qpBody"></tbody></table></div>' +
      '<div class="qp-bar"><span class="qp-count" id="qpCount"></span><span class="qp-spacer"></span>' +
      '<button type="button" class="qp-btn" id="qpDiscard" data-act="discard">تراجع عن الكل</button>' +
      '<button type="button" class="qp-btn primary" id="qpSaveAll" data-act="saveAll">حفظ الكل</button></div>' +
      '</div>';

    root.querySelector('#qpSearch').addEventListener('input', function (e) { S.q = e.target.value.trim(); renderBody(); });
    root.querySelector('#qpView').addEventListener('change', function (e) { S.view = e.target.value; renderBody(); });
    root.querySelector('#qpFile').addEventListener('change', function (e) { var f = e.target.files[0]; e.target.value = ''; importFile(f); });

    root.addEventListener('input', function (e) {
      var inp = e.target; var f = inp.getAttribute && inp.getAttribute('data-f'); if (!f) return;
      var tr = inp.closest('tr'); var r = S.byId[tr.getAttribute('data-id')]; if (!r) return;
      var v = norm(inp.value);
      if (v !== inp.value) inp.value = v;
      r.err = '';
      applyEdit(r, f, v);
      paintRow(r, f); paintBar();
    });
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var inp = e.target; var f = inp.getAttribute && inp.getAttribute('data-f'); if (!f) return;
      e.preventDefault();
      var tr = inp.closest('tr'), next = tr.nextElementSibling;
      while (next && !next.querySelector('input[data-f="' + f + '"]')) next = next.nextElementSibling;
      if (next) { var ni = next.querySelector('input[data-f="' + f + '"]'); ni.focus(); ni.select(); next.scrollIntoView({ block: 'nearest' }); }
    });
    root.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches('input[data-f]')) e.target.select(); });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'save') saveOne(b.closest('tr').getAttribute('data-id'));
      else if (act === 'saveAll') saveAll();
      else if (act === 'discard') discardAll();
      else if (act === 'export') exportFile();
      else if (act === 'import') root.querySelector('#qpFile').click();
      else if (act === 'closeMsg') setMsg(null);
    });
    window.addEventListener('beforeunload', function (e) {
      if (dirtyRows().length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ---------- public ---------- */
  function mount(el, options) {
    root = el; opts = options; sb = options.sb;
    build(); mounted = true;
    refresh();
  }
  function refresh() {
    if (!mounted) return;
    rebuild(); renderBody(); paintBar(); paintMsg();
  }

  window.QadahPricing = { mount: mount, refresh: refresh, dirtyCount: function () { return dirtyRows().length; } };
})();
