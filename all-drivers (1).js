/* =====================================================================
   Ustoz Shifu — All Drivers moduli (Boshqaruvchi jarayoni)
   Ulash: index.html da </body> dan OLDIN, asosiy <script> blokidan KEYIN:
       <script src="all-drivers.js"></script>
   Bu fayl mavjud funksiyalarni (importStatementIntoPayroll, refreshPayroll)
   o'zi almashtiradi, index.html ichidagi boshqa kodga tegmaydi.
   ===================================================================== */
(function () {
  'use strict';
  var G = (typeof window !== 'undefined') ? window : globalThis;
  if (G.__adWizardLoaded) return;
  G.__adWizardLoaded = true;

  /* ------------------------- umumiy yordamchilar ------------------------- */
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var money = function (n) {
    return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var dayStart = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  var dKey = function (d) { return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : ''; };
  var dShort = function (d) { return d ? pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() : null; };
  var normU = function (s) {
    return String(s == null ? '' : s).trim().replace(/^unit\s*#?\s*/i, '').replace(/\.0$/, '').trim();
  };
  var num = function (v) {
    if (v == null || v === '') return 0;
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  };
  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  // Sanani o'qiydi: Date, 2026-09-21, 09/21/2026, 09.21.2026, "21 Sep 26 10:00 MDT"
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : dayStart(v);
    var s = String(v).trim(), m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/))) return new Date(+m[3], +m[1] - 1, +m[2]);
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})/))) {
      var mo = MON[m[2].toLowerCase()];
      if (mo !== undefined) return new Date(m[3].length === 2 ? 2000 + (+m[3]) : +m[3], mo, +m[1]);
    }
    var d = new Date(s);
    return isNaN(d) ? null : dayStart(d);
  }

  var mondayOf = function (date) {
    var d = dayStart(date), day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  };
  function isoWeek(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    var ft = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - ft) / 86400000 - 3 + ((ft.getUTCDay() + 6) % 7)) / 7);
  }
  var shortYY = function (d) { return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + String(d.getFullYear()).slice(-2); };
  function weekInfo(monday) {
    var sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    return {
      start: monday, end: sunday, num: isoWeek(monday),
      title: 'Week #' + isoWeek(monday) + ' period ' + shortYY(monday) + ' - ' + shortYY(sunday)
    };
  }
  var weekByOffset = function (off) {
    var m = mondayOf(new Date()); m.setDate(m.getDate() + off * 7); return weekInfo(m);
  };

  /* ------------------------- Unit# tartibi (app o'zgaruvchilari) ------------------------- */
  var EXTRA_KEY = 'ustoz_extra_units';
  function registerUnit(u, group, persist) {
    if (UNIT_ORDER.has(u)) return;
    if (group === 'one') {
      ONE_UMMAH_UNITS.push(u);
      UNIT_ORDER.set(u, { group: 0, idx: ONE_UMMAH_UNITS.length - 1, label: 'One Ummah' });
    } else {
      FASTMOVER_ECA_UNITS.push(u);
      UNIT_ORDER.set(u, { group: 1, idx: FASTMOVER_ECA_UNITS.length - 1, label: 'Fastmover / ECA' });
    }
    if (persist) {
      try {
        var m = JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}'); m[u] = group;
        localStorage.setItem(EXTRA_KEY, JSON.stringify(m));
      } catch (e) { /* storage yo'q bo'lsa ham ishlayveradi */ }
    }
  }
  function loadExtraUnits() {
    try {
      var m = JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}');
      Object.keys(m).forEach(function (u) { registerUnit(u, m[u], false); });
    } catch (e) { }
  }

  /* ------------------------- 1) YIG'UVCHI: Trips export'ni o'qish ------------------------- */
  function findIdx(cols, pats) {
    for (var i = 0; i < pats.length; i++) {
      var k = cols.findIndex(function (c) { return pats[i].test(String(c).trim()); });
      if (k !== -1) return k;
    }
    return -1;
  }

  // Natija: {loads, skipped} yoki null (format tanilmasa)
  function parseTrips(columns, rows) {
    var iTrip = findIdx(columns, [/^trip\s*#?$/i]);
    var iAs = findIdx(columns, [/^assignees?$/i]);
    var iTruck = findIdx(columns, [/^assigned\s*truck$/i]);
    var iRate = findIdx(columns, [/^assigned\s*rate$/i, /rate\s*\(quote\)/i, /^rate$/i]);
    if (iTrip < 0 || iAs < 0 || iTruck < 0 || iRate < 0) return null;
    var iRef = findIdx(columns, [/^ref\s*#?$/i]);
    var iBill = findIdx(columns, [/^bill\s*to$/i]);
    var iCity = findIdx(columns, [/^city$/i]);
    var iState = findIdx(columns, [/^state$/i]);
    var iEmpty = findIdx(columns, [/empty\s*mi/i]);
    var iLoaded = findIdx(columns, [/loaded\s*mi/i]);
    var iAppt = findIdx(columns, [/appt\s*date/i]);

    // Har yuk 2+ qatorda: birinchi qatorda Trip #, keyingilarida bo'sh
    var trips = [], cur = null;
    rows.forEach(function (r) {
      var id = String(r[iTrip] == null ? '' : r[iTrip]).trim();
      if (id) { cur = { id: id, legs: [r] }; trips.push(cur); }
      else if (cur && r.some(function (c) { return String(c == null ? '' : c).trim() !== ''; })) cur.legs.push(r);
    });

    var loads = [], skipped = [];
    trips.forEach(function (t) {
      var first = t.legs[0], last = t.legs[t.legs.length - 1];
      var driver = String(first[iAs] == null ? '' : first[iAs]).trim();
      var dhd = 0, mileage = 0;
      t.legs.forEach(function (l) {
        if (iEmpty >= 0) dhd += num(l[iEmpty]);
        if (iLoaded >= 0) mileage += num(l[iLoaded]);
      });
      if (!driver || (dhd + mileage) <= 0) {
        skipped.push({ tripId: t.id, reason: !driver ? 'haydovchisiz' : 'masofasiz' });
        return;
      }
      var rate = 0;
      for (var k = 0; k < t.legs.length && !rate; k++) rate = num(t.legs[k][iRate]);
      var city = function (r) { return iCity < 0 ? '' : (String(r[iCity] || '').trim() + (iState >= 0 && r[iState] ? ', ' + String(r[iState]).trim() : '')); };
      loads.push({
        tripId: t.id,
        driverName: driver,
        unit: normU(first[iTruck]),
        pickup: parseDate(first[iAppt]),
        delivery: parseDate(last[iAppt]),
        broker: iBill >= 0 ? String(first[iBill] || '').trim() : '',
        load_number: iRef >= 0 ? String(first[iRef] == null ? '' : first[iRef]).trim() : '',
        from_location: city(first), to_location: city(last),
        base_pay: rate, dhd: dhd, mileage: mileage, stops: t.legs.length
      });
    });
    return { loads: loads, skipped: skipped };
  }

  /* ------------------------- 2) TEKSHIRUVCHI ------------------------- */
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
  }
  // ctx: {weekStart, weekEnd, existing:Set('load|YYYY-MM-DD'), dbUnitByName:Map(name->unit)}
  function runChecks(loads, ctx) {
    var errors = [], suspects = [], clean = [];
    var put = function (arr, title, items, okText) {
      if (items.length) arr.push({ title: title, items: items });
      else if (okText) clean.push(okText);
    };
    var tag = function (l) { return 'Trip #' + l.tripId + ' (Unit ' + (l.unit || '?') + ', ' + l.driverName + ')'; };

    // 1. Takroriy yuklar
    var seen = {}, dup = [];
    loads.forEach(function (l) {
      var k = [l.load_number, dKey(l.pickup), l.base_pay].join('|');
      if (seen[k] !== undefined) dup.push(tag(l) + ' = Trip #' + seen[k] + ' bilan bir xil (Load ' + l.load_number + ')');
      else seen[k] = l.tripId;
    });
    put(errors, 'Takroriy yuklar', dup, 'Takroriy yuk yo\'q');

    // 2. Bo'sh maydonlar
    var blanks = [];
    loads.forEach(function (l) {
      var miss = [];
      if (!l.driverName) miss.push('haydovchi');
      if (!l.unit) miss.push('Unit#');
      if (!l.base_pay) miss.push('summa');
      if (!l.mileage) miss.push('masofa');
      if (!l.pickup) miss.push('pick up sanasi');
      if (!l.delivery) miss.push('delivery sanasi');
      if (miss.length) blanks.push(tag(l) + ': ' + miss.join(', ') + ' yetishmayapti');
    });
    put(errors, "Bo'sh maydonlar", blanks, "Bo'sh maydon yo'q");

    // 3. Nol / manfiy
    var bad = [];
    loads.forEach(function (l) {
      if (l.base_pay < 0 || l.dhd < 0 || l.mileage < 0) bad.push(tag(l) + ': manfiy qiymat');
    });
    put(errors, 'Manfiy qiymatlar', bad, 'Nol yoki manfiy summa/masofa yo\'q');

    // 4. Sana mantig'i va hafta chegarasi
    var order = [], outPick = [], outDel = [];
    loads.forEach(function (l) {
      if (l.pickup && l.delivery && l.delivery < l.pickup) order.push(tag(l) + ': delivery pick up\'dan oldin');
      if (l.pickup && (l.pickup < ctx.weekStart || l.pickup > ctx.weekEnd)) outPick.push(tag(l) + ': pick up ' + dShort(l.pickup));
      if (l.delivery && (l.delivery < ctx.weekStart || l.delivery > ctx.weekEnd)) outDel.push(tag(l) + ': delivery ' + dShort(l.delivery));
    });
    put(errors, 'Delivery sanasi pick up\'dan oldin', order);
    put(suspects, 'Pick up sanasi hafta tashqarisida', outPick);
    put(suspects, 'Delivery sanasi hafta tashqarisida (keyingi haftaga o\'tadigan yuklar; qo\'lda tekshiriladi)', outDel);
    if (!order.length && !outPick.length && !outDel.length) clean.push('Hamma sana hafta ichida');

    // 5. G'alati qiymatlar
    var rpmOf = function (l) { return (l.dhd + l.mileage) > 0 ? l.base_pay / (l.dhd + l.mileage) : 0; };
    var mR = median(loads.map(rpmOf).filter(function (x) { return x > 0; }));
    var mD = median(loads.map(function (l) { return l.dhd; }));
    var odd = [];
    loads.forEach(function (l) {
      var r = rpmOf(l);
      if (mR && r > 0 && r < mR * 0.55) odd.push(tag(l) + ': RPM $' + r.toFixed(2) + ' (odatdagi ~$' + mR.toFixed(2) + ')');
      else if (mR && r > mR * 1.8) odd.push(tag(l) + ': RPM $' + r.toFixed(2) + ' (odatdagi ~$' + mR.toFixed(2) + ')');
      if (l.dhd > Math.max(400, mD * 8)) odd.push(tag(l) + ': DHD ' + l.dhd.toFixed(2) + ' mi (odatdagi ~' + mD.toFixed(0) + ' mi)');
    });
    put(suspects, "G'alati summa yoki masofa", odd, "G'alati summa/masofa yo'q");

    // 6. Bazada allaqachon bor yuklar (qayta import)
    var inDb = [];
    loads.forEach(function (l) {
      if (ctx.existing && ctx.existing.has(l.load_number + '|' + dKey(l.pickup))) inDb.push(tag(l) + ': bazada allaqachon bor, o\'tkazib yuboriladi');
    });
    put(suspects, 'Bazada allaqachon bor yuklar', inDb);

    // 7. Haydovchi bazada boshqa Unit# bilan
    var drift = [], dseen = {};
    loads.forEach(function (l) {
      var u = ctx.dbUnitByName && ctx.dbUnitByName.get(l.driverName.trim().toLowerCase());
      var key = l.driverName + '|' + l.unit;
      if (u && l.unit && normU(u) !== l.unit && !dseen[key]) {
        dseen[key] = 1; drift.push(l.driverName + ': bazada Unit#' + normU(u) + ', faylda Unit#' + l.unit);
      }
    });
    put(suspects, 'Haydovchi bazada boshqa Unit# bilan', drift);

    // 8. Jami
    var total = loads.reduce(function (s, l) { return s + l.base_pay; }, 0);
    var byUnit = {};
    loads.forEach(function (l) { byUnit[l.unit] = (byUnit[l.unit] || 0) + l.base_pay; });
    var sumUnits = Object.keys(byUnit).reduce(function (s, k) { return s + byUnit[k]; }, 0);
    if (Math.abs(total - sumUnits) < 0.005) clean.push('Jami mos: ' + loads.length + ' yuk, ' + money(total));
    else errors.push({ title: 'Jami mos kelmadi', items: [money(total) + ' ≠ ' + money(sumUnits)] });

    return { errors: errors, suspects: suspects, clean: clean, total: total };
  }

  /* ------------------------- Oyna (modal) ------------------------- */
  function modal(inner, width) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,18,32,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:36px 14px;overflow:auto;';
    var box = document.createElement('div');
    box.style.cssText = 'background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:12px;width:100%;max-width:' + (width || 780) + 'px;padding:20px 22px;box-shadow:0 20px 60px rgba(0,0,0,.35);font-family:"IBM Plex Sans",sans-serif;font-size:13.5px;';
    box.innerHTML = inner;
    ov.appendChild(box); document.body.appendChild(ov);
    return { ov: ov, box: box, close: function () { ov.remove(); } };
  }
  var H2 = 'font-family:"Space Grotesk",sans-serif;font-size:17px;margin:0 0 6px;';
  var SUB = 'margin:0 0 14px;color:var(--steel);font-size:12.5px;line-height:1.5;';

  // A to'xtash nuqtasi: noma'lum Unit#
  function stageUnknown(unknown) {
    return new Promise(function (resolve) {
      var rows = unknown.map(function (u, i) {
        return '<tr><td class="mono"><b>' + esc(u.unit || '(bo\'sh)') + '</b></td><td>' + esc(Array.from(u.drivers).join(', ')) +
          '</td><td class="mono">' + u.count + '</td><td><select class="ad-unk" data-i="' + i + '" style="padding:6px 8px;border-radius:6px;border:1px solid var(--line);background:var(--paper);color:var(--text);">' +
          '<option value="">— tanlang —</option><option value="one">One Ummah (oxirida, 4866 dan keyin)</option>' +
          '<option value="fm">Fastmover/ECA (oxirida)</option><option value="skip">Import qilinmasin</option></select></td></tr>';
      }).join('');
      var m = modal('<h2 style="' + H2 + '">A to\'xtash · Noma\'lum Unit#</h2><p style="' + SUB + '">Quyidagi mashinalar tartib ro\'yxatida yo\'q. O\'zim joy tanlamayman. Qayerga qo\'yishni tanlang (tanlov eslab qolinadi).</p>' +
        '<div style="overflow-x:auto"><table class="loads-table" style="min-width:0"><thead><tr><th>Unit#</th><th>Haydovchi</th><th>Yuklar</th><th>Joyi</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="btn" type="button" id="adUnkCancel">Bekor qilish</button><button class="btn btn-primary" type="button" id="adUnkOk" disabled>Davom etish</button></div>', 720);
      var sels = m.box.querySelectorAll('.ad-unk'), ok = m.box.querySelector('#adUnkOk');
      var check = function () { ok.disabled = !Array.prototype.every.call(sels, function (s) { return s.value; }); };
      sels.forEach(function (s) { s.addEventListener('change', check); });
      m.box.querySelector('#adUnkCancel').onclick = function () { m.close(); resolve(null); };
      ok.onclick = function () {
        var out = {};
        sels.forEach(function (s) { out[unknown[+s.dataset.i].unit] = s.value; });
        m.close(); resolve(out);
      };
    });
  }

  // B to'xtash nuqtasi: XATOLAR / SHUBHALI / TOZA
  function stageReview(info) {
    return new Promise(function (resolve) {
      var sec = function (name, color, groups) {
        if (!groups.length) return '';
        return '<div style="margin:12px 0 4px;font-weight:700;color:' + color + '">' + name + '</div>' + groups.map(function (g) {
          var shown = g.items.slice(0, 12).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
          var more = g.items.length > 12 ? '<li style="color:var(--steel)">… yana ' + (g.items.length - 12) + ' ta</li>' : '';
          return '<div style="margin:6px 0 2px;font-weight:600">' + esc(g.title) + ' (' + g.items.length + ')</div><ul style="margin:0 0 6px 18px;padding:0;line-height:1.55;font-size:12.5px">' + shown + more + '</ul>';
        }).join('');
      };
      var cleanHtml = info.res.clean.length ? '<div style="margin:12px 0 4px;font-weight:700;color:var(--route-green)">TOZA</div><ul style="margin:0 0 6px 18px;padding:0;line-height:1.55;font-size:12.5px">' +
        info.res.clean.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '';
      var blocked = info.res.errors.length > 0;
      var skippedHtml = info.skipped.length ? '<p style="' + SUB + '">O\'tkazib yuborilgan: ' + info.skipped.length + ' ta yuk (' + esc(info.skipped.map(function (s) { return '#' + s.tripId + ' ' + s.reason; }).join(', ')) + ')</p>' : '';
      var m = modal('<h2 style="' + H2 + '">B to\'xtash · Tekshiruv natijasi</h2><p style="' + SUB + '">' + esc(info.week.title) + ' · ' + info.count + ' yuk · ' + info.units + ' mashina · jami ' + money(info.res.total) + '</p>' + skippedHtml +
        sec('XATOLAR', 'var(--alert)', info.res.errors) + sec('SHUBHALI', '#9c6a17', info.res.suspects) + cleanHtml +
        '<p style="margin:14px 0 0;font-weight:600">' + (blocked ? 'Avval tuzatish kerak' : 'Hisobotga o\'tish mumkin') + '</p>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" type="button" id="adRevCancel">Bekor qilish</button><button class="btn btn-primary" type="button" id="adRevOk"' + (blocked ? ' disabled' : '') + '>Tasdiqlayman va import qilish</button></div>', 820);
      m.box.querySelector('#adRevCancel').onclick = function () { m.close(); resolve(false); };
      m.box.querySelector('#adRevOk').onclick = function () { m.close(); resolve(true); };
    });
  }

  // C to'xtash nuqtasi: yakuniy tasdiq
  function stageFinal(info) {
    return new Promise(function (resolve) {
      var warn = '';
      if (info.lateCount) warn += '<li>' + info.lateCount + ' ta yukning delivery sanasi hafta oxiridan keyin (qo\'lda tekshirasiz)</li>';
      if (info.unlisted.length) warn += '<li>Ro\'yxatda yo\'q Unit#: ' + esc(info.unlisted.join(', ')) + ' (hisobot oxirida)</li>';
      if (info.noName) warn += '<li>' + info.noName + ' ta mashinada haydovchi ismi yo\'q</li>';
      var m = modal('<h2 style="' + H2 + '">C to\'xtash · Yakuniy tasdiq</h2><p style="' + SUB + '">' + esc(info.week.title) + '</p>' +
        '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:10px"><div><b class="mono">' + info.blocks + '</b><div style="color:var(--steel);font-size:11.5px">mashina</div></div><div><b class="mono">' + info.loads + '</b><div style="color:var(--steel);font-size:11.5px">yuk</div></div><div><b class="mono">' + money(info.total) + '</b><div style="color:var(--steel);font-size:11.5px">jami Base Pay</div></div></div>' +
        (warn ? '<ul style="margin:0 0 6px 18px;padding:0;line-height:1.6;font-size:12.5px">' + warn + '</ul>' : '') +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" type="button" id="adFinCancel">Bekor qilish</button><button class="btn btn-primary" type="button" id="adFinOk">Tasdiqlayman, yuklab olish</button></div>', 560);
      m.box.querySelector('#adFinCancel').onclick = function () { m.close(); resolve(false); };
      m.box.querySelector('#adFinOk').onclick = function () { m.close(); resolve(true); };
    });
  }

  /* ------------------------- Bazadan o'qish ------------------------- */
  async function fetchAll(table, cols) {
    var out = [], from = 0, step = 1000;
    for (;;) {
      var r = await sb.from(table).select(cols || '*').range(from, from + step - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data || []);
      if (!r.data || r.data.length < step) break;
      from += step;
    }
    return out;
  }

  /* ------------------------- Import jarayoni (1-2 bosqich) ------------------------- */
  var origImport = G.importStatementIntoPayroll;

  async function importWithReview(statementId) {
    var msgEl = document.getElementById('importResultMsg');
    if (msgEl) msgEl.className = 'settings-msg';
    try {
      var rs = await sb.from('statements').select('*').eq('id', statementId).single();
      if (rs.error) throw rs.error;
      var columns = rs.data.columns || [], rows = rs.data.rows || [];

      // Boshqa formatlar (driver payroll statement va h.k.) eski yo'l bilan ishlaydi
      if (typeof tryParsePayrollStatement === 'function' && tryParsePayrollStatement(columns, rows)) return origImport(statementId);
      var parsed = parseTrips(columns, rows);
      if (!parsed) return origImport(statementId);
      var loads = parsed.loads;
      if (!loads.length) throw new Error('Faylda import qilinadigan yuk topilmadi.');

      // A to'xtash nuqtasi: noma'lum Unit#
      var unk = {};
      loads.forEach(function (l) {
        if (!UNIT_ORDER.has(l.unit)) {
          var o = unk[l.unit] || (unk[l.unit] = { unit: l.unit, drivers: new Set(), count: 0 });
          o.drivers.add(l.driverName); o.count++;
        }
      });
      var unknown = Object.keys(unk).map(function (k) { return unk[k]; });
      if (unknown.length) {
        var choice = await stageUnknown(unknown);
        if (!choice) { if (msgEl) { msgEl.textContent = 'Import bekor qilindi (noma\'lum Unit# hal qilinmadi).'; msgEl.classList.add('show', 'err'); } return; }
        Object.keys(choice).forEach(function (u) { if (choice[u] === 'one' || choice[u] === 'fm') registerUnit(u, choice[u], true); });
        loads = loads.filter(function (l) { return choice[l.unit] !== 'skip'; });
      }

      // Hafta: eng ko'p yuk pick up qilingan hafta
      var cnt = {};
      loads.forEach(function (l) { if (l.pickup) { var k = dKey(mondayOf(l.pickup)); cnt[k] = (cnt[k] || 0) + 1; } });
      var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
      var monday = top ? parseDate(top) : mondayOf(new Date());
      var week = weekInfo(monday);

      // Bazadagi mavjud ma'lumot (qayta import va Unit# o'zgarishi uchun)
      var dbLoads = await fetchAll('loads', 'load_number,pickup_date');
      var existing = new Set(dbLoads.map(function (x) { return String(x.load_number || '').trim() + '|' + dKey(parseDate(x.pickup_date)); }));
      var dbDrivers = await fetchAll('drivers', 'id,name,unit_number');
      var dbUnit = new Map(dbDrivers.map(function (d) { return [String(d.name || '').trim().toLowerCase(), d.unit_number]; }));

      var res = runChecks(loads, { weekStart: week.start, weekEnd: week.end, existing: existing, dbUnitByName: dbUnit });
      var unitsSet = new Set(loads.map(function (l) { return l.unit; }));
      // B to'xtash nuqtasi
      var go = await stageReview({ week: week, res: res, count: loads.length, units: unitsSet.size, skipped: parsed.skipped });
      if (!go) { if (msgEl) { msgEl.textContent = 'Import bekor qilindi.'; msgEl.classList.add('show', 'err'); } return; }

      // Import: bazada bor yuklar o'tkazib yuboriladi
      var toImport = loads.filter(function (l) { return !existing.has(l.load_number + '|' + dKey(l.pickup)); });
      var ud = await sb.auth.getUser(), user = ud.data && ud.data.user;
      if (!user) throw new Error('Foydalanuvchi topilmadi');
      var pool = (await sb.from('drivers').select('*')).data || [];
      var drvIds = new Set(), payloads = [];
      for (var i = 0; i < toImport.length; i++) {
        var l = toImport[i];
        var drv = await findOrCreateDriverByName(l.driverName, l.unit, pool, selectedCompanyId, user.id, payrollActiveType);
        if (drv && !drv.unit_number && l.unit) { await sb.from('drivers').update({ unit_number: l.unit }).eq('id', drv.id); drv.unit_number = l.unit; }
        drvIds.add(drv.id);
        payloads.push({
          user_id: user.id, driver_id: drv.id, pickup_date: dShort(l.pickup), delivery_date: dShort(l.delivery),
          broker: l.broker || null, load_number: l.load_number || null, from_location: l.from_location || null,
          to_location: l.to_location || null, base_pay: l.base_pay || 0, dhd: l.dhd || 0, mileage: l.mileage || 0
        });
      }
      var saved = 0, lastErr = null;
      for (var j = 0; j < payloads.length; j += 50) {
        var chunk = payloads.slice(j, j + 50);
        var ins = await sb.from('loads').insert(chunk);
        if (!ins.error) { saved += chunk.length; continue; }
        for (var k = 0; k < chunk.length; k++) {
          var one = await sb.from('loads').insert(chunk[k]);
          if (!one.error) saved++; else lastErr = one.error;
        }
      }
      if (msgEl) {
        if (saved > 0) {
          msgEl.textContent = 'Import tugadi: ' + drvIds.size + ' haydovchi, ' + saved + ' yuk qo\'shildi' + (toImport.length < loads.length ? ' (' + (loads.length - toImport.length) + ' ta bazada bor edi, o\'tkazib yuborildi)' : '') + '. ' + week.title;
          msgEl.classList.add('show', 'ok');
        } else {
          msgEl.textContent = 'Yuklar saqlanmadi. ' + (lastErr ? (lastErr.message || JSON.stringify(lastErr)) : '');
          msgEl.classList.add('show', 'err');
        }
      }
      if (typeof logActivity === 'function') logActivity('statement_import', 'statement', rs.data.file_name + ' — ' + saved + ' yuk');
      // All Drivers'da shu haftani ko'rsatamiz
      adOffset = Math.round((monday - mondayOf(new Date())) / (7 * 86400000));
      try { localStorage.setItem('ustoz_ad_week_offset', adOffset); } catch (e) { }
      await refreshWeekly();
      if (typeof refreshLedger === 'function') refreshLedger();
    } catch (err) {
      if (msgEl) { msgEl.textContent = 'Import qilishda xatolik: ' + (err.message || err); msgEl.classList.add('show', 'err'); }
    }
  }

  /* ------------------------- Haftalik ko'rinish (All Drivers) ------------------------- */
  var adOffset = 0;
  try {
    var so = localStorage.getItem('ustoz_ad_week_offset');
    adOffset = so !== null ? (parseInt(so, 10) || 0) : (typeof weekOffset !== 'undefined' ? weekOffset : 0);
  } catch (e) { }

  // Bloklar: tartib bo'yicha, har Unit# uchun haydovchi (yuki bo'lsa), yoki bo'sh blok
  function buildBlocks(drivers, weekLoads) {
    var loadsBy = new Map();
    weekLoads.forEach(function (l) { (loadsBy.get(l.driver_id) || loadsBy.set(l.driver_id, []).get(l.driver_id)).push(l); });
    var drvBy = new Map();
    drivers.forEach(function (d) {
      var u = normU(d.unit_number); if (!u) return;
      (drvBy.get(u) || drvBy.set(u, []).get(u)).push(d);
    });
    var blocks = [];
    var units = ONE_UMMAH_UNITS.concat(FASTMOVER_ECA_UNITS);
    units.forEach(function (u) {
      var ds = drvBy.get(u) || [];
      var active = ds.filter(function (d) { return (loadsBy.get(d.id) || []).length; });
      if (active.length) active.forEach(function (d) { blocks.push({ unit: u, driver: d, loads: loadsBy.get(d.id) }); });
      else if (ds.length) blocks.push({ unit: u, driver: ds[ds.length - 1], loads: [] });
      else blocks.push({ unit: u, driver: null, loads: [] });
    });
    // Ro'yxatda yo'q Unit#lar (faqat yuki bo'lsa) — oxirida
    drivers.forEach(function (d) {
      var ls = loadsBy.get(d.id) || [];
      if (ls.length && !UNIT_ORDER.has(normU(d.unit_number))) blocks.push({ unit: normU(d.unit_number) || '?', driver: d, loads: ls, unlisted: true });
    });
    return blocks;
  }
  function sortLoads(ls) {
    return ls.slice().sort(function (a, b) {
      var da = parseDate(a.pickup_date), db = parseDate(b.pickup_date);
      var x = da ? da.getTime() : 0, y = db ? db.getTime() : 0;
      if (x !== y) return x - y;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  }
  async function weeklyData() {
    var res = await Promise.all([
      sb.from('drivers').select('*').order('created_at', { ascending: true }),
      fetchAll('loads'), sb.from('companies').select('id,name')
    ]);
    if (res[0].error) throw res[0].error;
    var drivers = (res[0].data || []).filter(function (d) { return (d.worker_type || 'driver') === 'driver'; });
    var wk = weekByOffset(adOffset);
    var weekLoads = res[1].filter(function (l) {
      var d = parseDate(l.pickup_date); return d && d >= wk.start && d <= wk.end;
    });
    weekLoads = sortLoads(weekLoads);
    // Bitta haydovchining yuklari ketma-ketligi (tartibi buzilmasin)
    return { drivers: drivers, weekLoads: weekLoads, week: wk, blocks: buildBlocks(drivers, weekLoads) };
  }

  async function refreshWeekly() {
    var lbl = document.getElementById('adWeekLabel');
    if (lbl) lbl.textContent = weekByOffset(adOffset).title;
    try {
      var data = await weeklyData();
      driversContainer.innerHTML = '';
      var keys = [];
      payrollEmpty.style.display = 'none';
      data.blocks.forEach(function (b) {
        var info = unitOrderInfo(b.unit);
        var drv = b.driver ? Object.assign({}, b.driver, { _companyName: info ? info.label : '' }) :
          { id: null, name: '', unit_number: b.unit, _placeholder: true, _companyName: info ? info.label : '' };
        var card = renderDriverCard(drv, b.loads);
        var key = [drv.name, drv.unit_number, 'unit#' + drv.unit_number, drv._companyName].concat(
          b.loads.reduce(function (a, l) {
            return a.concat([l.load_number, l.broker, l.from_location, l.to_location, fmtDotDate(l.pickup_date), fmtDotDate(l.delivery_date)]);
          }, [])).filter(function (v) { return v !== null && v !== undefined && v !== ''; }).join(' ').toLowerCase();
        card.dataset.search = key; keys.push(key);
        driversContainer.appendChild(card);
      });
      applyDriverSearch();
    } catch (err) {
      console.error('All Drivers yuklashda xatolik:', err);
    }
  }

  /* ------------------------- 3) HISOBOT: Excel (rasmdagi uslub) ------------------------- */
  function loadExcelJS() {
    if (G.ExcelJS) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = resolve; s.onerror = function () { reject(new Error('ExcelJS yuklanmadi')); };
      document.head.appendChild(s);
    });
  }

  function buildWorkbook(blocks, title) {
    var wb = new G.ExcelJS.Workbook();
    var ws = wb.addWorksheet('All Drivers');
    var widths = [6, 13, 13, 40, 14, 26, 26, 26, 12, 13, 16, 12];
    widths.forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    var thin = { style: 'thin', color: { argb: 'FF000000' } };
    var BOX = { top: thin, left: thin, bottom: thin, right: thin };
    var fill = function (argb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } }; };
    var font = function (sz, b) { return { name: 'Arial', size: sz, bold: !!b, color: { argb: 'FF000000' } }; };
    var CEN = { horizontal: 'center', vertical: 'middle' }, LEFT = { horizontal: 'left', vertical: 'middle' }, RIGHT = { horizontal: 'right', vertical: 'middle' };
    var cols = ['№', 'Pick up date', 'Delivery date', 'Broker', 'LOAD ID#', 'From', 'To', 'Base Pay', 'DHD', 'Mileage', 'Total Mileage', 'RPM'];
    var utc = function (d) { return d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null; };

    ws.mergeCells('A1:L1');
    var t = ws.getCell('A1'); t.value = title; t.font = font(18, true); t.alignment = CEN;
    for (var c = 1; c <= 12; c++) ws.getCell(1, c).fill = fill('FF00B0F0');
    ws.getRow(1).height = 36; ws.getRow(2).height = 18;

    var r = 3, totalLoads = 0, totalPay = 0;
    blocks.forEach(function (b) {
      var name = b.driver ? String(b.driver.name || '').trim().toUpperCase() : '';
      var ls = b.loads || [];
      // blok sarlavhasi
      ws.getRow(r).height = 24;
      for (var c = 1; c <= 12; c++) {
        var cell = ws.getCell(r, c); cell.border = BOX; cell.font = font(14, true); cell.alignment = CEN;
        if (c <= 6) cell.fill = fill('FFBFBFBF'); else if (c >= 8) cell.fill = fill('FF92D050');
      }
      var nc = ws.getCell(r, 8); nc.value = name || null; nc.font = font(12, true);
      ws.getCell(r, 12).value = 'Unit#' + b.unit;
      r++;
      // ustun nomlari
      ws.getRow(r).height = 18;
      cols.forEach(function (h, i) {
        var cell = ws.getCell(r, i + 1); cell.value = h; cell.font = font(11, true); cell.fill = fill('FF33CCCC'); cell.border = BOX; cell.alignment = CEN;
      });
      r++;
      var first = r, sPay = 0, sDhd = 0, sMi = 0;
      ls.forEach(function (l, k) {
        var pay = Number(l.base_pay || 0), dhd = Number(l.dhd || 0), mi = Number(l.mileage || 0);
        sPay += pay; sDhd += dhd; sMi += mi; totalPay += pay; totalLoads++;
        var vals = [k + 1, utc(parseDate(l.pickup_date)), utc(parseDate(l.delivery_date)), l.broker || '', l.load_number || '', l.from_location || '', l.to_location || '', pay, dhd, mi,
          { formula: 'I' + r + '+J' + r, result: dhd + mi }, { formula: 'IF(K' + r + '=0,0,H' + r + '/K' + r + ')', result: (dhd + mi) ? pay / (dhd + mi) : 0 }];
        vals.forEach(function (v, i) {
          var cell = ws.getCell(r, i + 1); cell.value = v; cell.font = font(10); cell.border = BOX;
          cell.alignment = i <= 4 ? CEN : (i === 5 || i === 6 ? LEFT : RIGHT);
        });
        ws.getCell(r, 2).numFmt = 'mm.dd.yyyy'; ws.getCell(r, 3).numFmt = 'mm.dd.yyyy';
        ws.getCell(r, 8).numFmt = '$#,##0.00';
        [9, 10, 11].forEach(function (i) { ws.getCell(r, i).numFmt = '#,##0.00'; });
        ws.getCell(r, 12).numFmt = '$#,##0.00';
        r++;
      });
      // Total qatori
      ws.mergeCells(r, 1, r, 7);
      ws.getCell(r, 1).value = 'Total';
      var has = ls.length > 0, last = r - 1;
      var totMi = sDhd + sMi;
      [[8, 'H', sPay], [9, 'I', sDhd], [10, 'J', sMi], [11, 'K', totMi]].forEach(function (x) {
        ws.getCell(r, x[0]).value = has ? { formula: 'SUM(' + x[1] + first + ':' + x[1] + last + ')', result: x[2] } : 0;
      });
      ws.getCell(r, 12).value = { formula: 'IF(K' + r + '=0,0,H' + r + '/K' + r + ')', result: totMi ? sPay / totMi : 0 };
      ws.getRow(r).height = 20;
      for (var cc = 1; cc <= 12; cc++) {
        var tc = ws.getCell(r, cc); tc.font = font(12, true); tc.border = BOX; tc.alignment = cc === 1 ? CEN : RIGHT;
      }
      ws.getCell(r, 8).numFmt = '$#,##0.00';
      [9, 10, 11].forEach(function (i) { ws.getCell(r, i).numFmt = '#,##0.00'; });
      ws.getCell(r, 12).numFmt = '$#,##0.00';
      r++;
    });
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    return { wb: wb, loads: totalLoads, total: totalPay };
  }

  async function exportExcel() {
    var btn = document.getElementById('adExportBtn');
    var label = btn ? btn.textContent : '';
    try {
      if (btn) { btn.disabled = true; btn.textContent = 'Tayyorlanmoqda...'; }
      var data = await weeklyData();
      var title = data.week.title;
      var total = data.weekLoads.reduce(function (s, l) { return s + Number(l.base_pay || 0); }, 0);
      var info = {
        week: data.week, blocks: data.blocks.length, loads: data.weekLoads.length, total: total,
        lateCount: data.weekLoads.filter(function (l) { var d = parseDate(l.delivery_date); return d && d > data.week.end; }).length,
        unlisted: data.blocks.filter(function (b) { return b.unlisted; }).map(function (b) { return 'Unit#' + b.unit; }),
        noName: data.blocks.filter(function (b) { return !b.driver; }).length
      };
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (!(await stageFinal(info))) return;   // C to'xtash nuqtasi
      if (btn) { btn.disabled = true; btn.textContent = 'Tayyorlanmoqda...'; }
      await loadExcelJS();
      var built = buildWorkbook(data.blocks, title);
      var buf = await built.wb.xlsx.writeBuffer();
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Week' + data.week.num + '_All_Drivers.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      if (typeof logActivity === 'function') logActivity('all_drivers_export', 'report', title + ' — ' + built.loads + ' yuk, ' + money(built.total));
    } catch (err) {
      alert('Hisobotni tayyorlashda xatolik: ' + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  /* ------------------------- Boshqaruv paneli (UI) ------------------------- */
  function injectWeekBar() {
    var panel = document.getElementById('panel-all-drivers');
    if (!panel || document.getElementById('adWeekBar')) return;
    var bar = document.createElement('div');
    bar.id = 'adWeekBar'; bar.className = 'card';
    bar.style.cssText = 'margin-bottom:18px;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    bar.innerHTML = '<button class="btn" id="adWeekPrev" type="button" title="Oldingi hafta">‹</button>' +
      '<div id="adWeekLabel" class="mono" style="font-weight:600;min-width:270px;text-align:center;"></div>' +
      '<button class="btn" id="adWeekNext" type="button" title="Keyingi hafta">›</button>' +
      '<span style="flex:1"></span><button class="btn btn-primary" id="adExportBtn" type="button">Excel yuklab olish</button>';
    panel.insertBefore(bar, panel.firstChild);
    var move = function (d) {
      adOffset += d;
      try { localStorage.setItem('ustoz_ad_week_offset', adOffset); } catch (e) { }
      refreshWeekly();
    };
    bar.querySelector('#adWeekPrev').onclick = function () { move(-1); };
    bar.querySelector('#adWeekNext').onclick = function () { move(1); };
    bar.querySelector('#adExportBtn').onclick = exportExcel;
    bar.querySelector('#adWeekLabel').textContent = weekByOffset(adOffset).title;
  }

  function install() {
    loadExtraUnits();
    injectWeekBar();
    if (typeof origImport === 'function') G.importStatementIntoPayroll = importWithReview;
    G.refreshPayroll = refreshWeekly;
    // Sahifa allaqachon ochiq bo'lsa (sessiya avto-tiklangan) darhol yangilaymiz
    var root = document.getElementById('appRoot');
    if (root && root.style.display === 'grid') refreshWeekly();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseTrips: parseTrips, runChecks: runChecks, buildBlocks: buildBlocks, buildWorkbook: buildWorkbook, weekInfo: weekInfo, weekByOffset: weekByOffset, parseDate: parseDate, mondayOf: mondayOf, _stageUnknown: stageUnknown, _stageReview: stageReview, _stageFinal: stageFinal, registerUnit: registerUnit };
    return;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
