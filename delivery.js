/* =====================================================================
   Qadah dashboard: Delivery tab (التوصيل) — revamp step 2(b), part 3.
   Manages: delivery_slots, delivery_settings (same-day cutoff), delivery_areas.
   Reads delivery_settings_public for the current Baghdad time.
   Requires 2026-10-20_db_delivery-slots-areas_v1.sql.

   Staff (admin / editor / viewer) can read. Only the admin can change anything
   (RLS enforces it in the database too).

   Usage (inside index.html):
     <script src="delivery.js"></script>
     QadahDelivery.mount(document.getElementById('delivery-root'), sb, { canEdit: ROLE === 'admin' });
     QadahDelivery.refresh();   // when the tab is opened
   ===================================================================== */
(function () {
  'use strict';

  var sb = null, root = null, canEdit = false, busy = false;
  var S = { slots: [], areas: [], settings: null, pub: null };
  var edit = { slot: null, area: null }; // id being edited, or 'new'

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel) { return root.querySelector(sel); }
  function hm(t) { return t ? String(t).slice(0, 5) : ''; }           // "16:00:00" -> "16:00"
  function ampm(t) {                                                   // "16:00" -> "4:00 م"
    if (!t) return '';
    var p = String(t).split(':'), h = Number(p[0]), m = p[1] || '00';
    var suf = h < 12 ? 'ص' : 'م'; var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + m + ' ' + suf;
  }
  function msg(text, isError) {
    var el = $('.dlv-msg'); if (!el) return;
    el.textContent = text || '';
    el.className = 'dlv-msg' + (isError ? ' err' : '') + (text ? ' on' : '');
    if (text && !isError) setTimeout(function () { if (el.textContent === text) msg(''); }, 3000);
  }
  function errText(e) {
    if (!e) return 'حدث خطأ';
    var m = String(e.message || ''), c = String(e.code || '');
    if (c === '23505' || /duplicate key|unique/i.test(m)) return 'الاسم موجود مسبقاً.';
    if (/delivery_slots_time_range/.test(m)) return 'وقت النهاية يجب أن يكون بعد وقت البداية.';
    if (/not_blank/.test(m)) return 'الاسم مطلوب.';
    if (c === '42501' || /row-level security|permission denied/i.test(m)) return 'هذا الإجراء للمدير فقط.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'تعذّر الاتصال. تحقق من الإنترنت وأعد المحاولة.';
    return m || 'حدث خطأ';
  }
  function setBusy(on) {
    busy = on;
    root.querySelectorAll('.dlv button, .dlv input, .dlv textarea').forEach(function (b) {
      if (b.dataset.keep) return;
      if (on) { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; }
      else { b.disabled = b.dataset.wasDisabled === '1'; }
    });
  }

  /* ---------- styles (dashboard tokens with fallbacks) ---------- */
  var CSS = [
    '.dlv{--dn:var(--navy,#01183a);--dr:var(--rose-strong,#c98578);--drs:var(--rose-soft,#f4e4df);--dc:var(--surface,#fffdfa);',
    '--di:var(--ink,#24303c);--dm:var(--ink-soft,#8f8781);--dl:var(--line,#ece2d4);--dok:#2e7d5b;--dbad:#b23b34;',
    'display:flex;flex-direction:column;gap:16px;color:var(--di);font-family:inherit}',
    '.dlv-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px}',
    '.dlv-head h2{margin:0;font-size:22px;font-weight:800;color:var(--dn)}',
    '.dlv-head p{margin:2px 0 0;font-size:13px;color:var(--dm)}',
    '.dlv button{font:inherit;font-size:14px;cursor:pointer;border:1px solid var(--dl);background:var(--dc);color:var(--di);border-radius:10px;padding:7px 14px}',
    '.dlv button:hover:not(:disabled){border-color:var(--dr)}',
    '.dlv button:disabled{opacity:.45;cursor:default}',
    '.dlv button.pri{background:var(--dn);border-color:var(--dn);color:#fbf6ee;font-weight:700}',
    '.dlv button.lnk{border:none;background:none;padding:2px 6px;color:var(--dn);text-decoration:underline}',
    '.dlv button.del{color:var(--dbad)}',
    '.dlv button.ar{padding:2px 8px;line-height:1.2}',
    '.dlv-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start}',
    '@media(max-width:1000px){.dlv-grid{grid-template-columns:1fr}}',
    '.dlv-card{background:var(--dc);border:1px solid var(--dl);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}',
    '.dlv-card h3{margin:0;font-size:17px;font-weight:800;color:var(--dn)}',
    '.dlv-hint{font-size:12.5px;color:var(--dm);margin:0;line-height:1.7}',
    '.dlv-row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}',
    '.dlv label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--dm)}',
    '.dlv label.chk{flex-direction:row;align-items:center;gap:8px;color:var(--di);font-size:14px;cursor:pointer}',
    '.dlv input,.dlv textarea{font:inherit;font-size:14px;padding:7px 10px;border:1px solid var(--dl);border-radius:10px;background:#fff;color:var(--di)}',
    '.dlv input[type=time]{direction:ltr;text-align:right;min-width:110px}',
    '.dlv input[type=checkbox]{width:18px;height:18px;accent-color:var(--dn)}',
    '.dlv input.en{direction:ltr;text-align:left}',
    '.dlv textarea{min-height:90px;resize:vertical;width:100%;box-sizing:border-box}',
    '.dlv .ltr{direction:ltr;unicode-bidi:isolate;display:inline-block;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.dlv tr.ed td.act{white-space:normal}.dlv tr.ed td.act button{margin:2px 0}',
    '.dlv tr.ed input[type=time]{min-width:96px}',
    '@media(max-width:600px){.dlv .hide-sm{display:none}.dlv-card{padding:12px}.dlv td,.dlv th{padding:6px 4px}}',
    '.dlv-now{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:14px}',
    '.dlv-pill{display:inline-block;border-radius:999px;padding:2px 12px;font-size:12.5px;font-weight:700;white-space:nowrap}',
    '.dlv-pill.ok{background:#e3f1ea;color:var(--dok)}.dlv-pill.no{background:#fbe6e6;color:var(--dbad)}.dlv-pill.mute{background:#efece6;color:var(--dm)}',
    '.dlv-tw{overflow-x:auto}',
    '.dlv table{width:100%;border-collapse:collapse;font-size:14px}',
    '.dlv th{font-size:12.5px;color:var(--dm);font-weight:600;text-align:start;padding:8px;border-bottom:1px solid var(--dl);white-space:nowrap}',
    '.dlv td{padding:8px;border-bottom:1px solid var(--dl);vertical-align:middle}',
    '.dlv tr.off td{color:var(--dm)}',
    '.dlv tr.ed td{background:#fbf6ee}',
    '.dlv td.act{white-space:nowrap;text-align:end}',
    '.dlv td input{width:100%;box-sizing:border-box;min-width:90px}',
    '.dlv-empty{color:var(--dm);text-align:center;padding:18px}',
    '.dlv-msg{display:none;padding:10px 14px;border-radius:10px;background:var(--drs);color:var(--dn);font-size:14px}',
    '.dlv-msg.on{display:block}.dlv-msg.err{background:#fbe6e6;color:var(--dbad)}',
    '.dlv-ro{font-size:13px;color:var(--dm);background:#efece6;border-radius:10px;padding:8px 12px}',
    '.dlv details summary{cursor:pointer;color:var(--dn);font-size:14px;font-weight:700}',
    '.dlv details[open] summary{margin-bottom:8px}'
  ].join('');

  function injectCss() {
    if (document.getElementById('dlv-css')) return;
    var st = document.createElement('style');
    st.id = 'dlv-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------- skeleton ---------- */
  function skeleton() {
    root.innerHTML =
      '<div class="dlv">' +
      '<div class="dlv-head"><div><h2>إعدادات التوصيل</h2>' +
      '<p>فترات التوصيل وموعد إغلاق طلبات اليوم ومناطق بغداد. تظهر للعملاء عند الطلب، والسيرفر يرفض أي فترة أو منطقة غير فعّالة.</p></div>' +
      '<button data-act="refresh" data-keep="1">↻ تحديث</button></div>' +
      (canEdit ? '' : '<div class="dlv-ro">عرض فقط. التعديل للمدير.</div>') +
      '<div class="dlv-msg" role="status"></div>' +
      '<div class="dlv-card dlv-sameday"></div>' +
      '<div class="dlv-grid">' +
      '<div class="dlv-card dlv-slots"></div>' +
      '<div class="dlv-card dlv-areas"></div>' +
      '</div></div>';
  }

  /* ---------- data ---------- */
  function load() {
    return Promise.all([
      sb.from('delivery_slots').select('*').order('sort_order').order('start_time'),
      sb.from('delivery_areas').select('*').order('sort_order').order('name_ar'),
      sb.from('delivery_settings').select('*').eq('id', 1).maybeSingle(),
      sb.from('delivery_settings_public').select('*').maybeSingle()
    ]).then(function (r) {
      var err = r[0].error || r[1].error || r[2].error;
      if (err) throw err;
      S.slots = r[0].data || [];
      S.areas = r[1].data || [];
      S.settings = r[2].data || null;
      S.pub = r[3].error ? null : (r[3].data || null);
    });
  }

  function refresh() {
    if (!root) return Promise.resolve();
    return load().then(render).catch(function (e) {
      render();
      var m = String((e && e.message) || '');
      if (/delivery_|does not exist|schema cache/i.test(m)) msg('جداول التوصيل غير موجودة. شغّل ملف SQL الخاص بالتوصيل أولاً.', true);
      else msg(errText(e), true);
    });
  }

  /* ---------- render ---------- */
  function render() { renderSameDay(); renderSlots(); renderAreas(); }

  function renderSameDay() {
    var box = $('.dlv-sameday'), s = S.settings, p = S.pub;
    var enabled = s ? !!s.same_day_enabled : true, cutoff = s ? hm(s.same_day_cutoff) : '14:00';
    var now = p ? '<span>الآن في بغداد: <b class="ltr">' + esc(hm(p.now_time)) + '</b></span>' : '';
    var state = !s ? '' : !enabled ? '<span class="dlv-pill no">التوصيل بنفس اليوم متوقف</span>'
      : (p && p.same_day_open === false) ? '<span class="dlv-pill no">طلبات اليوم مغلقة الآن (بعد الموعد)</span>'
      : (p && p.same_day_open) ? '<span class="dlv-pill ok">طلبات اليوم مفتوحة</span>' : '';
    box.innerHTML =
      '<h3>التوصيل بنفس اليوم</h3>' +
      '<div class="dlv-now">' + now + state + '</div>' +
      '<div class="dlv-row">' +
      '<label class="chk"><input type="checkbox" class="sd-on"' + (enabled ? ' checked' : '') + (canEdit ? '' : ' disabled') + '> نقبل طلبات للتوصيل اليوم</label>' +
      '<label>آخر موعد لطلبات اليوم<input type="time" class="sd-cut" step="300" value="' + esc(cutoff) + '"' + (canEdit ? '' : ' disabled') + '></label>' +
      (canEdit ? '<button class="pri" data-act="save-sd">حفظ</button>' : '') +
      '</div>' +
      '<p class="dlv-hint">بعد هذا الموعد (بتوقيت بغداد) لا يقبل السيرفر طلبات لنفس اليوم، ويبقى الطلب لأي يوم بعده متاحاً. ' +
      'ولا تُقبل فترة انتهى وقتها اليوم. يُطبَّق على الطلبات التي ترسل فترة من القائمة (الواجهات الجديدة).</p>';
  }

  function slotRowView(s, i, n) {
    return '<tr class="' + (s.is_active ? '' : 'off') + '">' +
      (canEdit ? '<td class="act" style="text-align:start"><button class="ar" data-act="slot-up" data-id="' + s.id + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="أعلى">▲</button>' +
        '<button class="ar" data-act="slot-down" data-id="' + s.id + '"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="أسفل">▼</button></td>' : '') +
      '<td><b>' + esc(s.name_ar) + '</b>' + (s.name_en ? '<div class="dlv-hint ltr">' + esc(s.name_en) + '</div>' : '') + '</td>' +
      '<td><span class="ltr">' + esc(hm(s.start_time)) + ' - ' + esc(hm(s.end_time)) + '</span><div class="dlv-hint hide-sm">' + esc(ampm(hm(s.start_time))) + ' إلى ' + esc(ampm(hm(s.end_time))) + '</div></td>' +
      '<td>' + (canEdit
        ? '<label class="chk"><input type="checkbox" data-act="slot-active" data-id="' + s.id + '"' + (s.is_active ? ' checked' : '') + '> <span class="hide-sm">' + (s.is_active ? 'فعّالة' : 'متوقفة') + '</span></label>'
        : '<span class="dlv-pill ' + (s.is_active ? 'ok' : 'mute') + '">' + (s.is_active ? 'فعّالة' : 'متوقفة') + '</span>') + '</td>' +
      (canEdit ? '<td class="act"><button class="lnk" data-act="slot-edit" data-id="' + s.id + '">تعديل</button>' +
        '<button class="lnk del" data-act="slot-del" data-id="' + s.id + '">حذف</button></td>' : '') +
      '</tr>';
  }
  function slotRowEdit(s) {
    s = s || { name_ar: '', name_en: '', start_time: '', end_time: '', is_active: true };
    var id = s.id || 'new';
    return '<tr class="ed" data-form="slot" data-id="' + id + '">' +
      '<td></td>' +
      '<td><input class="f-name" placeholder="مثال: صباحاً" value="' + esc(s.name_ar) + '" maxlength="40">' +
      '<input class="f-name-en en" placeholder="English (optional)" value="' + esc(s.name_en || '') + '" maxlength="40" style="margin-top:6px"></td>' +
      '<td><div class="dlv-row" style="gap:6px"><label>من<input type="time" class="f-start" step="300" value="' + esc(hm(s.start_time)) + '"></label>' +
      '<label>إلى<input type="time" class="f-end" step="300" value="' + esc(hm(s.end_time)) + '"></label></div></td>' +
      '<td><label class="chk"><input type="checkbox" class="f-active"' + (s.is_active ? ' checked' : '') + '> فعّالة</label></td>' +
      '<td class="act"><button class="pri" data-act="slot-save">حفظ</button> <button data-act="slot-cancel">إلغاء</button></td>' +
      '</tr>';
  }
  function renderSlots() {
    var box = $('.dlv-slots'), n = S.slots.length;
    var rows = S.slots.map(function (s, i) { return edit.slot === s.id ? slotRowEdit(s) : slotRowView(s, i, n); }).join('');
    if (edit.slot === 'new') rows += slotRowEdit(null);
    box.innerHTML =
      '<div class="dlv-head"><h3>فترات التوصيل</h3>' +
      (canEdit ? '<button class="pri" data-act="slot-add"' + (edit.slot ? ' disabled' : '') + '>+ فترة</button>' : '') + '</div>' +
      '<p class="dlv-hint">تظهر للعميل بهذا الترتيب. الفترة المتوقفة لا تظهر ولا يقبلها السيرفر. يُفضَّل الإيقاف بدل الحذف.</p>' +
      (rows ? '<div class="dlv-tw"><table><thead><tr>' + (canEdit ? '<th>الترتيب</th>' : '') + '<th>الاسم</th><th>الوقت</th><th>الحالة</th>' + (canEdit ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="dlv-empty">لا فترات بعد.' + (canEdit ? ' أضف أول فترة.' : '') + '</div>');
    focusForm('slot');
  }

  function areaRowView(a, i, n) {
    return '<tr class="' + (a.is_active ? '' : 'off') + '">' +
      (canEdit ? '<td class="act" style="text-align:start"><button class="ar" data-act="area-up" data-id="' + a.id + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="أعلى">▲</button>' +
        '<button class="ar" data-act="area-down" data-id="' + a.id + '"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="أسفل">▼</button></td>' : '') +
      '<td><b>' + esc(a.name_ar) + '</b>' + (a.name_en ? '<div class="dlv-hint ltr">' + esc(a.name_en) + '</div>' : '') + '</td>' +
      '<td>' + (canEdit
        ? '<label class="chk"><input type="checkbox" data-act="area-active" data-id="' + a.id + '"' + (a.is_active ? ' checked' : '') + '> <span class="hide-sm">' + (a.is_active ? 'فعّالة' : 'متوقفة') + '</span></label>'
        : '<span class="dlv-pill ' + (a.is_active ? 'ok' : 'mute') + '">' + (a.is_active ? 'فعّالة' : 'متوقفة') + '</span>') + '</td>' +
      (canEdit ? '<td class="act"><button class="lnk" data-act="area-edit" data-id="' + a.id + '">تعديل</button>' +
        '<button class="lnk del" data-act="area-del" data-id="' + a.id + '">حذف</button></td>' : '') +
      '</tr>';
  }
  function areaRowEdit(a) {
    a = a || { name_ar: '', name_en: '', is_active: true };
    return '<tr class="ed" data-form="area" data-id="' + (a.id || 'new') + '">' +
      '<td></td>' +
      '<td><input class="f-name" placeholder="مثال: المنصور" value="' + esc(a.name_ar) + '" maxlength="60">' +
      '<input class="f-name-en en" placeholder="English (optional)" value="' + esc(a.name_en || '') + '" maxlength="60" style="margin-top:6px"></td>' +
      '<td><label class="chk"><input type="checkbox" class="f-active"' + (a.is_active ? ' checked' : '') + '> فعّالة</label></td>' +
      '<td class="act"><button class="pri" data-act="area-save">حفظ</button> <button data-act="area-cancel">إلغاء</button></td>' +
      '</tr>';
  }
  function renderAreas() {
    var box = $('.dlv-areas'), n = S.areas.length;
    var active = S.areas.filter(function (a) { return a.is_active; }).length;
    var rows = S.areas.map(function (a, i) { return edit.area === a.id ? areaRowEdit(a) : areaRowView(a, i, n); }).join('');
    if (edit.area === 'new') rows += areaRowEdit(null);
    box.innerHTML =
      '<div class="dlv-head"><h3>مناطق بغداد <span class="dlv-hint">(' + '<span class="ltr">' + active + '</span> فعّالة من <span class="ltr">' + n + '</span>)</span></h3>' +
      (canEdit ? '<button class="pri" data-act="area-add"' + (edit.area ? ' disabled' : '') + '>+ منطقة</button>' : '') + '</div>' +
      '<p class="dlv-hint">قائمة المناطق التي يختار منها العميل. المنطقة المتوقفة لا تظهر ولا يقبلها السيرفر. الطلبات القديمة تحتفظ باسم المنطقة حتى لو حُذفت.</p>' +
      (canEdit ? '<details><summary>إضافة عدة مناطق دفعة واحدة</summary>' +
        '<textarea class="bulk" placeholder="منطقة في كل سطر، مثلاً:&#10;المنصور&#10;الكرادة&#10;زيونة"></textarea>' +
        '<div class="dlv-row" style="margin-top:8px"><button class="pri" data-act="area-bulk">إضافة القائمة</button>' +
        '<span class="dlv-hint">الأسماء المكررة أو الموجودة تُتجاهل.</span></div></details>' : '') +
      (rows ? '<div class="dlv-tw"><table><thead><tr>' + (canEdit ? '<th>الترتيب</th>' : '') + '<th>المنطقة</th><th>الحالة</th>' + (canEdit ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="dlv-empty">لا مناطق بعد.' + (canEdit ? ' أضفها واحدة واحدة أو دفعة واحدة.' : '') + '</div>');
    focusForm('area');
  }
  function focusForm(kind) {
    var f = root.querySelector('tr[data-form="' + kind + '"] .f-name');
    if (f && !f.value) f.focus();
  }

  /* ---------- actions ---------- */
  function run(promiseFn, okText) {
    if (busy) return Promise.resolve();
    setBusy(true); msg('');
    return Promise.resolve().then(promiseFn).then(function (res) {
      if (res && res.error) throw res.error;
      return load();
    }).then(function () {
      setBusy(false); render(); if (okText) msg(okText);
    }).catch(function (e) {
      setBusy(false); msg(errText(e), true);
    });
  }
  function nextSort(list) {
    var m = 0; list.forEach(function (r) { if (r.sort_order > m) m = r.sort_order; });
    return m + 10;
  }
  // Move one row up/down, then renumber the whole list 10, 20, 30... (only rows whose number changes are written).
  function move(table, list, id, dir) {
    var i = list.findIndex(function (r) { return r.id === id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    var arr = list.slice(); var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    var ups = [];
    arr.forEach(function (r, k) {
      var want = (k + 1) * 10;
      if (r.sort_order !== want) ups.push(sb.from(table).update({ sort_order: want }).eq('id', r.id));
    });
    run(function () {
      return Promise.all(ups).then(function (rs) {
        for (var x = 0; x < rs.length; x++) if (rs[x].error) return rs[x];
      });
    });
  }
  function formVals(kind) {
    var tr = root.querySelector('tr[data-form="' + kind + '"]');
    var v = {
      id: tr.dataset.id,
      name_ar: tr.querySelector('.f-name').value.trim(),
      name_en: tr.querySelector('.f-name-en').value.trim() || null,
      is_active: tr.querySelector('.f-active').checked
    };
    if (kind === 'slot') { v.start = tr.querySelector('.f-start').value; v.end = tr.querySelector('.f-end').value; }
    return v;
  }
  function saveSlot() {
    var v = formVals('slot');
    if (!v.name_ar) return msg('اكتب اسم الفترة.', true);
    if (!v.start || !v.end) return msg('حدّد وقت البداية والنهاية.', true);
    if (v.end <= v.start) return msg('وقت النهاية يجب أن يكون بعد وقت البداية (الفترة لا تتجاوز منتصف الليل).', true);
    var row = { name_ar: v.name_ar, name_en: v.name_en, start_time: v.start, end_time: v.end, is_active: v.is_active };
    run(function () {
      if (v.id === 'new') { row.sort_order = nextSort(S.slots); return sb.from('delivery_slots').insert(row); }
      return sb.from('delivery_slots').update(row).eq('id', v.id);
    }, v.id === 'new' ? 'أُضيفت الفترة.' : 'حُفظت الفترة.').then(function () {
      if (!root.querySelector('.dlv-msg.err')) { edit.slot = null; renderSlots(); }
    });
  }
  function saveArea() {
    var v = formVals('area');
    if (!v.name_ar) return msg('اكتب اسم المنطقة.', true);
    var row = { name_ar: v.name_ar, name_en: v.name_en, is_active: v.is_active };
    run(function () {
      if (v.id === 'new') { row.sort_order = nextSort(S.areas); return sb.from('delivery_areas').insert(row); }
      return sb.from('delivery_areas').update(row).eq('id', v.id);
    }, v.id === 'new' ? 'أُضيفت المنطقة.' : 'حُفظت المنطقة.').then(function () {
      if (!root.querySelector('.dlv-msg.err')) { edit.area = null; renderAreas(); }
    });
  }
  function bulkAreas() {
    var ta = $('.bulk'); if (!ta) return;
    var have = {}; S.areas.forEach(function (a) { have[a.name_ar.trim().toLowerCase()] = 1; });
    var names = [], seen = {};
    ta.value.split(/\r?\n|،|,/).forEach(function (x) {
      var t = x.replace(/\s+/g, ' ').trim(), k = t.toLowerCase();
      if (t && !have[k] && !seen[k]) { seen[k] = 1; names.push(t.slice(0, 60)); }
    });
    if (!names.length) return msg('لا أسماء جديدة في القائمة.', true);
    var base = nextSort(S.areas);
    var rows = names.map(function (n, i) { return { name_ar: n, sort_order: base + i * 10, is_active: true }; });
    run(function () { return sb.from('delivery_areas').insert(rows); },
      'أُضيفت ' + names.length + ' منطقة.').then(function () {
      if (!root.querySelector('.dlv-msg.err')) { var t = $('.bulk'); if (t) t.value = ''; }
    });
  }
  function saveSameDay() {
    var on = $('.sd-on').checked, cut = $('.sd-cut').value;
    if (!cut) return msg('حدّد آخر موعد.', true);
    run(function () {
      return sb.from('delivery_settings').update({ same_day_enabled: on, same_day_cutoff: cut }).eq('id', 1);
    }, 'حُفظ إعداد التوصيل بنفس اليوم.');
  }
  function toggleActive(table, list, id, on) {
    run(function () { return sb.from(table).update({ is_active: on }).eq('id', id); },
      on ? 'تم التفعيل.' : 'تم الإيقاف. لن تظهر للعملاء.');
  }
  function del(table, list, id, kind) {
    var r = list.find(function (x) { return x.id === id; }); if (!r) return;
    var txt = kind === 'slot'
      ? 'حذف الفترة "' + r.name_ar + '"؟\nالطلبات السابقة تحتفظ بنص الفترة. إن كنت تريد إخفاءها مؤقتاً فالأفضل إيقافها.'
      : 'حذف المنطقة "' + r.name_ar + '"؟\nالطلبات السابقة تحتفظ باسم المنطقة. إن كنت تريد إخفاءها مؤقتاً فالأفضل إيقافها.';
    if (!window.confirm(txt)) return;
    run(function () { return sb.from(table).delete().eq('id', id); }, 'تم الحذف.');
  }

  function onClick(e) {
    var b = e.target.closest('[data-act]'); if (!b || !root.contains(b)) return;
    if (b.tagName === 'INPUT') return; // checkboxes handled on change
    var act = b.dataset.act, id = b.dataset.id;
    if (act === 'refresh') { msg(''); refresh(); return; }
    if (!canEdit || busy) return;
    switch (act) {
      case 'save-sd': saveSameDay(); break;
      case 'slot-add': edit.slot = 'new'; renderSlots(); break;
      case 'slot-edit': edit.slot = id; renderSlots(); break;
      case 'slot-cancel': edit.slot = null; msg(''); renderSlots(); break;
      case 'slot-save': saveSlot(); break;
      case 'slot-del': del('delivery_slots', S.slots, id, 'slot'); break;
      case 'slot-up': move('delivery_slots', S.slots, id, -1); break;
      case 'slot-down': move('delivery_slots', S.slots, id, 1); break;
      case 'area-add': edit.area = 'new'; renderAreas(); break;
      case 'area-edit': edit.area = id; renderAreas(); break;
      case 'area-cancel': edit.area = null; msg(''); renderAreas(); break;
      case 'area-save': saveArea(); break;
      case 'area-del': del('delivery_areas', S.areas, id, 'area'); break;
      case 'area-up': move('delivery_areas', S.areas, id, -1); break;
      case 'area-down': move('delivery_areas', S.areas, id, 1); break;
      case 'area-bulk': bulkAreas(); break;
    }
  }
  function onChange(e) {
    var t = e.target; if (!t.dataset || !t.dataset.act || !canEdit) return;
    if (t.dataset.act === 'slot-active') toggleActive('delivery_slots', S.slots, t.dataset.id, t.checked);
    if (t.dataset.act === 'area-active') toggleActive('delivery_areas', S.areas, t.dataset.id, t.checked);
  }
  function onKey(e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    var tr = e.target.closest('tr[data-form]'); if (!tr) return;
    e.preventDefault();
    if (tr.dataset.form === 'slot') saveSlot(); else saveArea();
  }

  window.QadahDelivery = {
    mount: function (el, client, opts) {
      if (!el || !client) return;
      sb = client; canEdit = !!(opts && opts.canEdit);
      if (root !== el) {
        root = el; injectCss(); skeleton();
        root.addEventListener('click', onClick);
        root.addEventListener('change', onChange);
        root.addEventListener('keydown', onKey);
      }
      edit = { slot: null, area: null };
      return refresh();
    },
    refresh: refresh
  };
})();
