/* =====================================================================
   Ustoz Shifu — Weekly Payment moduli
   Fastmover Express INC haftalik to'lov hisoboti (contractors)

   Ulash: index.html da all-drivers.js dan KEYIN, </body> dan OLDIN:
       <script src="weekly-payment.js"></script>

   Ma'lumot manbai: statement import qilinganda Supabase'ga tushgan
   payroll_periods + payroll_entries (qayta fayl yuklash shart emas).
   Statement fayllarini (Fastmover, ECA, One Ummah .xlsx) to'g'ridan-to'g'ri shu
   bo'limga tashlash mumkin: fayl o'qiladi, hafta PID dan aniqlanadi, ilovaning
   mavjud import funksiyasi orqali saqlanadi va hisobot o'zi to'ladi.
   Sozlamalar (Work Market ID, ushlanmalar, qo'lda qatorlar) Supabase'dagi
   wp_settings jadvalida saqlanadi (SQL: weekly-payment.sql).
   Bu fayl index.html ichidagi boshqa kodga tegmaydi.
   ===================================================================== */
(function () {
  'use strict';
  var G = (typeof window !== 'undefined') ? window : globalThis;
  if (G.__wpLoaded) return;
  G.__wpLoaded = true;

  /* ------------------------- Unit# tartibi (qat'iy) ------------------------- */
  // One Ummah unitlari: hisobotga KIRMAYDI (faqat Fastmover/ECA)
  var OU_UNITS = ['012', '014', '0992', '0955', '016', '015', '010', '0910', '3812', '9605', '6059', '6281', '5909', '1739', '1744', '5992', '4278', '6348', '4809', '018', '3411', '6314', '4866', '6004'];
  // Fastmover / ECA unitlari: hisobotdagi tartib shu
  var FM_UNITS = ['0007', '0008', '1081', '0010', '0012', '1789', '5948', '3994', '0011', '1735', '3365', '6387', '6489', '1047', '0143', '0988', '1143', '5889', '1116', '5969', '1447', '1329', '1129', '1176', '1399', '1246', '6014', '6030', '56', '5914', '5949', '5964', '6685', '6702', '6716', '6733', '6739', '6718', '6722', '6724', '6783', '9252', '9261', '9268', '9304', '7199', '7044', '1030', '3848', '5951', '3500', '5578', '9631', '6008', '5892', '5947', '4156', '4221', '4028', '6328', '6391', '1910', '6695', '5870', '5893', '3827', '6169', '3618', '6113', '3071', '3756', '3524', '3896', '6432', '3764', '4140', '4252', '1998', '5478', '7327', '2010', '6649', '2723', '7499', '5844', '6203', '6204', '7518', '7496', '6234', '7505', '7520', '7502', '7506', '4790', '7503', '7498', '7524', '7501'];
  var OU_SET = {}; OU_UNITS.forEach(function (u) { OU_SET[u] = true; });
  var FM_INDEX = {}; FM_UNITS.forEach(function (u, i) { FM_INDEX[u] = i; });

  /* ------------------------- yordamchilar ------------------------- */
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var round2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };
  var money = function (n) {
    return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var num = function (v) {
    if (v == null || v === '') return 0;
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  /* ------------------------- hafta hisoblari ------------------------- */
  function mondayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  }
  function isoWeekYear(monday) {
    // ISO hafta: payshanba qaysi yilga tushsa, o'sha yil
    var th = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3));
    var year = th.getUTCFullYear();
    var jan4 = new Date(Date.UTC(year, 0, 4));
    var jan4Mon = new Date(jan4); jan4Mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
    var week = 1 + Math.round((th - jan4Mon - 3 * 86400000) / (7 * 86400000));
    return { year: year, week: week };
  }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fullDate(d) { return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear(); }
  function weekInfo(monday) {
    var sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    var iw = isoWeekYear(monday);
    return {
      start: monday, end: sunday, num: iw.week, year: iw.year,
      key: iw.year + '-' + iw.week,
      range: fullDate(monday) + ' - ' + fullDate(sunday),
      title: 'Week #' + iw.week + ' · ' + fullDate(monday) + ' - ' + fullDate(sunday)
    };
  }
  function weekByOffset(off) {
    var m = mondayOf(new Date()); m.setDate(m.getDate() + off * 7); return weekInfo(m);
  }

  /* ------------------------- ismlar va ID lar ------------------------- */
  // Tartibsiz taqqoslash uchun kalit: "AKBAROV ABDILNOSIR" == "Abdilnosir Akbarov"
  function nameKey(n) {
    return String(n || '').toLowerCase().replace(/abdullayev/g, 'abdullaev')
      .replace(/[^a-z0-9\/\-() ]/g, '').split(/\s+/).filter(Boolean).sort().join(' ');
  }
  // Bilingan contractor ismlari (to'g'ri yozilishi) va Work Market ID lari
  var KNOWN = [
    ['Feruz Omonniyozov', '34445848'], ['Mohamed Tawfik', '40133188'], ['Aslam Bilal', '22866008'],
    ['Suhail Moffat', '31562860'], ['Athar Haq', '22662907'], ['Mukhammad Khakimov', '62947501'],
    ['Yousef Bakeer', '49707916'], ['Flex Md Asset Solutions LLC', '11868433'], ['Abdul-Kabir Karim', '81890260'],
    ['Salaam Holdings LLC', '97758760'], ['Abdul Sozzer', '55287478'], ['Hamza Ismail', '80033239'],
    ['Umar Salem / Buraq Logistics', '60336476'], ['Farhan Khan', '94694222'], ['Mutasim Abdullaev', '36738458'],
    ['Hajihussain Kamani', '97981389'], ['Syed Morshed', '31452597'], ['Mubeen Kamani', '48752675'],
    ['Ahmed Mahmood', '95214733'],
    ['Abdilnosir Akbarov', ''], ['Fastmover Express Llc', ''], ['Fastmover Express Inc', '']
  ];
  var KNOWN_NAME = {}, KNOWN_ID = {};
  KNOWN.forEach(function (k) { KNOWN_NAME[nameKey(k[0])] = k[0]; if (k[1]) KNOWN_ID[nameKey(k[0])] = k[1]; });
  var RTR35_ID = '23093321';

  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s\-\/(])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); })
      .replace(/\bLlc\b/g, 'LLC').replace(/\bRtr35\b/g, 'RTR35');
  }
  // Statementdagi ism: first_name = "#5992 ABDULLOH" yoki "#1081", last_name = "FERUZ OMONNIYOZOV"
  function displayName(first, last) {
    var extra = String(first || '').trim().replace(/^#\s*\d+\s*/, '');
    var n = ((extra ? extra + ' ' : '') + String(last || '').trim()).replace(/\s+/g, ' ').trim();
    var rt = n.match(/^rtr35\s*llc\s*-?\s*(\d+)$/i);
    if (rt) return 'RTR35 LLC - ' + rt[1];
    return KNOWN_NAME[nameKey(n)] || titleCase(n);
  }
  function unitOf(e) {
    var m = String(e.first_name || '').match(/^#\s*(\d+)/);
    if (m) return m[1];
    m = String(e.truck_number || '').trim().match(/^#?\s*(\d+)/);
    return m ? m[1] : '';
  }
  function companyLabel(name) {
    return /ummah/i.test(String(name || '')) ? 'OneUmmah' : 'Fastmover';
  }
  var isCompanyOwned = function (name) { return /^fastmover express/i.test(name); };

  /* ------------------------- hisobot modeli (sof mantiq) ------------------------- */
  // entries: [{first_name,last_name,truck_number,payout,advance_balance,company}]
  // ctx: { ids:{nameKey:id}, adj:{unit:{amount,note}}, manual:[{unit,name,amount,side,company}] }
  function buildModel(entries, ctx) {
    ctx = ctx || {};
    var ids = ctx.ids || {}, adj = ctx.adj || {}, manual = ctx.manual || [];
    var byUnit = {}, dup = 0, ouSkipped = 0;
    (entries || []).forEach(function (e) {
      var u = unitOf(e);
      if (!u) return;
      if (OU_SET[u]) { ouSkipped++; return; }
      if (byUnit[u]) { dup++; return; }
      byUnit[u] = {
        unit: u, name: displayName(e.first_name, e.last_name), company: e.company || 'Fastmover',
        payout: round2(num(e.payout)), advance: round2(num(e.advance_balance))
      };
    });
    manual.forEach(function (m) {
      var u = String(m.unit || '').replace(/^#/, '').trim();
      if (!u || OU_SET[u]) return;
      var side = m.side === 'debt' ? 'debt' : 'pay';
      var base = byUnit[u] || (byUnit[u] = { unit: u, name: m.name || '', company: m.company || 'Fastmover', payout: 0, advance: 0, manual: true });
      if (m.name) base.name = m.name;
      if (side === 'pay') base.payout = round2(num(m.amount)); else base.advance = round2(num(m.amount));
      base.manual = true;
    });
    var all = Object.keys(byUnit).map(function (u) { return byUnit[u]; });
    var unlisted = all.filter(function (r) { return FM_INDEX[r.unit] === undefined; }).map(function (r) { return r.unit; });
    all.sort(function (a, b) {
      var x = FM_INDEX[a.unit] === undefined ? 1e6 : FM_INDEX[a.unit];
      var y = FM_INDEX[b.unit] === undefined ? 1e6 : FM_INDEX[b.unit];
      return x !== y ? x - y : String(a.unit).localeCompare(String(b.unit));
    });
    var left = [], right = [];
    all.forEach(function (r) {
      var k = nameKey(r.name);
      var wm = ids[k] || KNOWN_ID[k] || (/^rtr35 llc/i.test(r.name) ? RTR35_ID : '');
      if (r.payout > 0 && !isCompanyOwned(r.name)) {
        var a = adj[r.unit] || null;
        var ded = a ? round2(num(a.amount)) : 0;
        left.push({
          unit: r.unit, name: r.name, wmId: wm, base: r.payout, deduction: ded, note: a && a.note || '',
          amount: round2(r.payout - ded), manual: !!r.manual,
          label: 'Investor-' + r.company + '-unit#' + r.unit
        });
      }
      if (r.advance > 0) {
        right.push({
          unit: r.unit, name: r.name, amount: r.advance, manual: !!r.manual,
          label: 'Advance balance.unit#' + r.unit
        });
      }
    });
    var sum = function (a) { return round2(a.reduce(function (s, r) { return s + r.amount; }, 0)); };
    return { left: left, right: right, totalLeft: sum(left), totalRight: sum(right), unlisted: unlisted, dup: dup, ouSkipped: ouSkipped };
  }

  /* ------------------------- Supabase: o'qish / yozish ------------------------- */
  var wpOffset = 0;
  var state = { model: null, week: null, settingsOk: true, ids: {}, adj: {}, manual: [], busy: false };

  async function fetchEntries(week) {
    var per = await sb.from('payroll_periods').select('id,company_id,pid_label,period_start')
      .eq('period_start', isoDate(week.start));
    if (per.error) throw per.error;
    var periods = per.data || [];
    if (!periods.length) return { entries: [], periods: 0 };
    var cmp = await sb.from('companies').select('id,name');
    var names = {};
    ((cmp && cmp.data) || []).forEach(function (c) { names[c.id] = c.name; });
    var label = {};
    periods.forEach(function (p) { label[p.id] = companyLabel(names[p.company_id]); });
    var out = [], from = 0, step = 1000;
    for (;;) {
      var r = await sb.from('payroll_entries').select('*')
        .in('payroll_period_id', periods.map(function (p) { return p.id; }))
        .order('created_at', { ascending: true }).range(from, from + step - 1);
      if (r.error) throw r.error;
      (r.data || []).forEach(function (e) { e.company = label[e.payroll_period_id]; out.push(e); });
      if (!r.data || r.data.length < step) break;
      from += step;
    }
    return { entries: out, periods: periods.length };
  }

  async function loadSettings(week) {
    state.ids = {}; state.adj = {}; state.manual = [];
    var r = await sb.from('wp_settings').select('*');
    if (r.error) { state.settingsOk = false; return; }
    state.settingsOk = true;
    (r.data || []).forEach(function (row) {
      if (row.kind === 'wm_id') state.ids[row.k] = (row.value && row.value.id) || '';
      else if (row.kind === 'adj' && row.week === week.key) state.adj[row.k] = row.value || {};
      else if (row.kind === 'manual' && row.week === week.key) {
        state.manual.push(Object.assign({ unit: row.k }, row.value || {}));
      }
    });
  }

  async function saveSetting(kind, k, week, value) {
    var u = await sb.auth.getUser();
    var user = u && u.data && u.data.user;
    if (!user) throw new Error('Tizimga kirilmagan');
    var res = await sb.from('wp_settings').upsert(
      { user_id: user.id, kind: kind, k: k, week: week || '', value: value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,kind,k,week' });
    if (res.error) throw res.error;
  }
  async function deleteSetting(kind, k, week) {
    var res = await sb.from('wp_settings').delete().eq('kind', kind).eq('k', k).eq('week', week || '');
    if (res.error) throw res.error;
  }

  /* ------------------------- ekran ------------------------- */
  var css = '' +
    '#wpRoot .wp-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:18px;align-items:start;}' +
    '@media(max-width:1100px){#wpRoot .wp-grid{grid-template-columns:1fr;}}' +
    '#wpRoot .wp-tbl{width:100%;border-collapse:collapse;font-size:13px;}' +
    '#wpRoot .wp-tbl th{background:#92D050;color:#111;font-weight:600;padding:7px 8px;text-align:left;border:1px solid var(--line);}' +
    '#wpRoot .wp-tbl td{padding:5px 8px;border:1px solid var(--line);vertical-align:middle;}' +
    '#wpRoot .wp-tbl.debt td{background:rgba(224,102,102,.28);}' +
    '#wpRoot .wp-tbl td.amt,#wpRoot .wp-tbl th.amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
    '#wpRoot .wp-tbl tr.total td{background:#92D050;color:#111;font-weight:700;}' +
    '#wpRoot .wp-id{width:100px;font:inherit;padding:3px 5px;border:1px solid var(--line);border-radius:5px;background:var(--paper);color:var(--text);}' +
    '#wpRoot .wp-id.has{background:rgba(146,208,80,.25);}' +
    '#wpRoot .wp-mini{font:inherit;font-size:11.5px;padding:2px 7px;border:1px solid var(--line);border-radius:5px;background:transparent;color:var(--steel);cursor:pointer;}' +
    '#wpRoot .wp-mini:hover{color:var(--text);}' +
    '#wpRoot .wp-ded{color:#c0392b;font-size:11.5px;display:block;}' +
    '#wpRoot .wp-note{font-size:12.5px;color:var(--steel);margin:8px 0 0;line-height:1.5;}' +
    '#wpRoot .wp-warn{font-size:12.5px;padding:9px 12px;border-radius:8px;border:1px solid #d9a441;background:rgba(217,164,65,.12);margin-bottom:14px;line-height:1.5;}' +
    '#wpRoot pre{white-space:pre-wrap;font-size:11.5px;background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:8px;margin:6px 0 0;}';

  var SQL_HELP =
    "create table if not exists public.wp_settings (\n" +
    "  id uuid primary key default gen_random_uuid(),\n" +
    "  user_id uuid not null references auth.users(id) on delete cascade,\n" +
    "  kind text not null, k text not null, week text not null default '',\n" +
    "  value jsonb not null default '{}'::jsonb,\n" +
    "  updated_at timestamptz default now(),\n" +
    "  unique (user_id, kind, k, week)\n);\n" +
    "alter table public.wp_settings enable row level security;\n" +
    "create policy \"wp own rows\" on public.wp_settings for all\n" +
    "  using (user_id = auth.uid()) with check (user_id = auth.uid());";

  function injectUI() {
    var panel = document.getElementById('panel-weekly-payment');
    if (!panel || document.getElementById('wpRoot')) return false;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var root = document.createElement('div'); root.id = 'wpRoot';
    root.innerHTML =
      '<div class="card" style="margin-bottom:18px;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<button class="btn" id="wpPrev" type="button" title="Oldingi hafta">‹</button>' +
      '<div id="wpWeekLabel" class="mono" style="font-weight:600;min-width:270px;text-align:center;"></div>' +
      '<button class="btn" id="wpNext" type="button" title="Keyingi hafta">›</button>' +
      '<span style="flex:1"></span>' +
      '<button class="btn" id="wpAddManual" type="button">+ Qo\'lda qator</button>' +
      '<button class="btn btn-primary" id="wpExport" type="button">Excel yuklab olish</button></div>' +
      '<div id="wpDrop" class="card" style="margin-bottom:18px;padding:18px;border:2px dashed var(--line);text-align:center;cursor:pointer;">' +
      '<div style="font-weight:600;">Statement fayllarini shu yerga tashlang</div>' +
      '<div class="wp-note" style="margin:4px 0 0;">Fastmover, ECA, One Ummah (.xlsx). Bir yo\'la uchalasini tashlash mumkin yoki bosib tanlang. Hafta statementdagi PID dan o\'zi aniqlanadi.</div>' +
      '<input id="wpFile" type="file" accept=".xlsx,.xls,.csv" multiple style="display:none"></div>' +
      '<div id="wpLog"></div><div id="wpMsg"></div><div id="wpBody"></div>';
    panel.insertBefore(root, panel.firstChild);
    var move = function (d) {
      wpOffset += d;
      try { localStorage.setItem('ustoz_wp_week_offset', wpOffset); } catch (e) { }
      refresh();
    };
    root.querySelector('#wpPrev').onclick = function () { move(-1); };
    root.querySelector('#wpNext').onclick = function () { move(1); };
    root.querySelector('#wpExport').onclick = exportExcel;
    root.querySelector('#wpAddManual').onclick = addManual;
    var drop = root.querySelector('#wpDrop'), fin = root.querySelector('#wpFile');
    drop.onclick = function () { fin.click(); };
    fin.onchange = function () { if (fin.files && fin.files.length) processFiles(Array.prototype.slice.call(fin.files)); fin.value = ''; };
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.style.background = 'rgba(146,208,80,.18)'; });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.style.background = ''; });
    });
    drop.addEventListener('drop', function (e) {
      var fl = e.dataTransfer && e.dataTransfer.files;
      if (fl && fl.length) processFiles(Array.prototype.slice.call(fl));
    });
    try {
      var so = localStorage.getItem('ustoz_wp_week_offset');
      wpOffset = so !== null ? (parseInt(so, 10) || 0) : 0;
    } catch (e) { }
    return true;
  }

  function render() {
    var m = state.model, w = state.week;
    document.getElementById('wpWeekLabel').textContent = w.title;
    var msg = [];
    if (!state.settingsOk) {
      msg.push('<div class="wp-warn"><b>Sozlamalar jadvali hali yaratilmagan</b> (Work Market ID, ushlanma va qo\'lda qatorlar saqlanmaydi). ' +
        'Supabase → SQL Editor ga quyidagi kodni bir marta joylab ishga tushiring, so\'ng sahifani yangilang:<pre>' + esc(SQL_HELP) + '</pre></div>');
    }
    if (m.unlisted.length) {
      msg.push('<div class="wp-warn">Ro\'yxatda yo\'q unitlar (hisobot oxirida chiqdi): <b>' + esc(m.unlisted.join(', ')) + '</b></div>');
    }
    if (m.dup) msg.push('<div class="wp-warn">' + m.dup + ' ta takror unit qatori o\'tkazib yuborildi (birinchisi olindi).</div>');
    document.getElementById('wpMsg').innerHTML = msg.join('');

    var body = document.getElementById('wpBody');
    if (!state.hasData) {
      body.innerHTML = '<div class="card empty"><h3>Bu hafta uchun statement topilmadi</h3>' +
        '<p>' + esc(w.range) + ' haftasi statementlarini (Fastmover, ECA, One Ummah) yuqoridagi maydonga tashlang.</p></div>';
      return;
    }
    var L = m.left.map(function (r, i) {
      var amtCell = money(r.amount) + (r.deduction ? '<span class="wp-ded">−' + money(r.deduction) + (r.note ? ' · ' + esc(r.note) : '') + '</span>' : '');
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td>' +
        '<td><input class="wp-id' + (r.wmId ? ' has' : '') + '" data-name="' + esc(r.name) + '" value="' + esc(r.wmId) + '" inputmode="numeric" placeholder="ID"></td>' +
        '<td class="amt">' + amtCell + ' <button class="wp-mini" data-adj="' + esc(r.unit) + '" title="Ushlanma kiritish">−</button></td>' +
        '<td>' + esc(r.label) + (r.manual ? ' <button class="wp-mini" data-delmanual="' + esc(r.unit) + '" title="Qo\'lda qatorni o\'chirish">×</button>' : '') + '</td></tr>';
    }).join('');
    var R = m.right.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td class="amt">' + money(r.amount) + '</td><td>' + esc(r.label) +
        (r.manual ? ' <button class="wp-mini" data-delmanual="' + esc(r.unit) + '" title="Qo\'lda qatorni o\'chirish">×</button>' : '') + '</td></tr>';
    }).join('');
    body.innerHTML = '<div class="wp-grid">' +
      '<div class="card" style="padding:12px;overflow:auto;"><div style="font-weight:700;margin-bottom:8px;">Fastmover Express INC weekly payment report contractors\' · ' + esc(w.range) + ' · week #' + w.num + '</div>' +
      '<table class="wp-tbl"><thead><tr><th>№</th><th>Contractor</th><th>Work Market ID</th><th class="amt">Amount</th><th>Note</th></tr></thead><tbody>' + L +
      '<tr class="total"><td colspan="3">TOTAL:</td><td class="amt">' + money(m.totalLeft) + '</td><td></td></tr></tbody></table>' +
      '<p class="wp-note">Work Market ID ni maydonga yozing (saqlanadi). “−” tugmasi bilan qo\'shimcha ushlanma kiriting. “Fastmover Express” qatorlari chap tarafga kirmaydi.</p></div>' +
      '<div class="card" style="padding:12px;overflow:auto;"><div style="font-weight:700;margin-bottom:8px;">Contractors debt from week #' + w.num + '</div>' +
      '<table class="wp-tbl debt"><thead><tr><th>№</th><th>Driver</th><th class="amt">Amount</th><th>Note</th></tr></thead><tbody>' + R +
      '<tr class="total"><td colspan="2">TOTAL:</td><td class="amt">' + money(m.totalRight) + '</td><td></td></tr></tbody></table></div></div>';
    wire(body);
  }

  function wire(body) {
    body.querySelectorAll('input.wp-id').forEach(function (inp) {
      inp.addEventListener('change', async function () {
        var v = inp.value.replace(/\D/g, '');
        inp.value = v;
        if (!state.settingsOk) { alert('Avval Supabase\'da wp_settings jadvalini yarating (yuqoridagi SQL).'); return; }
        try {
          var k = nameKey(inp.dataset.name);
          if (v) { await saveSetting('wm_id', k, '', { id: v }); state.ids[k] = v; }
          else { await deleteSetting('wm_id', k, ''); delete state.ids[k]; }
          inp.classList.toggle('has', !!v);
          rebuild();
        } catch (err) { alert('Saqlashda xatolik: ' + (err.message || err)); }
      });
    });
    body.querySelectorAll('[data-adj]').forEach(function (b) {
      b.onclick = async function () {
        if (!state.settingsOk) { alert('Avval Supabase\'da wp_settings jadvalini yarating (yuqoridagi SQL).'); return; }
        var u = b.dataset.adj, cur = state.adj[u];
        var a = prompt('Unit#' + u + ': ushlanma summasi ($). Bo\'sh qoldirsangiz o\'chadi.', cur ? cur.amount : '');
        if (a === null) return;
        try {
          if (String(a).trim() === '') { await deleteSetting('adj', u, state.week.key); delete state.adj[u]; }
          else {
            var amount = num(a);
            var note = prompt('Izoh (ixtiyoriy):', cur && cur.note || '') || '';
            await saveSetting('adj', u, state.week.key, { amount: amount, note: note });
            state.adj[u] = { amount: amount, note: note };
          }
          rebuild();
        } catch (err) { alert('Saqlashda xatolik: ' + (err.message || err)); }
      };
    });
    body.querySelectorAll('[data-delmanual]').forEach(function (b) {
      b.onclick = async function () {
        var u = b.dataset.delmanual;
        if (!confirm('Unit#' + u + ' qo\'lda qatorini o\'chiraymi?')) return;
        try {
          await deleteSetting('manual', u, state.week.key);
          state.manual = state.manual.filter(function (x) { return x.unit !== u; });
          rebuild();
        } catch (err) { alert('Xatolik: ' + (err.message || err)); }
      };
    });
  }

  async function addManual() {
    if (!state.settingsOk) { alert('Avval Supabase\'da wp_settings jadvalini yarating (yuqoridagi SQL).'); return; }
    var unit = (prompt('Unit raqami (masalan 7044):') || '').replace(/^#/, '').trim();
    if (!unit) return;
    var name = (prompt('Contractor nomi (masalan RTR35 LLC - 15):') || '').trim();
    if (!name) return;
    var amount = num(prompt('Summa ($):'));
    if (!amount) return;
    var side = confirm('To\'lanadigan summami? OK = to\'lov (chap), Cancel = qarz (o\'ng).') ? 'pay' : 'debt';
    try {
      var val = { name: name, amount: amount, side: side, company: 'Fastmover' };
      await saveSetting('manual', unit, state.week.key, val);
      state.manual = state.manual.filter(function (x) { return x.unit !== unit; });
      state.manual.push(Object.assign({ unit: unit }, val));
      rebuild();
    } catch (err) { alert('Saqlashda xatolik: ' + (err.message || err)); }
  }

  function rebuild() {
    state.model = buildModel(state.entries, { ids: state.ids, adj: state.adj, manual: state.manual });
    state.hasData = state.entries.length > 0 || state.manual.length > 0;
    render();
  }

  async function refresh() {
    var lbl = document.getElementById('wpWeekLabel');
    var w = weekByOffset(wpOffset);
    state.week = w;
    if (lbl) lbl.textContent = w.title;
    try {
      var got = await fetchEntries(w);
      await loadSettings(w);
      state.entries = got.entries;
      rebuild();
    } catch (err) {
      console.error('Weekly Payment yuklashda xatolik:', err);
      var msg = document.getElementById('wpMsg');
      if (msg) msg.innerHTML = '<div class="wp-warn">Yuklashda xatolik: ' + esc(err.message || err) + '</div>';
    }
  }

  /* ------------------------- statement fayllarini tashlash ------------------------- */
  var logLines = [];
  function log(kind, text) {
    logLines.push({ kind: kind, text: text });
    var el = (typeof document !== 'undefined') && document.getElementById('wpLog');
    if (!el) return;
    el.innerHTML = '<div class="card" style="margin-bottom:18px;padding:10px 14px;font-size:13px;line-height:1.7;">' +
      logLines.map(function (l) {
        var ic = l.kind === 'ok' ? '✓' : (l.kind === 'err' ? '✗' : '•');
        var col = l.kind === 'ok' ? '#2e7d32' : (l.kind === 'err' ? '#c0392b' : 'inherit');
        return '<div style="color:' + col + '">' + ic + ' ' + esc(l.text) + '</div>';
      }).join('') + '</div>';
  }
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  // Statementdagi "Company: X" nomini companies jadvalidagi kompaniyaga moslaymiz
  function matchCompany(fileCompany, companies) {
    var f = norm(fileCompany), best = null, bestLen = 0;
    if (!f) return null;
    (companies || []).forEach(function (c) {
      var n = norm(c.name);
      if (n.length < 3) return;
      var hit = (f === n) || f.indexOf(n) !== -1 || n.indexOf(f) !== -1 ||
        (/ummah/.test(f) && /ummah/.test(n)) || (/fastmover/.test(f) && /fastmover/.test(n));
      if (hit && (f === n ? 1e6 : n.length) > bestLen) { best = c; bestLen = f === n ? 1e6 : n.length; }
    });
    return best;
  }
  function pidToMonday(pid) {
    var m = String(pid || '').match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return null;
    var y = parseInt(m[1], 10), w = parseInt(m[2], 10);
    var jan4 = new Date(Date.UTC(y, 0, 4));
    var mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7);
    return new Date(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate());
  }
  function offsetOfMonday(monday) {
    return Math.round((monday - mondayOf(new Date())) / (7 * 86400000));
  }
  function companyRow(rows) {
    for (var i = 0; i < (rows || []).length && i < 10; i++) {
      var m = String((rows[i] && rows[i][0]) || '').match(/^company:\s*(.+)$/i);
      if (m) return m[1].trim();
    }
    return '';
  }

  async function processOne(file, companies) {
    var ex = await extractFile(file);
    if (!ex || !ex.columns || !ex.rows) { log('err', file.name + ': fayl o\'qilmadi yoki bo\'sh.'); return null; }
    var stmt = tryParsePayrollStatement(ex.columns, ex.rows);
    if (!stmt) { log('err', file.name + ': bu payroll statement emas (First Name / Last Name / Trips Mileage ustunlari topilmadi).'); return null; }
    var monday = pidToMonday(stmt.pidLabel);
    if (!monday) { log('err', file.name + ': PID (masalan 2026-42) topilmadi, haftani aniqlab bo\'lmadi.'); return null; }
    var fileCompany = companyRow(ex.rows);
    var comp = matchCompany(fileCompany, companies);
    var companyId = comp ? comp.id : (typeof selectedCompanyId !== 'undefined' ? selectedCompanyId : null);
    var coName = comp ? comp.name : (fileCompany || 'kompaniya nomi yo\'q');
    var wk = weekInfo(monday);
    var pStart = isoDate(monday);

    // Shu hafta + kompaniya uchun statement allaqachon bor bo'lsa: tasdiq bilan almashtiramiz
    if (companyId) {
      var ex1 = await sb.from('payroll_periods').select('id').eq('company_id', companyId).eq('period_start', pStart);
      if (ex1.error) throw ex1.error;
      var olds = ex1.data || [];
      if (olds.length) {
        var ok = (typeof confirm === 'function')
          ? confirm(coName + ' — Week #' + wk.num + ' statementi allaqachon import qilingan. Eskisini yangisi bilan almashtiraymi?')
          : true;
        if (!ok) { log('info', file.name + ': o\'tkazib yuborildi (almashtirilmadi).'); return null; }
        var ids = olds.map(function (p) { return p.id; });
        var d1 = await sb.from('payroll_entries').delete().in('payroll_period_id', ids);
        if (d1.error) throw d1.error;
        var d2 = await sb.from('payroll_periods').delete().in('id', ids);
        if (d2.error) throw d2.error;
      }
    } else {
      log('info', file.name + ': kompaniya aniqlanmadi, eski statement tekshirilmadi.');
    }

    // Hujjatlar ro'yxatiga (statements) faqat bir marta saqlaymiz
    try {
      var has = await sb.from('statements').select('id').eq('file_name', file.name).limit(1);
      if (!has.error && !(has.data && has.data.length)) await saveStatement(file.name, ex.sheetName, ex.columns, ex.rows);
    } catch (e) { /* hujjat tarixi ixtiyoriy */ }

    // Ilovaning mavjud importi (hech narsa takrorlanmaydi), kompaniya statementdan olinadi
    var prev = (typeof selectedCompanyId !== 'undefined') ? selectedCompanyId : null;
    var fake = { className: '', textContent: '', _c: [], classList: { add: function () { for (var i = 0; i < arguments.length; i++) fake._c.push(arguments[i]); } } };
    try {
      if (companyId && typeof selectedCompanyId !== 'undefined') selectedCompanyId = companyId;
      await importPayrollStatementEntries({ file_name: file.name }, stmt, fake);
    } finally {
      if (typeof selectedCompanyId !== 'undefined') selectedCompanyId = prev;
    }
    if (fake._c.indexOf('err') !== -1) { log('err', file.name + ': ' + fake.textContent); return null; }
    log('ok', coName + ' · Week #' + wk.num + ' · ' + stmt.entries.length + ' qator import qilindi.');
    return monday;
  }

  async function processFiles(files) {
    if (state.busy) return;
    state.busy = true; logLines = [];
    log('info', files.length + ' ta fayl o\'qilmoqda...');
    var last = null;
    try {
      var cmp = await sb.from('companies').select('id,name');
      var companies = (cmp && cmp.data) || [];
      for (var i = 0; i < files.length; i++) {
        try {
          var mon = await processOne(files[i], companies);
          if (mon) last = mon;
        } catch (err) {
          console.error(err);
          log('err', files[i].name + ': ' + (err.message || err));
        }
      }
    } finally { state.busy = false; }
    if (last) {
      wpOffset = offsetOfMonday(last);
      try { localStorage.setItem('ustoz_wp_week_offset', wpOffset); } catch (e) { }
      await refresh();
    }
  }

  /* ------------------------- Excel (rasmdagi uslub) ------------------------- */
  function loadExcelJS() {
    if (G.ExcelJS) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = resolve; s.onerror = function () { reject(new Error('ExcelJS yuklanmadi')); };
      document.head.appendChild(s);
    });
  }

  function buildWorkbook(model, week) {
    var wb = new G.ExcelJS.Workbook();
    var ws = wb.addWorksheet('Week ' + week.num);
    var T = 'Times New Roman';
    var GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };
    var LGREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
    var RED = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE06666' } };
    var thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
    var border = { top: thin, left: thin, bottom: thin, right: thin };
    var fmt = '"$"#,##0.00';
    [5, 32, 15, 13, 32, 3, 5, 30, 13, 30].forEach(function (w2, i) { ws.getColumn(i + 1).width = w2; });

    ws.mergeCells('A1:E1');
    ws.getCell('A1').value = "Fastmover Express INC weekly payment report contractors' for period " + week.range + ' week #' + week.num;
    ws.mergeCells('G1:J1');
    ws.getCell('G1').value = 'Contractors debt from week #' + week.num;
    [1, 2, 3, 4, 5, 7, 8, 9, 10].forEach(function (c) { ws.getCell(1, c).fill = GREEN; });
    ['A1', 'G1'].forEach(function (a) {
      ws.getCell(a).font = { name: T, size: 12, bold: true };
      ws.getCell(a).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws.getRow(1).height = 34;

    ['№', 'Contractor', 'Work Market ID', 'Amount', 'Note'].forEach(function (h, i) { styleHead(ws.getCell(2, i + 1), h); });
    ['№', 'Driver', 'Amount', 'Note'].forEach(function (h, i) { styleHead(ws.getCell(2, 7 + i), h); });
    function styleHead(c, h) {
      c.value = h; c.font = { name: T, size: 10, bold: true }; c.fill = LGREEN; c.border = border;
      c.alignment = { horizontal: 'center' };
    }
    model.left.forEach(function (r, i) {
      var row = 3 + i;
      var vals = [i + 1, r.name, r.wmId ? Number(r.wmId) : null, r.amount, r.label];
      vals.forEach(function (v, j) {
        var c = ws.getCell(row, j + 1); c.value = v; c.font = { name: T, size: 10 }; c.border = border;
      });
      ws.getCell(row, 1).alignment = { horizontal: 'center' };
      ws.getCell(row, 4).numFmt = fmt;
      if (r.wmId) ws.getCell(row, 4).fill = GREEN;
    });
    model.right.forEach(function (r, i) {
      var row = 3 + i;
      [i + 1, r.name, r.amount, r.label].forEach(function (v, j) {
        var c = ws.getCell(row, 7 + j); c.value = v; c.font = { name: T, size: 10 }; c.border = border; c.fill = RED;
      });
      ws.getCell(row, 7).alignment = { horizontal: 'center' };
      ws.getCell(row, 9).numFmt = fmt;
    });
    var lt = 3 + model.left.length, rt = 3 + model.right.length;
    ws.getCell(lt, 1).value = 'TOTAL:';
    ws.getCell(lt, 4).value = { formula: 'SUM(D3:D' + (lt - 1) + ')', result: model.totalLeft };
    for (var c1 = 1; c1 <= 5; c1++) { var a = ws.getCell(lt, c1); a.font = { name: T, size: 11, bold: true }; a.fill = GREEN; a.border = border; }
    ws.getCell(lt, 4).numFmt = fmt;
    ws.getCell(rt, 7).value = 'TOTAL:';
    ws.getCell(rt, 9).value = { formula: 'SUM(I3:I' + (rt - 1) + ')', result: model.totalRight };
    for (var c2 = 7; c2 <= 10; c2++) { var b = ws.getCell(rt, c2); b.font = { name: T, size: 11, bold: true }; b.fill = GREEN; b.border = border; }
    ws.getCell(rt, 9).numFmt = fmt;
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    return wb;
  }

  async function exportExcel() {
    var btn = document.getElementById('wpExport');
    if (!state.model || !state.hasData) { alert('Bu hafta uchun ma\'lumot yo\'q.'); return; }
    var old = btn.textContent; btn.disabled = true; btn.textContent = 'Tayyorlanmoqda...';
    try {
      await loadExcelJS();
      var wb = buildWorkbook(state.model, state.week);
      var buf = await wb.xlsx.writeBuffer();
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Fastmover-weekly-payment-week' + state.week.num + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    } catch (err) {
      alert('Excel yaratishda xatolik: ' + (err.message || err));
    } finally { btn.disabled = false; btn.textContent = old; }
  }

  /* ------------------------- ishga tushirish ------------------------- */
  function install() {
    if (!injectUI()) return;
    // Panel ochilganda yangilanadi
    var item = document.querySelector('.nav-item[data-panel="weekly-payment"]');
    if (item) item.addEventListener('click', function () { refresh(); });
    var rootEl = document.getElementById('appRoot');
    var panel = document.getElementById('panel-weekly-payment');
    // Sahifa qayta yuklanganda shu panel ochiq bo'lsa darhol yangilaymiz
    if (rootEl && rootEl.style.display === 'grid' && panel && panel.classList.contains('active')) refresh();
    // Sessiya keyinroq tiklansa ham panel ochiq bo'lsa yangilaymiz
    if (rootEl && G.MutationObserver) {
      new G.MutationObserver(function () {
        if (rootEl.style.display === 'grid' && panel.classList.contains('active') && !state.week) refresh();
      }).observe(rootEl, { attributes: true, attributeFilter: ['style'] });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildModel: buildModel, displayName: displayName, unitOf: unitOf, nameKey: nameKey, weekInfo: weekInfo, mondayOf: mondayOf, weekByOffset: weekByOffset, buildWorkbook: buildWorkbook, processFiles: processFiles, state: state, matchCompany: matchCompany, pidToMonday: pidToMonday, offsetOfMonday: offsetOfMonday, companyRow: companyRow, FM_UNITS: FM_UNITS, OU_UNITS: OU_UNITS };
    return;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
