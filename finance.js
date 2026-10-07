/* =====================================================================
   Qadah dashboard: Finance tab (المالية). Admin only.
   Reads/writes: expenses, funding_received, finance_monthly (view),
   suppliers (names for supplier payments), storage bucket 'receipts'.
   Requires qadah-finance.sql to be run first.

   Usage (inside index.html):
     <script src="finance.js"></script>
     QadahFinance.mount(document.getElementById('finance-root'), <your supabase client>);
     QadahFinance.refresh();   // call again whenever the tab is opened
   ===================================================================== */
(function () {
  'use strict';

  var CATS = {
    packaging: 'التغليف', salaries: 'الرواتب', photography: 'التصوير',
    legal: 'القانونية والتسجيل', tech: 'التقنية', marketing: 'التسويق',
    supplier_payment: 'دفعات الموردين', delivery: 'التوصيل', other: 'أخرى'
  };
  var METHODS = { cash: 'نقد', qi_card: 'Qi Card', bank_transfer: 'تحويل مصرفي', other: 'أخرى' };
  var MONTHS_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];

  var sb = null, root = null, mounted = false, busy = false;
  var S = { expenses: [], funding: [], monthly: [], suppliers: [], q: '', cat: '', month: '' };
  var modal = { kind: null, row: null };

  /* ---------- helpers ---------- */
  function fmt(n) { return Number(n || 0).toLocaleString('en-US') + ' د.ع'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function today() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function monthKey(dateStr) { return String(dateStr || '').slice(0, 7); }
  function monthLabel(key) {
    var p = String(key).split('-');
    return p.length < 2 ? key : MONTHS_AR[Number(p[1]) - 1] + ' ' + p[0];
  }
  function $(sel) { return root.querySelector(sel); }
  function msg(text, isError) {
    var el = $('.fin-msg');
    el.textContent = text || '';
    el.className = 'fin-msg' + (isError ? ' err' : '') + (text ? ' on' : '');
    if (text && !isError) setTimeout(function () { if (el.textContent === text) msg(''); }, 3000);
  }
  function supplierName(id) {
    for (var i = 0; i < S.suppliers.length; i++) if (S.suppliers[i].id === id) return S.suppliers[i].name;
    return '';
  }
  function uuid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /* ---------- styles (brand tokens with fallbacks) ---------- */
  var CSS = [
    '.fin{--fn:var(--navy,#01183a);--fr:var(--rose-strong,#c98578);--frs:var(--rose-soft,#f4e4df);--fc:var(--surface,#fffdfa);',
    '--fi:var(--ink,#24303c);--fm:var(--ink-soft,#8f8781);--fl:var(--line,#ece2d4);--fok:#2e7d5b;--fbad:#b23b34;',
    'display:flex;flex-direction:column;gap:16px;color:var(--fi);font-family:inherit}',
    '.fin-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px}',
    '.fin-head h2{margin:0;font-size:22px;font-weight:800;color:var(--fn)}',
    '.fin-actions{display:flex;flex-wrap:wrap;gap:8px}',
    '.fin button{font:inherit;cursor:pointer;border:1px solid var(--fl);background:var(--fc);color:var(--fi);border-radius:10px;padding:7px 14px}',
    '.fin button:hover{border-color:var(--fr)}',
    '.fin button.pri{background:var(--fn);border-color:var(--fn);color:#fbf6ee;font-weight:700}',
    '.fin button.lnk{border:none;background:none;padding:2px 6px;color:var(--fn);text-decoration:underline}',
    '.fin button.del{color:var(--fbad)}',
    '.fin-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}',
    '@media(max-width:900px){.fin-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '@media(max-width:480px){.fin-kpis{grid-template-columns:1fr}}',
    '.fin-kpi{background:var(--fc);border:1px solid var(--fl);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:4px}',
    '.fin-kpi .l{font-size:13px;color:var(--fm)}',
    '.fin-kpi .v{font-size:22px;font-weight:800;direction:ltr;text-align:right;font-variant-numeric:tabular-nums}',
    '.fin-kpi .s{font-size:12px;color:var(--fm)}',
    '.fin-kpi.hero{background:var(--fn);border-color:var(--fn);color:#fbf6ee}.fin-kpi.hero .l,.fin-kpi.hero .s{color:#fbf6ee;opacity:.8}',
    '.fin .pos{color:var(--fok)}.fin .neg{color:var(--fbad)}.fin .warn{color:#8a5a00}.fin-kpi.hero .neg{color:#ffb4ac}',
    '.fin-grid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:12px}',
    '@media(max-width:900px){.fin-grid{grid-template-columns:1fr}}',
    '.fin-card{background:var(--fc);border:1px solid var(--fl);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}',
    '.fin-card h3{margin:0;font-size:16px;font-weight:700;color:var(--fn)}',
    '.fin-cat{display:flex;flex-direction:column;gap:4px}',
    '.fin-cat .t{display:flex;justify-content:space-between;font-size:14px}',
    '.fin-cat .t span:last-child{color:var(--fm);direction:ltr}',
    '.fin-track{height:10px;border-radius:5px;background:var(--frs);overflow:hidden}',
    '.fin-track i{display:block;height:100%;background:var(--fr);border-radius:5px;min-width:2px}',
    '.fin-tw{overflow-x:auto}',
    '.fin table{width:100%;border-collapse:collapse;font-size:14px}',
    '.fin th{font-size:12.5px;color:var(--fm);font-weight:600;text-align:start;padding:8px;border-bottom:1px solid var(--fl);white-space:nowrap}',
    '.fin td{padding:8px;border-bottom:1px solid var(--fl);vertical-align:middle}',
    '.fin td.n,.fin th.n{text-align:left;direction:ltr;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.fin td .d{display:block;font-size:12px;color:var(--fm)}',
    '.fin tr.sum td{font-weight:800;border-bottom:none}',
    '.fin-chip{display:inline-block;border-radius:999px;padding:1px 10px;font-size:12px;background:var(--frs);color:var(--fn);white-space:nowrap}',
    '.fin-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.fin input,.fin select,.fin textarea{font:inherit;font-size:14px;padding:7px 10px;border:1px solid var(--fl);border-radius:10px;background:#fff;color:var(--fi)}',
    '.fin input[type=number],.fin input[type=date]{direction:ltr;text-align:right}',
    '.fin-filters input{flex:1;min-width:160px}',
    '.fin-empty{color:var(--fm);text-align:center;padding:18px}',
    '.fin-msg{display:none;padding:10px 14px;border-radius:10px;background:var(--frs);color:var(--fn);font-size:14px}',
    '.fin-msg.on{display:block}.fin-msg.err{background:#fbe6e6;color:var(--fbad)}',
    '.fin-ov{position:fixed;inset:0;background:rgba(1,24,58,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px}',
    '.fin-ov[hidden]{display:none}',
    '.fin-dlg{background:var(--fc);border-radius:18px;width:min(560px,100%);max-height:92vh;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:12px}',
    '.fin-dlg h3{margin:0;color:var(--fn);font-size:18px}',
    '.fin-f{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media(max-width:480px){.fin-f{grid-template-columns:1fr}}',
    '.fin-f label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--fm)}',
    '.fin-f label.w{grid-column:1/-1}',
    '.fin-f [hidden]{display:none}',
    '.fin-dlg .ft{display:flex;justify-content:flex-start;gap:8px;margin-top:4px}',
    '.fin-hint{font-size:12.5px;color:var(--fm);margin:0}'
  ].join('');

  function injectCss() {
    if (document.getElementById('fin-css')) return;
    var st = document.createElement('style');
    st.id = 'fin-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------- skeleton ---------- */
  function skeleton() {
    var catOpts = Object.keys(CATS).map(function (k) { return '<option value="' + k + '">' + CATS[k] + '</option>'; }).join('');
    root.innerHTML =
      '<div class="fin">' +
      '<div class="fin-head"><h2>المالية</h2><div class="fin-actions">' +
      '<button class="pri" data-act="add-exp">+ مصروف</button>' +
      '<button data-act="add-fund">+ تمويل وارد</button>' +
      '<button data-act="csv-exp">تصدير المصاريف CSV</button>' +
      '<button data-act="csv-fund">تصدير التمويل CSV</button>' +
      '<button data-act="refresh">تحديث</button></div></div>' +
      '<div class="fin-msg"></div>' +
      '<div class="fin-kpis"></div>' +
      '<div class="fin-grid">' +
      '<div class="fin-card"><h3>المصاريف حسب الفئة</h3><div class="fin-cats"></div></div>' +
      '<div class="fin-card"><h3>شهرياً</h3><p class="fin-hint">إيراد قدّاح = سعر البيع ناقص سعر التوريد + رسوم التوصيل. "المحقق" من الطلبات المدفوعة فقط. دفعات الموردين لا تُطرح مرة ثانية لأنها داخل كلفة الورد.</p><div class="fin-tw fin-monthly"></div></div>' +
      '</div>' +
      '<div class="fin-card"><h3>سجل المصاريف</h3>' +
      '<div class="fin-filters"><input type="search" class="fin-q" placeholder="بحث في البند أو الدافع أو الملاحظة">' +
      '<select class="fin-cat-f"><option value="">كل الفئات</option>' + catOpts + '</select>' +
      '<select class="fin-month-f"><option value="">كل الأشهر</option></select></div>' +
      '<div class="fin-tw fin-exp"></div></div>' +
      '<div class="fin-card"><h3>التمويل الوارد</h3><div class="fin-tw fin-fund"></div></div>' +
      '<div class="fin-ov" hidden><div class="fin-dlg" role="dialog" aria-modal="true"></div></div>' +
      '</div>';

    root.addEventListener('click', onClick);
    $('.fin-q').addEventListener('input', function (e) { S.q = e.target.value.trim(); renderExpenses(); });
    $('.fin-cat-f').addEventListener('change', function (e) { S.cat = e.target.value; renderExpenses(); });
    $('.fin-month-f').addEventListener('change', function (e) { S.month = e.target.value; renderExpenses(); });
    $('.fin-ov').addEventListener('click', function (e) { if (e.target.classList.contains('fin-ov')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('.fin-ov').hidden) closeModal(); });
  }

  /* ---------- data ---------- */
  async function load() {
    if (!sb) return;
    msg('جاري التحميل...');
    var res = await Promise.all([
      sb.from('expenses').select('*').order('spent_on', { ascending: false }).order('id', { ascending: false }),
      sb.from('funding_received').select('*').order('received_on', { ascending: false }),
      sb.from('finance_monthly').select('*'),
      sb.from('suppliers').select('id,name').order('name')
    ]);
    var err = res[0].error || res[1].error || res[2].error;
    if (err) { msg('تعذّر تحميل البيانات: ' + err.message, true); return; }
    S.expenses = res[0].data || [];
    S.funding = res[1].data || [];
    S.monthly = res[2].data || [];
    S.suppliers = (res[3].data || []);
    msg('');
    renderAll();
  }

  /* ---------- render ---------- */
  function renderAll() { renderKpis(); renderCats(); renderMonthly(); renderMonthFilter(); renderExpenses(); renderFunding(); }

  function sum(arr, f) { return arr.reduce(function (a, r) { return a + Number(r[f] || 0); }, 0); }

  function renderKpis() {
    var funding = sum(S.funding, 'amount_iqd');
    var allSpent = sum(S.expenses, 'amount_iqd');
    var cashIn = sum(S.monthly, 'paid_cash_in');
    var cash = funding + cashIn - allSpent;
    var revenue = sum(S.monthly, 'revenue');
    var paidRevenue = sum(S.monthly, 'paid_revenue');
    var opex = sum(S.monthly, 'operating_expenses');
    var supPaid = sum(S.monthly, 'supplier_payments');
    var net = sum(S.monthly, 'net_profit');
    var sales = sum(S.monthly, 'sales_total');
    var orders = sum(S.monthly, 'orders_count');
    var missing = sum(S.monthly, 'missing_cost_lines');
    $('.fin-kpis').innerHTML =
      kpi('صافي الربح المحقق', fmt(net), 'الإيراد المحقق ' + fmt(paidRevenue) + ' ناقص المصاريف التشغيلية', 'hero', net < 0 ? 'neg' : '') +
      kpi('إيراد قدّاح من الطلبات', fmt(revenue), orders + ' طلب بمبيعات ' + fmt(sales) + (missing ? ' · ' + missing + ' صنف بلا تكلفة' : ''), '', '', missing ? 'warn' : '') +
      kpi('المصاريف التشغيلية', fmt(opex), supPaid ? 'ودفعات موردين ' + fmt(supPaid) + ' (خارج الحساب)' : 'بدون دفعات الموردين') +
      kpi('الرصيد النقدي', fmt(cash), funding ? 'التمويل ' + fmt(funding) + ' + المحصّل − كل المدفوعات' : 'لم يُسجَّل تمويل بعد', '', cash < 0 ? 'neg' : '');
  }
  function kpi(l, v, s, cls, vcls, scls) {
    return '<div class="fin-kpi ' + (cls || '') + '"><span class="l">' + esc(l) + '</span><span class="v ' + (vcls || '') + '">' + esc(v) + '</span><span class="s ' + (scls || '') + '">' + esc(s) + '</span></div>';
  }

  function renderCats() {
    var by = {};
    S.expenses.forEach(function (r) { by[r.category] = (by[r.category] || 0) + Number(r.amount_iqd); });
    var keys = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
    if (!keys.length) { $('.fin-cats').innerHTML = '<div class="fin-empty">لا توجد مصاريف بعد</div>'; return; }
    var max = by[keys[0]];
    $('.fin-cats').innerHTML = keys.map(function (k) {
      return '<div class="fin-cat"><div class="t"><span>' + esc(CATS[k] || k) + '</span><span>' + fmt(by[k]) + '</span></div>' +
        '<div class="fin-track"><i style="width:' + Math.max(2, Math.round(by[k] / max * 100)) + '%"></i></div></div>';
    }).join('');
  }

  function renderMonthly() {
    var rows = S.monthly.slice().sort(function (a, b) { return a.month < b.month ? 1 : -1; });
    if (!rows.length) { $('.fin-monthly').innerHTML = '<div class="fin-empty">لا توجد بيانات بعد</div>'; return; }
    var h = '<table><thead><tr><th>الشهر</th><th class="n">الطلبات</th><th class="n">المبيعات</th><th class="n">كلفة الورد</th><th class="n">إيراد قدّاح</th><th class="n">المحقق</th><th class="n">المصاريف التشغيلية</th><th class="n">صافي الربح</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var net = Number(r.net_profit);
      var miss = Number(r.missing_cost_lines) ? '<span class="d warn">' + r.missing_cost_lines + ' صنف بلا تكلفة</span>' : '';
      h += '<tr><td>' + esc(monthLabel(monthKey(r.month))) + '</td><td class="n">' + r.orders_count + '</td><td class="n">' + fmt(r.sales_total) +
        '</td><td class="n">' + fmt(r.goods_cost) + '</td><td class="n">' + fmt(r.revenue) + miss + '</td><td class="n">' + fmt(r.paid_revenue) +
        '</td><td class="n">' + fmt(r.operating_expenses) + '</td><td class="n ' + (net < 0 ? 'neg' : 'pos') + '">' + fmt(net) + '</td></tr>';
    });
    $('.fin-monthly').innerHTML = h + '</tbody></table>';
  }

  function renderMonthFilter() {
    var seen = {};
    S.expenses.forEach(function (r) { seen[monthKey(r.spent_on)] = 1; });
    var keys = Object.keys(seen).sort().reverse();
    if (S.month && !seen[S.month]) S.month = '';
    $('.fin-month-f').innerHTML = '<option value="">كل الأشهر</option>' + keys.map(function (k) {
      return '<option value="' + k + '"' + (k === S.month ? ' selected' : '') + '>' + esc(monthLabel(k)) + '</option>';
    }).join('');
  }

  function filtered() {
    var q = S.q.toLowerCase();
    return S.expenses.filter(function (r) {
      if (S.cat && r.category !== S.cat) return false;
      if (S.month && monthKey(r.spent_on) !== S.month) return false;
      if (q) {
        var hay = [r.item, r.paid_by, r.note, supplierName(r.supplier_id)].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderExpenses() {
    var rows = filtered();
    if (!rows.length) { $('.fin-exp').innerHTML = '<div class="fin-empty">' + (S.expenses.length ? 'لا توجد نتائج' : 'لا توجد مصاريف بعد') + '</div>'; return; }
    var h = '<table><thead><tr><th>التاريخ</th><th>الفئة</th><th>البند</th><th class="n">المبلغ</th><th>من دفع</th><th>طريقة الدفع</th><th>الإيصال</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var orig = r.original_currency && r.original_currency !== 'IQD'
        ? '<span class="d">' + Number(r.original_amount).toLocaleString('en-US') + ' ' + esc(r.original_currency) + ' × ' + Number(r.fx_rate).toLocaleString('en-US') + '</span>' : '';
      var sup = r.supplier_id ? '<span class="d">' + esc(supplierName(r.supplier_id)) + '</span>' : '';
      var note = r.note ? '<span class="d">' + esc(r.note) + '</span>' : '';
      h += '<tr><td class="n">' + esc(r.spent_on) + '</td><td><span class="fin-chip">' + esc(CATS[r.category] || r.category) + '</span></td>' +
        '<td>' + esc(r.item) + sup + note + '</td><td class="n">' + fmt(r.amount_iqd) + orig + '</td>' +
        '<td>' + esc(r.paid_by) + '</td><td>' + esc(METHODS[r.payment_method] || r.payment_method) + '</td>' +
        '<td>' + (r.receipt_path ? '<button class="lnk" data-act="receipt" data-path="' + esc(r.receipt_path) + '">عرض</button>' : '<span class="d">لا يوجد</span>') + '</td>' +
        '<td style="white-space:nowrap"><button class="lnk" data-act="edit-exp" data-id="' + r.id + '">تعديل</button><button class="lnk del" data-act="del-exp" data-id="' + r.id + '">حذف</button></td></tr>';
    });
    h += '<tr class="sum"><td colspan="3">المجموع (' + rows.length + ')</td><td class="n">' + fmt(sum(rows, 'amount_iqd')) + '</td><td colspan="4"></td></tr>';
    $('.fin-exp').innerHTML = h + '</tbody></table>';
  }

  function renderFunding() {
    if (!S.funding.length) { $('.fin-fund').innerHTML = '<div class="fin-empty">لم يُسجَّل أي تمويل بعد. اضغط "+ تمويل وارد" عند وصول المبلغ.</div>'; return; }
    var h = '<table><thead><tr><th>التاريخ</th><th>من</th><th>استلمه</th><th class="n">المبلغ</th><th>ملاحظة</th><th></th></tr></thead><tbody>';
    S.funding.forEach(function (r) {
      h += '<tr><td class="n">' + esc(r.received_on) + '</td><td>' + esc(r.from_party) + '</td><td>' + esc(r.received_by || '') + '</td>' +
        '<td class="n">' + fmt(r.amount_iqd) + '</td><td>' + esc(r.note || '') + '</td>' +
        '<td style="white-space:nowrap"><button class="lnk" data-act="edit-fund" data-id="' + r.id + '">تعديل</button><button class="lnk del" data-act="del-fund" data-id="' + r.id + '">حذف</button></td></tr>';
    });
    h += '<tr class="sum"><td colspan="3">المجموع</td><td class="n">' + fmt(sum(S.funding, 'amount_iqd')) + '</td><td colspan="2"></td></tr>';
    $('.fin-fund').innerHTML = h + '</tbody></table>';
  }

  /* ---------- clicks ---------- */
  function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b || !root.contains(b) || busy) return;
    var act = b.getAttribute('data-act'), id = Number(b.getAttribute('data-id'));
    if (act === 'refresh') load();
    else if (act === 'add-exp') openExpense(null);
    else if (act === 'edit-exp') openExpense(find(S.expenses, id));
    else if (act === 'del-exp') deleteExpense(find(S.expenses, id));
    else if (act === 'add-fund') openFunding(null);
    else if (act === 'edit-fund') openFunding(find(S.funding, id));
    else if (act === 'del-fund') deleteFunding(find(S.funding, id));
    else if (act === 'receipt') openReceipt(b.getAttribute('data-path'));
    else if (act === 'csv-exp') csvExpenses();
    else if (act === 'csv-fund') csvFunding();
    else if (act === 'close') closeModal();
    else if (act === 'save') save();
  }
  function find(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }

  /* ---------- modal ---------- */
  function openModal(html) { $('.fin-dlg').innerHTML = html; $('.fin-ov').hidden = false; var f = $('.fin-dlg input,.fin-dlg select'); if (f) f.focus(); }
  function closeModal() { $('.fin-ov').hidden = true; $('.fin-dlg').innerHTML = ''; modal = { kind: null, row: null }; }

  function openExpense(row) {
    modal = { kind: 'exp', row: row };
    var r = row || { spent_on: today(), category: 'other', payment_method: 'cash', original_currency: 'IQD' };
    var cur = r.original_currency || 'IQD';
    var payers = {}; S.expenses.forEach(function (x) { if (x.paid_by) payers[x.paid_by] = 1; });
    var opt = function (map, sel) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); };
    var supOpts = '<option value="">بدون</option>' + S.suppliers.map(function (s) { return '<option value="' + s.id + '"' + (s.id === r.supplier_id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('');
    openModal(
      '<h3>' + (row ? 'تعديل مصروف' : 'مصروف جديد') + '</h3>' +
      '<div class="fin-f">' +
      '<label>التاريخ<input type="date" name="spent_on" value="' + esc(r.spent_on) + '" required></label>' +
      '<label>الفئة<select name="category">' + opt(CATS, r.category) + '</select></label>' +
      '<label class="w">البند<input name="item" value="' + esc(r.item) + '" placeholder="مثلاً: شرائط ساتان" required></label>' +
      '<label>العملة<select name="original_currency"><option value="IQD"' + (cur === 'IQD' ? ' selected' : '') + '>دينار عراقي</option><option value="USD"' + (cur === 'USD' ? ' selected' : '') + '>دولار</option></select></label>' +
      '<label data-iqd>المبلغ (د.ع)<input type="number" name="amount_iqd" min="1" step="1" value="' + esc(r.amount_iqd) + '"></label>' +
      '<label data-usd>المبلغ بالدولار<input type="number" name="original_amount" min="0" step="0.01" value="' + esc(r.original_amount) + '"></label>' +
      '<label data-usd>سعر الصرف (د.ع للدولار)<input type="number" name="fx_rate" min="0" step="1" value="' + esc(r.fx_rate) + '"></label>' +
      '<label data-usd class="w">المبلغ المحسوب بالدينار<input name="calc" readonly></label>' +
      '<label>من دفع<input name="paid_by" list="fin-payers" value="' + esc(r.paid_by) + '" required><datalist id="fin-payers">' +
      Object.keys(payers).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist></label>' +
      '<label>طريقة الدفع<select name="payment_method">' + opt(METHODS, r.payment_method) + '</select></label>' +
      '<label class="w" data-sup>المورّد<select name="supplier_id">' + supOpts + '</select></label>' +
      '<label class="w">الإيصال (صورة أو PDF)<input type="file" name="receipt" accept="image/*,application/pdf">' +
      (r.receipt_path ? '<span class="fin-hint">يوجد إيصال محفوظ. <button type="button" class="lnk" data-act="receipt" data-path="' + esc(r.receipt_path) + '">عرض</button> <label style="display:inline-flex;flex-direction:row;gap:4px;align-items:center"><input type="checkbox" name="remove_receipt"> حذف الإيصال</label></span>' : '') +
      '</label>' +
      '<label class="w">ملاحظة<textarea name="note" rows="2">' + esc(r.note) + '</textarea></label>' +
      '</div>' +
      '<div class="ft"><button class="pri" data-act="save">حفظ</button><button data-act="close">إلغاء</button></div>'
    );
    var dlg = $('.fin-dlg');
    var sync = function () {
      var usd = dlg.querySelector('[name=original_currency]').value === 'USD';
      dlg.querySelectorAll('[data-usd]').forEach(function (el) { el.hidden = !usd; });
      dlg.querySelector('[data-iqd]').hidden = usd;
      dlg.querySelector('[data-sup]').hidden = dlg.querySelector('[name=category]').value !== 'supplier_payment' && !dlg.querySelector('[name=supplier_id]').value;
      var a = Number(dlg.querySelector('[name=original_amount]').value), fx = Number(dlg.querySelector('[name=fx_rate]').value);
      dlg.querySelector('[name=calc]').value = a && fx ? fmt(Math.round(a * fx)) : '';
    };
    dlg.addEventListener('input', sync); dlg.addEventListener('change', sync); sync();
  }

  function openFunding(row) {
    modal = { kind: 'fund', row: row };
    var r = row || { received_on: today(), from_party: 'الإدارة' };
    openModal(
      '<h3>' + (row ? 'تعديل تمويل' : 'تمويل وارد') + '</h3>' +
      '<div class="fin-f">' +
      '<label>التاريخ<input type="date" name="received_on" value="' + esc(r.received_on) + '" required></label>' +
      '<label>المبلغ (د.ع)<input type="number" name="amount_iqd" min="1" step="1" value="' + esc(r.amount_iqd) + '" required></label>' +
      '<label>من<input name="from_party" value="' + esc(r.from_party) + '" required></label>' +
      '<label>استلمه<input name="received_by" value="' + esc(r.received_by) + '"></label>' +
      '<label class="w">ملاحظة<textarea name="note" rows="2">' + esc(r.note) + '</textarea></label>' +
      '</div>' +
      '<div class="ft"><button class="pri" data-act="save">حفظ</button><button data-act="close">إلغاء</button></div>'
    );
  }

  function val(name) { var el = $('.fin-dlg [name=' + name + ']'); return el ? el.value.trim() : ''; }

  async function save() {
    if (modal.kind === 'exp') return saveExpense();
    if (modal.kind === 'fund') return saveFunding();
  }

  async function saveExpense() {
    var row = modal.row;
    var cur = val('original_currency');
    var p = {
      spent_on: val('spent_on'), category: val('category'), item: val('item'),
      paid_by: val('paid_by'), payment_method: val('payment_method'),
      supplier_id: val('supplier_id') || null, note: val('note') || null
    };
    if (cur === 'USD') {
      var a = Number(val('original_amount')), fx = Number(val('fx_rate'));
      if (!(a > 0) || !(fx > 0)) return msg('أدخل المبلغ بالدولار وسعر الصرف.', true);
      p.original_amount = a; p.original_currency = 'USD'; p.fx_rate = fx; p.amount_iqd = Math.round(a * fx);
    } else {
      p.amount_iqd = Math.round(Number(val('amount_iqd')));
      p.original_amount = null; p.original_currency = null; p.fx_rate = null;
    }
    if (!p.spent_on || !p.item || !p.paid_by) return msg('التاريخ والبند ومن دفع حقول مطلوبة.', true);
    if (!(p.amount_iqd > 0)) return msg('المبلغ يجب أن يكون أكبر من صفر.', true);

    var fileEl = $('.fin-dlg [name=receipt]');
    var file = fileEl && fileEl.files[0];
    var removeOld = !!($('.fin-dlg [name=remove_receipt]') || {}).checked;
    var oldPath = row && row.receipt_path;
    var newPath = null;

    busy = true; msg('جاري الحفظ...');
    try {
      if (file) {
        if (file.size > 10 * 1024 * 1024) throw new Error('حجم الإيصال أكبر من 10MB');
        var ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
        newPath = p.spent_on.slice(0, 4) + '/' + p.spent_on.slice(5, 7) + '/' + uuid() + '.' + ext;
        var up = await sb.storage.from('receipts').upload(newPath, file, { contentType: file.type || undefined, upsert: false });
        if (up.error) throw up.error;
        p.receipt_path = newPath;
      } else if (removeOld) {
        p.receipt_path = null;
      }

      var res = row
        ? await sb.from('expenses').update(p).eq('id', row.id)
        : await sb.from('expenses').insert(p);
      if (res.error) {
        if (newPath) await sb.storage.from('receipts').remove([newPath]);
        throw res.error;
      }
      if (oldPath && (newPath || removeOld)) await sb.storage.from('receipts').remove([oldPath]);
      closeModal(); await load(); msg('تم الحفظ.');
    } catch (err) {
      msg('تعذّر الحفظ: ' + (err.message || err), true);
    } finally { busy = false; }
  }

  async function saveFunding() {
    var row = modal.row;
    var p = {
      received_on: val('received_on'), amount_iqd: Math.round(Number(val('amount_iqd'))),
      from_party: val('from_party'), received_by: val('received_by') || null, note: val('note') || null
    };
    if (!p.received_on || !p.from_party) return msg('التاريخ والجهة حقول مطلوبة.', true);
    if (!(p.amount_iqd > 0)) return msg('المبلغ يجب أن يكون أكبر من صفر.', true);
    busy = true; msg('جاري الحفظ...');
    try {
      var res = row ? await sb.from('funding_received').update(p).eq('id', row.id) : await sb.from('funding_received').insert(p);
      if (res.error) throw res.error;
      closeModal(); await load(); msg('تم الحفظ.');
    } catch (err) { msg('تعذّر الحفظ: ' + (err.message || err), true); }
    finally { busy = false; }
  }

  async function deleteExpense(r) {
    if (!r || !confirm('حذف المصروف "' + r.item + '" بمبلغ ' + fmt(r.amount_iqd) + '؟')) return;
    busy = true;
    try {
      var res = await sb.from('expenses').delete().eq('id', r.id);
      if (res.error) throw res.error;
      if (r.receipt_path) await sb.storage.from('receipts').remove([r.receipt_path]);
      await load(); msg('تم الحذف.');
    } catch (err) { msg('تعذّر الحذف: ' + (err.message || err), true); }
    finally { busy = false; }
  }

  async function deleteFunding(r) {
    if (!r || !confirm('حذف التمويل بمبلغ ' + fmt(r.amount_iqd) + '؟')) return;
    busy = true;
    try {
      var res = await sb.from('funding_received').delete().eq('id', r.id);
      if (res.error) throw res.error;
      await load(); msg('تم الحذف.');
    } catch (err) { msg('تعذّر الحذف: ' + (err.message || err), true); }
    finally { busy = false; }
  }

  async function openReceipt(path) {
    var w = window.open('', '_blank');
    var res = await sb.storage.from('receipts').createSignedUrl(path, 120);
    if (res.error) { if (w) w.close(); return msg('تعذّر فتح الإيصال: ' + res.error.message, true); }
    if (w) w.location = res.data.signedUrl; else window.location.href = res.data.signedUrl;
  }

  /* ---------- CSV (opens in Google Sheets / Excel with Arabic intact) ---------- */
  function csvCell(v) { var s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function download(name, rows) {
    var csv = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csvExpenses() {
    var rows = [['التاريخ', 'الفئة', 'البند', 'المبلغ (د.ع)', 'المبلغ الأصلي', 'العملة', 'سعر الصرف', 'من دفع', 'طريقة الدفع', 'المورّد', 'إيصال', 'ملاحظة']];
    S.expenses.slice().reverse().forEach(function (r) {
      rows.push([r.spent_on, CATS[r.category] || r.category, r.item, r.amount_iqd, r.original_amount, r.original_currency, r.fx_rate,
        r.paid_by, METHODS[r.payment_method] || r.payment_method, supplierName(r.supplier_id), r.receipt_path ? 'نعم' : 'لا', r.note]);
    });
    download(today() + '_finance_expenses.csv', rows);
  }
  function csvFunding() {
    var rows = [['التاريخ', 'المبلغ (د.ع)', 'من', 'استلمه', 'ملاحظة']];
    S.funding.slice().reverse().forEach(function (r) { rows.push([r.received_on, r.amount_iqd, r.from_party, r.received_by, r.note]); });
    download(today() + '_finance_funding.csv', rows);
  }

  /* ---------- public API ---------- */
  window.QadahFinance = {
    mount: function (el, client) {
      if (!el || !client) { console.error('QadahFinance.mount needs a container element and a supabase client'); return; }
      sb = client; root = el;
      if (!mounted) { injectCss(); skeleton(); mounted = true; }
    },
    refresh: function () { return load(); }
  };
})();
