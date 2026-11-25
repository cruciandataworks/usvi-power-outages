/* USVI Power Outages - reads dashboard/data/summary.json written by pipeline/step5_export.py */
(async function () {
  const C = { ink: '#0E2A3B', coral: '#C8553D', coralL: '#E8836B', sea: '#2F7F86', seaL: '#8CC2C4', sand: '#D9CBB0', line: '#EFE9DE', muted: '#6B7C89', faint: '#9AA7B1' };
  const TZ = 'America/St_Thomas';
  const DIST = { STTJ: 'St. Thomas–St. John', STX: 'St. Croix' };
  const LEVEL = { normal: 'Normal', large: 'Large outage', major: 'Major outage', 'district-wide': 'District-wide' };

  const S = await fetch('data/summary.json').then((r) => r.json()).catch(() => null);
  if (!S) { document.getElementById('updated').textContent = 'Data file is missing - run the pipeline first.'; return; }

  const nf = (v, d = 0) => v == null ? '–' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const big = (v) => v >= 1e6 ? `${nf(v / 1e6, 1)}M` : v >= 1e4 ? `${nf(v / 1e3, 0)}k` : nf(v);
  // timestamps in the JSON are already AST wall-clock times ("2026-11-07T08:59")
  const ast = (s) => { const [d, t] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); return { y, m, d: dd, t: t || '' }; };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = (s, year = false) => { const a = ast(s); const [h, mi] = a.t.split(':').map(Number);
    const hh = `${(h % 12) || 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    return `${MON[a.m - 1]} ${a.d}${year ? `, ${a.y}` : ''}${a.t ? `, ${hh}` : ''}`; };
  const day = (s) => { const a = ast(s); return `${MON[a.m - 1]} ${a.d}`; };
  const dur = (h) => h == null ? '–' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${nf(h, h < 10 ? 1 : 0)} h` : `${nf(h / 24, 1)} days`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tot = Object.fromEntries(S.totals.map((t) => [t.district, t]));
  const cur = Object.fromEntries(S.current.map((c) => [c.district, c]));
  const m = S.meta;

  document.getElementById('updated').textContent = `Latest check of WAPA's map ${when(m.latest_poll_ast, true)} AST · polled every 5 minutes, refreshed every 15`;
  document.getElementById('built').textContent = `${nf(m.polls)} map snapshots and ${nf(m.records)} outages, ${when(m.archive_start_ast, true)} to ${when(m.latest_poll_ast, true)} AST.`;

  /* ---------- Alerts ---------- */
  const alertCard = (a) => `<div class="alert ${a.severity}"><span class="sev">${a.severity === 'high' ? 'Alert' : a.severity === 'medium' ? 'Watch' : 'Notice'}</span>
    <div><b>${esc(a.title)}</b><p>${esc(a.message)}</p></div></div>`;
  document.getElementById('alerts').innerHTML = S.alerts.length ? S.alerts.map(alertCard).join('')
    : `<div class="alert"><span class="sev">All clear</span><div><b>No major outage and the collector is healthy</b><p>Fewer than 25% of customers are out in each district, WAPA's map is updating and the latest polls succeeded.</p></div></div>`;

  /* ---------- Right now ---------- */
  const any = S.current[0] || {};
  const distKpi = (k) => { const c = cur[k]; if (!c) return ['', '–', ''];
    return [`${DIST[k]} now`, `${nf(c.customers_out)}<small>out</small><span class="lvl ${c.is_stale ? 'stale' : c.level.replace('-', '')}">${c.is_stale ? 'Map stale' : LEVEL[c.level] || c.level}</span>`,
      `${nf(c.pct_of_reference, 1)}% of ${nf(c.reference_customers)} customers`, Math.min(100, c.pct_of_reference), c.pct_of_reference >= 25]; };
  const lagMin = any.feed_lag_min;
  const k = [distKpi('STTJ'), distKpi('STX'),
    ['Territory', `${nf(any.out_territory)}<small>out</small>`, `WAPA's own total · ${nf(any.records_on_map)} outages listed · WAPA serves ${nf(any.customers_served)} customers`],
    ['WAPA\'s map', lagMin == null ? '–' : `${nf(lagMin, lagMin < 10 ? 1 : 0)}<small>min old</small>`,
      `${any.is_stale ? 'Not updating - WAPA\'s map may be down' : 'Updating normally'} · ${nf(m.live_polls)} polls by this pipeline since ${day(m.live_start_ast)}`]];
  document.getElementById('kpis').innerHTML = k.map(([l, v, note, bar, hot]) =>
    `<div class="kpi"><p class="l">${l}</p><p class="v">${v}</p>${bar != null ? `<div class="bar2"><i class="${hot ? 'hot' : ''}" style="width:${Math.max(1, bar).toFixed(0)}%"></i></div>` : ''}<p class="note">${note}</p></div>`).join('');

  /* ---------- Headline finding ---------- */
  const a = tot.STTJ, b = tot.STX, days = Math.round(a.covered_hours / 24);
  document.getElementById('finding').innerHTML = `Over ${days} days of WAPA's map, the average St. Thomas–St. John customer was without power for <em>${nf(a.hours_per_customer)} hours</em>, more than six times St. Croix's ${nf(b.hours_per_customer)}.`;
  document.getElementById('howFinding').textContent = `St. Thomas–St. John lost ${big(a.customer_hours)} customer-hours of power against St. Croix's ${big(b.customer_hours)}, and its longest major outage lasted ${dur(a.longest_major_hours)}.`;
  document.getElementById('facts').innerHTML = [
    [`${a.districtwide_events} vs ${b.districtwide_events}`, 'District-wide outages (80%+ of customers out), St. Thomas–St. John vs St. Croix'],
    [`${a.major_events} vs ${b.major_events}`, 'Major outages (25%+ out)'],
    [dur(a.longest_major_hours), 'Longest major outage, St. Thomas–St. John, from Oct 21'],
    [`${a.days_over_80pct} vs ${b.days_over_80pct}`, 'Days on which 80%+ of a district lost power at once'],
  ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');

  /* ---------- Charts ---------- */
  Chart.defaults.font.family = "'Satoshi', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.animation.duration = 300;
  Chart.defaults.color = C.muted;
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.tooltip.backgroundColor = C.ink;
  Chart.defaults.plugins.tooltip.padding = 10;
  const grid = { color: C.line, drawTicks: false };
  const charts = {};
  const make = (id, cfg) => { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); };
  const refLines = {
    id: 'refLines',
    afterDatasetsDraw(chart, _a, o) {
      const { ctx, chartArea: ar, scales: { y } } = chart;
      ctx.save();
      (o.lines || []).forEach((l) => {
        const py = y.getPixelForValue(l.y); if (py < ar.top || py > ar.bottom) return;
        ctx.strokeStyle = l.color; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(ar.left, py); ctx.lineTo(ar.right, py); ctx.stroke();
        ctx.setLineDash([]); ctx.font = "500 11px 'Satoshi', sans-serif";
        const w = ctx.measureText(l.label).width, lx = ar.left + 6;
        ctx.fillStyle = 'rgba(255,253,248,.92)'; ctx.fillRect(lx - 3, py - 16, w + 6, 13);
        ctx.fillStyle = l.color; ctx.fillText(l.label, lx, py - 6);
      });
      ctx.restore();
    },
  };
  Chart.register(refLines);

  // every calendar day from the first capture to the newest, so gaps show as gaps
  const allDays = [];
  for (let d = new Date(S.daily[0].d + 'T12:00:00Z'), end = new Date(S.daily[S.daily.length - 1].d + 'T12:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) allDays.push(d.toISOString().slice(0, 10));
  let dailyKey = 'STTJ';
  function renderDaily() {
    const ref = tot[dailyKey].reference_customers;
    const by = Object.fromEntries(S.daily.filter((r) => r.district === dailyKey).map((r) => [r.d, r]));
    const vals = allDays.map((d) => by[d] ? +(100 * by[d].mx / ref).toFixed(1) : null);
    make('cDaily', {
      type: 'bar',
      data: { labels: allDays, datasets: [{ data: vals, borderRadius: 1, barPercentage: 1, categoryPercentage: .9,
        backgroundColor: vals.map((v) => v >= 80 ? C.coral : v >= 25 ? C.coralL : C.sea) }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          refLines: { lines: [{ y: 80, color: C.coral, label: 'District-wide 80%' }, { y: 25, color: '#9A3A26', label: 'Major 25%' }] },
          tooltip: { callbacks: { title: (i) => { const r = by[allDays[i[0].dataIndex]]; return `${day(allDays[i[0].dataIndex])}${r && r.cov < 23 ? ` (${nf(r.cov, 1)} h captured)` : ''}`; },
            label: (i) => { const r = by[allDays[i.dataIndex]]; return r ? [`Peak ${nf(r.mx)} out (${nf(i.raw, 0)}%)`, `${nf(r.ch)} customer-hours`] : 'No data'; } } } },
        scales: { y: { min: 0, max: 100, grid, border: { display: false }, ticks: { callback: (v) => `${v}%`, stepSize: 25 } },
          x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, callback: (_v, i) => allDays[i].endsWith('-01') ? MON[+allDays[i].slice(5, 7) - 1] : '' } } } },
    });
    const t = tot[dailyKey];
    document.getElementById('dailyNote').textContent = `${DIST[dailyKey]}: ${t.days_over_25pct} days with a major outage and ${t.days_over_80pct} with a district-wide one. Blank stretches are days with no capture, mostly ${day(S.gaps[0].start_ast)} to ${day(S.gaps[0].end_ast)} between VI Update's archive and this pipeline.`;
  }
  const dT = document.getElementById('dailyToggle');
  dT.addEventListener('click', (e) => { const btn = e.target.closest('button'); if (!btn) return; dailyKey = btn.dataset.k;
    dT.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.k === dailyKey)); renderDaily(); });
  renderDaily();

  // monthly hours per customer
  const months = [...new Set(S.monthly.map((r) => r.month))];
  const mby = (k) => Object.fromEntries(S.monthly.filter((r) => r.district === k).map((r) => [r.month, r]));
  const mT = mby('STTJ'), mX = mby('STX');
  const partial = (r) => r && r.share_of_month_covered < 0.9;
  make('cMonthly', {
    type: 'bar',
    data: { labels: months.map((x) => MON[+x.slice(5, 7) - 1]),
      datasets: [
        { label: DIST.STTJ, data: months.map((x) => mT[x]?.hours_per_customer ?? null), backgroundColor: months.map((x) => partial(mT[x]) ? 'rgba(14,42,59,.35)' : C.ink), borderRadius: 3 },
        { label: DIST.STX, data: months.map((x) => mX[x]?.hours_per_customer ?? null), backgroundColor: months.map((x) => partial(mX[x]) ? 'rgba(47,127,134,.35)' : C.sea), borderRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { generateLabels: (ch) => ch.data.datasets.map((ds, i) => ({ text: ds.label, fillStyle: i ? C.sea : C.ink, strokeStyle: 'transparent', datasetIndex: i, hidden: !ch.isDatasetVisible(i) })) } },
        tooltip: { callbacks: {
        label: (i) => { const r = (i.datasetIndex ? mX : mT)[months[i.dataIndex]]; return `${i.dataset.label}: ${nf(i.raw, 1)} h per customer${partial(r) ? ` (${Math.round(100 * r.share_of_month_covered)}% of month captured)` : ''}`; } } } },
      scales: { y: { grid, border: { display: false }, ticks: { callback: (v) => `${v} h` } }, x: { grid: { display: false } } } },
  });
  const oct = mT['2026-10-01'];
  document.getElementById('monthlyNote').textContent = oct ? `October was the worst month: ${nf(oct.hours_per_customer)} hours per St. Thomas–St. John customer, driven by the outage that began Oct 21 and lasted ${dur(a.longest_major_hours)}.` : '';

  // last 48 hours, WAPA's hourly series + our polls (x is minutes since the first hour)
  const toMs = (s) => Date.parse(s + ':00Z');
  const t0 = S.hourly.length ? toMs(S.hourly[0].t) : 0;
  const hourlyPts = S.hourly.map((r) => ({ x: toMs(r.t), y: r.out }));
  const pollPts = S.recent.filter((r) => toMs(r.t) >= t0).map((r) => ({ x: toMs(r.t), y: (r.stx || 0) + (r.sttj || 0) }));
  make('cRecent', {
    type: 'line',
    data: { datasets: [
      { label: 'WAPA hourly history', data: hourlyPts, borderColor: C.ink, backgroundColor: 'rgba(14,42,59,.08)', fill: true, pointRadius: 0, borderWidth: 2, stepped: 'before' },
      { label: 'This pipeline\'s polls', data: pollPts, borderColor: C.coral, backgroundColor: C.coral, showLine: false, pointRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, parsing: false,
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { title: (i) => when(new Date(i[0].raw.x).toISOString().slice(0, 16)), label: (i) => `${i.dataset.label}: ${nf(i.raw.y)} out` } } },
      scales: { y: { min: 0, grid, border: { display: false }, ticks: { callback: (v) => big(v) } },
        x: { type: 'linear', grid, border: { display: false }, ticks: { stepSize: 6 * 3600e3, maxRotation: 0,
          callback: (v) => { const s = new Date(v).toISOString(); const h = +s.slice(11, 13); return h === 0 ? day(s.slice(0, 10)) : `${(h % 12) || 12} ${h < 12 ? 'AM' : 'PM'}`; } } } } },
  });
  const pk = S.hourly.reduce((p, r) => r.out > p.out ? r : p, { out: -1 });
  document.getElementById('recentNote').textContent = pk.out >= 0 ? `Peak in the window: ${nf(pk.out)} customers out at ${when(pk.t)} AST. WAPA keeps only 48 hours of its own history; everything older on this page comes from saved snapshots.` : '';

  /* ---------- Events table ---------- */
  let evKey = 'districtwide_80pct';
  let evAll = false;
  const evMore = document.getElementById('eventMore');
  evMore.addEventListener('click', () => { evAll = !evAll; renderEvents(); });
  function renderEvents() {
    const list = S.events.filter((e) => e.class === evKey);
    evMore.textContent = evAll ? 'Show the 10 most recent' : `Show all ${list.length}`;
    document.querySelector('#tEvents tbody').innerHTML = (evAll ? list : list.slice(0, 10)).map((e) => `<tr>
      <td>${DIST[e.district]}${e.is_ongoing ? ' <span class="tag warn">Ongoing</span>' : ''}</td>
      <td>${when(e.start_ast)}${e.starts_by === 'gap' ? '<small>began during a gap in the record</small>' : ''}</td>
      <td class="n">${dur(e.wall_span_hours)}</td>
      <td class="n">${nf(e.peak_out)}<small>${nf(e.peak_pct_district)}%</small></td>
      <td class="n">${nf(e.customer_hours_wall_span)}</td></tr>`).join('');
    const per = (k) => list.filter((e) => e.district === k).length;
    document.getElementById('eventNote').textContent = `${list.length} ${evKey === 'major_25pct' ? 'major' : 'district-wide'} outages: ${per('STTJ')} on St. Thomas–St. John and ${per('STX')} on St. Croix. Every one matches VI Update's published list to the minute. A district-wide outage is also counted as a major one.`;
  }
  const eT = document.getElementById('eventToggle');
  eT.addEventListener('click', (e) => { const btn = e.target.closest('button'); if (!btn) return; evKey = btn.dataset.k;
    eT.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.k === evKey)); renderEvents(); });
  renderEvents();

  /* ---------- Areas ---------- */
  const maxA = S.areas[0].customer_hours;
  document.getElementById('areas').innerHTML = `<li class="key" style="display:flex"><span><i style="background:${C.ink}"></i>St. Thomas, St. John and Water Island</span><span><i style="background:${C.sea}"></i>St. Croix</span></li>` +
    S.areas.map((r) => `<li class="${r.island === 'Unplaced' ? 'none' : r.district === 'STTJ' ? 'sttj' : ''}"><span class="nm">${esc(r.subdivision)}${r.island !== 'Unplaced' ? `<small>${esc(r.island)}</small>` : ''}</span>
      <span class="val">${big(r.customer_hours)}</span><span class="meter"><i style="width:${(100 * r.customer_hours / maxA).toFixed(1)}%"></i></span></li>`).join('');

  /* ---------- Causes ---------- */
  const nRec = S.causes.reduce((s, c) => s + c.records, 0);
  const none = S.causes.find((c) => c.cause_code === 'none given');
  document.getElementById('causeHero').innerHTML = `<b>${Math.round(100 * none.records / nRec)}%</b><p>of the ${nf(nRec)} outages on WAPA's map never listed a cause. The rest are WAPA's own cause codes.</p>`;
  const given = S.causes.filter((c) => c.cause_code !== 'none given').slice(0, 7);
  const maxC = given[0]?.records || 1;
  document.getElementById('causes').innerHTML = given.map((c) => `<li><span class="nm">${esc(c.cause)}</span><span class="val">${nf(c.records)}</span><span class="meter"><i style="width:${(100 * c.records / maxC).toFixed(1)}%"></i></span></li>`).join('');

  /* ---------- Now on the map ---------- */
  document.querySelector('#tNow tbody').innerHTML = S.on_map.length ? S.on_map.map((r) => `<tr>
    <td>${esc(r.subdivision)}<small>${esc(r.island || DIST[r.district] || '')}</small></td>
    <td class="n">${nf(r.max_customers_out)}</td><td class="n">${dur(r.hours_on_map)}</td><td>${esc(r.cause || 'Not given')}</td></tr>`).join('')
    : '<tr><td colspan="4">No outages on the map right now.</td></tr>';

  /* ---------- Completeness ---------- */
  const ck = S.checks;
  document.getElementById('checks').innerHTML = [
    [`${nf(ck.days_matching)} of ${nf(ck.ref_days)}`, 'district-days match VI Update\'s daily table'],
    [`${nf(ck.ref_events)} of ${nf(ck.ref_events)}`, 'major and district-wide outages match'],
    [`${nf(ck.records_matching)} of ${nf(ck.ref_records)}`, 'outages placed in the same district'],
  ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const why = (g) => g.source === 'between' ? 'Between the end of VI Update\'s archive and the first poll by this pipeline'
    : g.source === 'archive' ? `${g.kind === 'STALE' ? 'WAPA\'s map stopped updating, so these snapshots are not counted. ' : ''}VI Update's note: ${esc(g.cause)}`
    : cap(esc(g.cause));
  document.querySelector('#tGaps tbody').innerHTML = S.gaps.map((g) => `<tr><td>${when(g.start_ast)}<small>to ${when(g.end_ast)}</small></td>
    <td class="n">${nf(g.hours, 1)}</td><td>${why(g)}</td></tr>`).join('');
  /* =====================================================================
     Feeder by feeder (marts.mart_feeder_* and mart_schedule_check)
     ===================================================================== */
  const F = S.feeders;
  if (F) {
    let fKey = 'STTJ';
    const fRows = () => F.scorecard.filter((r) => r.district === fKey);
    const placesBy = {};
    F.places.forEach(([d, f, pl, split]) => { (placesBy[`${d}|${f}`] = placesBy[`${d}|${f}`] || []).push({ pl, split }); });
    const card = Object.fromEntries(F.scorecard.map((r) => [`${r.district}|${r.feeder}`, r]));
    const SPLIT = { two_feeders: 'shared with another feeder', three_feeders: 'shared by three feeders', off_grid: 'not normally on the grid' };
    const hm = (s) => { const [h, mi] = s.slice(11, 16).split(':').map(Number); return `${(h % 12) || 12}${mi ? ':' + String(mi).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };

    /* ---------- intro facts ---------- */
    function renderFacts() {
      const r = fRows().filter((x) => x.outages > 0);
      const worst = [...r].sort((x, y) => y.hours_out - x.hours_out)[0];
      const ps = r.reduce((t, x) => t + x.power_supply_outages, 0);
      const psTop = [...r].sort((x, y) => y.power_supply_hours - x.power_supply_hours)[0];
      document.getElementById('feederFacts').innerHTML = [
        [`${r.length}`, `${DIST[fKey]} feeders that have gone out as a whole on WAPA's map since March`],
        [`${nf(F.share.feeder_pct_of_customers, 0)}%`, `of all customers affected by outages on the map were on a whole-feeder outage (territory-wide), though those are only ${nf(F.share.feeder_records)} of ${nf(F.share.records)} outages`],
        [worst ? `${nf(worst.hours_out)} h` : '–', worst ? `Feeder ${worst.feeder}${fKey === "STTJ" ? ` (${esc(worst.island)})` : ""}, the most hours out in ${DIST[fKey]}` : ''],
        [`${nf(ps)}`, psTop ? `power-supply (rotation) outages; the heaviest load fell on Feeder ${psTop.feeder}, ${nf(psTop.power_supply_hours)} h` : 'power-supply (rotation) outages'],
      ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    }

    /* ---------- scorecard ---------- */
    let sortK = 'hours_out', sortDir = -1;
    const open = new Set();
    function renderScore() {
      const list = [...fRows()].sort((x, y) => {
        const a = x[sortK], b = y[sortK];
        if (sortK === 'feeder') return sortDir * a.localeCompare(b, 'en', { numeric: true });
        return sortDir * ((a ?? -1) > (b ?? -1) ? 1 : (a ?? -1) < (b ?? -1) ? -1 : 0);
      });
      const maxPs = Math.max(1, ...list.map((r) => r.power_supply_hours));
      document.querySelector('#tFeeders tbody').innerHTML = list.map((r) => {
        const k = `${r.district}|${r.feeder}`, pl = placesBy[k] || [];
        const shown = open.has(k) ? pl : pl.slice(0, 4);
        const plTxt = pl.length ? shown.map((p) => esc(p.pl) + (p.split !== 'whole' ? '*' : '')).join(', ')
          + (pl.length > 4 ? ` <button type="button" data-k="${k}">${open.has(k) ? 'show fewer' : `+${pl.length - 4} more`}</button>` : '')
          : '<span class="muted">Not in WAPA\'s 2024 listing</span>';
        return `<tr><td><span class="fchip ${r.district.toLowerCase()}">${esc(r.feeder)}</span>${r.out_now ? ' <span class="tag warn now">Out now</span>' : ''}<small>${esc(r.island)}</small></td>
          <td class="pl hide-sm">${plTxt}</td>
          <td class="n">${nf(r.outages)}</td><td class="n">${nf(r.hours_out)}</td>
          <td class="n">${r.median_hours == null ? '–' : dur(r.median_hours)}</td>
          <td class="n hide-sm">${r.peak_customers == null ? '–' : nf(r.peak_customers)}</td>
          <td class="n">${nf(r.power_supply_hours)}<span class="meter-in"><i style="width:${(100 * r.power_supply_hours / maxPs).toFixed(0)}%"></i></span></td>
          <td>${r.last_outage_ast ? day(r.last_outage_ast) : '–'}</td></tr>`;
      }).join('');
      document.querySelectorAll('#tFeeders th[data-s]').forEach((th) => {
        if (th.dataset.s === sortK) th.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
      });
      const r7 = list.filter((r) => r.outages > 0);
      const zero = list.filter((r) => !r.outages).map((r) => r.feeder), unl = list.filter((r) => !r.in_listing).map((r) => r.feeder);
      const longest = [...r7].sort((x, y) => (y.median_hours || 0) - (x.median_hours || 0))[0];
      document.getElementById('feederNote').textContent = `Hours out run from WAPA's start time until the map cleared the outage, which is not always the minute power came back. "Typical" is the median length of one outage${longest ? `; Feeder ${longest.feeder} has the longest typical outage at ${dur(longest.median_hours)}` : ''}. "Customers" is the most WAPA's map showed out at once on that feeder, a rough guide to its size. * = WAPA lists the place as split between feeders.${zero.length ? ` ${zero.join(', ')} ${zero.length > 1 ? 'are' : 'is'} in WAPA's listing but never went out as a whole feeder on the map.` : ''}${unl.length ? ` ${unl.join(', ')} ${unl.length > 1 ? 'appear' : 'appears'} on the map but not in the 2024 listing.` : ''}`;
    }
    document.querySelector('#tFeeders thead').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-s]'); if (!th) return;
      if (sortK === th.dataset.s) sortDir = -sortDir; else { sortK = th.dataset.s; sortDir = th.dataset.s === 'feeder' ? 1 : -1; }
      renderScore();
    });
    document.querySelector('#tFeeders tbody').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]'); if (!b) return;
      open.has(b.dataset.k) ? open.delete(b.dataset.k) : open.add(b.dataset.k); renderScore();
    });

    /* ---------- calendar ---------- */
    const calDays = [];
    const first = F.daily.length ? F.daily[0][2] : S.daily[0].d, last = S.daily[S.daily.length - 1].d;
    for (let d = new Date(first + 'T12:00:00Z'), e = new Date(last + 'T12:00:00Z'); d <= e; d.setUTCDate(d.getUTCDate() + 1)) calDays.push(d.toISOString().slice(0, 10));
    const covered = {};
    S.daily.forEach((r) => { if (r.cov > 0) covered[`${r.district}|${r.d}`] = r.cov; });
    const PS = ['#F6D3C9', '#E8836B', '#C8553D', '#8E3524'], OT = ['#CFE3E4', '#8CC2C4', '#2F7F86', '#1D5257'];
    const bin = (h) => h < 1 ? 0 : h < 3 ? 1 : h < 8 ? 2 : 3;
    let calLayout = null;
    function gapTxt() {
      const runs = []; let st = null;
      calDays.forEach((d, i) => { const miss = !covered[`${fKey}|${d}`];
        if (miss && st == null) st = i; if ((!miss || i === calDays.length - 1) && st != null) { const en = miss ? i : i - 1; if (en > st) runs.push(`${day(calDays[st])} to ${day(calDays[en])}`); st = null; } });
      return runs.length ? ` Hatched days were not recorded: ${runs.join(' and ')}, plus any single missing days.` : '';
    }
    function renderCal() {
      const cv = document.getElementById('cCal'), wrap = cv.parentElement;
      const feeders = fRows().filter((r) => r.outages > 0).sort((x, y) => y.hours_out - x.hours_out).map((r) => r.feeder);
      const cells = {};
      F.daily.forEach(([d, f, dt, h, ps, n]) => { if (d === fKey) cells[`${f}|${dt}`] = { h, ps, n }; });
      const W = Math.max(720, wrap.clientWidth), labW = 46, top = 20, rowH = window.innerWidth < 560 ? 15 : 17;
      const H = top + feeders.length * rowH + 4, dpr = window.devicePixelRatio || 1;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.height = `${H}px`; cv.style.width = `${W}px`;
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const cw = (W - labW) / calDays.length;
      ctx.font = "500 11px 'Satoshi', sans-serif"; ctx.textBaseline = 'middle';
      let lastLab = -99; calDays.forEach((d, i) => { if ((d.endsWith('-01') || i === 0) && labW + i * cw - lastLab > 28) { lastLab = labW + i * cw; ctx.fillStyle = C.muted; ctx.fillText(MON[+d.slice(5, 7) - 1], labW + i * cw + 1, 9); ctx.fillStyle = C.line; ctx.fillRect(labW + i * cw, top - 4, 1, H - top + 4); } });
      // hatch pattern for days with no capture
      const pc = document.createElement('canvas'); pc.width = pc.height = 4; const px = pc.getContext('2d');
      px.fillStyle = '#F7F3EB'; px.fillRect(0, 0, 4, 4); px.strokeStyle = '#CFC3AE'; px.beginPath(); px.moveTo(0, 4); px.lineTo(4, 0); px.stroke();
      const hatch = ctx.createPattern(pc, 'repeat');
      feeders.forEach((f, r) => {
        const y = top + r * rowH;
        ctx.fillStyle = C.ink; ctx.font = "700 11.5px 'Satoshi', sans-serif"; ctx.fillText(f, 4, y + rowH / 2);
        calDays.forEach((d, i) => {
          const c = cells[`${f}|${d}`], x = labW + i * cw;
          ctx.fillStyle = c ? (c.ps > 0 ? PS[bin(c.h)] : OT[bin(c.h)]) : covered[`${fKey}|${d}`] ? '#F3EEE4' : hatch;
          ctx.fillRect(x + (cw > 3 ? .5 : 0), y + 1, Math.max(1, cw - (cw > 3 ? 1 : 0)), rowH - 2);
        });
      });
      calLayout = { feeders, cells, labW, top, rowH, cw };
      const psDays = new Set(F.daily.filter((x) => x[0] === fKey && x[4] > 0).map((x) => x[2]));
      const busiest = Object.entries(F.daily.filter((x) => x[0] === fKey && x[4] > 0).reduce((m, x) => { m[x[2]] = (m[x[2]] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1])[0];
      document.getElementById('calNote').textContent = `${DIST[fKey]}: ${psDays.size} days with at least one power-supply feeder outage${busiest ? `; the most feeders rotated on ${day(busiest[0])} (${busiest[1]})` : ''}. Most feeder outages list no cause, so some rotations show in teal. ${gapTxt()}`;
    }
    const tip = document.getElementById('calTip');
    document.getElementById('cCal').addEventListener('mousemove', (e) => {
      if (!calLayout) return;
      const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const { feeders, cells, labW, top, rowH, cw } = calLayout;
      const row = Math.floor((y - top) / rowH), col = Math.floor((x - labW) / cw);
      if (row < 0 || row >= feeders.length || col < 0 || col >= calDays.length) { tip.hidden = true; return; }
      const f = feeders[row], d = calDays[col], c = cells[`${f}|${d}`];
      const cov = covered[`${fKey}|${d}`];
      tip.innerHTML = `<b>Feeder ${esc(f)} · ${day(d)}</b><br>${c ? `${dur(c.h)} out${c.ps > 0 ? ` (${dur(c.ps)} power supply)` : ''}${c.n ? ` · ${c.n} outage${c.n > 1 ? 's' : ''} began` : ''}` : cov ? 'No whole-feeder outage' : 'Not recorded'}`;
      tip.hidden = false;
      const wrap = e.currentTarget.parentElement;
      tip.style.left = `${Math.min(x + 12 - wrap.scrollLeft, wrap.clientWidth - tip.offsetWidth - 4) + wrap.scrollLeft}px`; tip.style.top = `${y + 14}px`;
    });
    document.getElementById('cCal').addEventListener('mouseleave', () => { tip.hidden = true; });
    let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderCal, 150); });

    /* ---------- fairness ---------- */
    const xLine = { id: 'xLine', afterDatasetsDraw(chart, _a, o) { if (o.x == null) return; const { ctx, chartArea: ar, scales: { x } } = chart; const px = x.getPixelForValue(o.x);
      ctx.save(); ctx.strokeStyle = C.ink; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(px, ar.top); ctx.lineTo(px, ar.bottom); ctx.stroke();
      ctx.setLineDash([]); ctx.font = "500 11px 'Satoshi', sans-serif"; const t = o.label; const w = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(255,253,248,.92)'; ctx.fillRect(px + 4, ar.bottom - 17, w + 6, 14); ctx.fillStyle = C.ink; ctx.fillText(t, px + 7, ar.bottom - 6); ctx.restore(); } };
    function renderFair() {
      const list = fRows().filter((r) => r.outages > 0).sort((x, y) => y.power_supply_hours - x.power_supply_hours);
      const withPs = list.filter((r) => r.power_supply_hours > 0).map((r) => r.power_supply_hours).sort((a, b) => a - b);
      const med = withPs.length ? (withPs.length % 2 ? withPs[(withPs.length - 1) / 2] : (withPs[withPs.length / 2 - 1] + withPs[withPs.length / 2]) / 2) : null;
      document.getElementById('fairBox').style.height = `${Math.max(260, 26 * list.length + 50)}px`;
      make('cFair', {
        type: 'bar', plugins: [xLine],
        data: { labels: list.map((r) => `${r.feeder} · ${r.island}`), datasets: [{ data: list.map((r) => r.power_supply_hours), borderRadius: 3, barPercentage: .8,
          backgroundColor: list.map((r) => (r.power_supply_vs_median || 0) >= 1.5 ? C.coral : (r.power_supply_vs_median || 0) <= 0.5 ? C.seaL : C.sea) }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, xLine: { x: med, label: med == null ? '' : `Typical feeder ${nf(med)} h` },
            tooltip: { callbacks: { label: (i) => { const r = list[i.dataIndex]; return [`${nf(r.power_supply_hours, 1)} h of power-supply outages (${nf(r.power_supply_outages)} outages)`, r.power_supply_vs_median != null ? `${nf(r.power_supply_vs_median, 1)}× the typical feeder` : 'No power-supply outages']; } } } },
          scales: { x: { grid, border: { display: false }, ticks: { callback: (v) => `${v} h` } }, y: { grid: { display: false }, ticks: { color: C.ink, font: { weight: 500 } } } } },
      });
      const top = list[0], low = list.filter((r) => r.power_supply_hours > 0).slice(-1)[0];
      document.getElementById('fairNote').textContent = top && med ? `Feeder ${top.feeder} carried ${nf(top.power_supply_hours)} hours of power-supply outages, ${nf(top.power_supply_vs_median, 1)} times the typical ${DIST[fKey]} feeder${low && low !== top ? `; Feeder ${low.feeder} carried ${nf(low.power_supply_hours, 1)}` : ''}. Coral bars are 1.5 times the typical feeder or more; light teal bars are half or less. Because each customer on a feeder loses power when the feeder does, these hours are also what one customer on it went through. Only outages WAPA labeled "Power supply" count, and a rotation that cut only part of a feeder appears under a switch, not the feeder, so the true totals are higher.` : 'No power-supply outages recorded.';
    }

    /* ---------- schedule vs map ---------- */
    const OUT = { on_schedule: ['good', 'As scheduled'], ran_long: ['warn', 'Ran long'], still_out: ['warn', 'Still out'], off_time: ['plain', 'Other time'],
      not_seen: ['plain', 'Not seen'], upcoming: ['plain', 'Upcoming'], not_recorded: ['plain', 'Not recorded'], unscheduled: ['warn', 'Not on the schedule'] };
    const sched = F.schedule || [];
    const sDays = [...new Set(sched.map((r) => r.schedule_date || r.start_ast.slice(0, 10)))].sort().reverse();
    const sel = document.getElementById('schedDay');
    sel.innerHTML = sDays.map((d) => `<option value="${d}">${day(d)}${d === sDays[0] ? ' (latest)' : ''}</option>`).join('');
    sel.hidden = sDays.length < 2;
    function renderSched() {
      const d = sel.value || sDays[0];
      const rowsD = sched.filter((r) => (r.schedule_date || r.start_ast.slice(0, 10)) === d);
      const sm = F.schedule_meta || {};
      if (!rowsD.length) {
        document.getElementById('schedSum').innerHTML = '';
        document.querySelector('#tSched tbody').innerHTML = '<tr><td colspan="3">No rotation schedule saved yet. The pipeline checks WAPA\'s Alerts page every run and starts the comparison with the first schedule it finds.</td></tr>';
      } else {
        const counts = {}; rowsD.forEach((r) => { counts[r.outcome] = (counts[r.outcome] || 0) + 1; });
        document.getElementById('schedSum').innerHTML = Object.keys(OUT).filter((k) => counts[k]).map((k) => `<span class="tag ${OUT[k][0]}">${OUT[k][1]}: ${counts[k]}</span>`).join('');
        const what = (r) => {
          const t = r.outcome === 'off_time' ? ['plain', r.start_offset_min < 0 ? 'Started early' : 'Started late'] : OUT[r.outcome];
          const span = r.start_ast ? `${hm(r.start_ast)}${r.still_on_map ? ', still on the map' : ` to ${hm(r.end_ast)}`}` : '';
          const extra = r.outcome === 'ran_long' ? ` · ${nf(r.end_offset_min)} min past the window`
            : r.outcome === 'off_time' ? ` · started ${Math.abs(r.start_offset_min) >= 90 ? dur(Math.abs(r.start_offset_min) / 60) : nf(Math.abs(r.start_offset_min)) + " min"} ${r.start_offset_min < 0 ? 'before' : 'after'} the window`
            : r.outcome === 'not_seen' ? ' · no whole-feeder outage on the map' : '';
          const startDay = r.start_ast && r.start_ast.slice(0, 10) !== d ? ` (from ${day(r.start_ast)})` : '';
          return `<span class="tag ${t[0]}">${t[1]}</span> ${span}${startDay}${extra}`;
        };
        document.querySelector('#tSched tbody').innerHTML = rowsD.map((r, i) => `<tr class="${r.kind === 'unscheduled' ? 'unsched' : ''}${i && rowsD[i - 1].window_label === r.window_label ? ' cont' : ''}">
          <td>${i && rowsD[i - 1].window_label === r.window_label ? '' : r.window_label ? esc(r.window_label) : '<span class="muted">Not scheduled</span>'}</td>
          <td><span class="fchip ${r.district.toLowerCase()}">${esc(r.feeder)}</span>${r.area ? `<small>${r.partial ? 'Part: ' : ''}${esc(r.area)}</small>` : r.kind === 'unscheduled' ? `<small>${esc(r.cause || '')}</small>` : ''}</td>
          <td>${what(r)}</td></tr>`).join('');
      }
      const vers = rowsD.find((r) => r.versions_of_day)?.versions_of_day;
      document.getElementById('schedSub').textContent = rowsD.length
        ? `WAPA's St. Thomas–St. John schedule for ${day(d)}${vers > 1 ? ` (last of ${vers} versions posted)` : ''}, checked against its own outage map`
        : 'WAPA\'s published rotating-outage schedule, checked against its own outage map';
      document.getElementById('schedNote').textContent = `WAPA replaces its schedule PDF at the same address each time it changes, so this pipeline saves every version it sees${sm.first_saved_utc ? `, starting ${day(sm.first_saved_utc)}` : ''}; earlier days cannot be checked. A match is an outage of the same whole feeder overlapping the window by up to 30 minutes either side; WAPA says restoration can run 20 minutes late. "Not seen" can mean the cut was not needed or covered only part of the feeder. St. Croix rotations are announced in press releases, not a schedule file, so they are not checked here yet.`;
    }
    sel.addEventListener('change', renderSched);

    /* ---------- neighborhood lookup ---------- */
    const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`]/g, '').replace(/\best\b\.?/g, 'estate').replace(/[^a-z0-9]+/g, ' ').trim();
    const groups = {};
    F.places.forEach(([d, f, pl, split]) => { const k = `${d}|${norm(pl)}`; (groups[k] = groups[k] || { pl, d, n: norm(pl), feeders: [] }).feeders.push({ f, split }); });
    const G = Object.values(groups);
    document.getElementById('placeList').innerHTML = [...new Set(F.places.map((p) => p[2]))].sort().map((p) => `<option value="${esc(p)}">`).join('');
    const latestSched = sDays[0] ? sched.filter((r) => r.kind === 'scheduled' && r.schedule_date === sDays[0]) : [];
    function renderLook() {
      const q = norm(document.getElementById('placeInput').value);
      const out = document.getElementById('lookResult');
      if (q.length < 2) { out.innerHTML = `<p class="hint">${nf(G.length)} places on ${nf(new Set(F.places.map((p) => p[0] + p[1])).size)} feeders. Try "Frederiksted", "Tutu" or "Coral Bay".</p>`; return; }
      const hits = G.filter((g) => g.n.includes(q)).sort((a, b) => (a.n.startsWith(q) ? 0 : 1) - (b.n.startsWith(q) ? 0 : 1) || a.n.localeCompare(b.n)).slice(0, 6);
      if (!hits.length) { out.innerHTML = '<p class="hint">No match in WAPA\'s listing. Try a nearby estate or a landmark such as a school or shopping center.</p>'; return; }
      out.innerHTML = hits.map((g) => `<div class="look-hit"><div class="pl">${esc(g.pl)}<small>${g.d === 'STX' ? 'St. Croix' : esc(card[`${g.d}|${g.feeders[0].f}`]?.island || 'St. Thomas–St. John')}</small></div>
        ${g.feeders.map(({ f, split }) => { const r = card[`${g.d}|${f}`];
          const win = g.d === 'STTJ' ? latestSched.filter((s) => s.feeder === f).map((s) => s.window_label) : [];
          const stat = r && r.outages ? `${nf(r.outages)} outages and ${nf(r.hours_out)} hours out since March, ${nf(r.power_supply_hours)} h of them power supply; last out ${day(r.last_outage_ast)}${r.out_now ? ' and out now' : ''}.` : 'No whole-feeder outage on the map since March.';
          return `<div class="look-f"><span class="fchip ${g.d.toLowerCase()}">${esc(f)}</span><span>${stat}${split !== 'whole' ? ` <span class="muted">Listed as ${SPLIT[split]}.</span>` : ''}${win.length ? `<span class="sch">On WAPA's ${day(sDays[0])} schedule: ${win.map(esc).join(', ')}</span>` : ''}</span></div>`; }).join('')}</div>`).join('');
    }
    document.getElementById('placeInput').addEventListener('input', renderLook);

    /* ---------- district toggles (all feeder cards share one choice) ---------- */
    function renderFeeders() { renderFacts(); renderScore(); renderCal(); renderFair(); }
    document.querySelectorAll('.fToggle').forEach((tg) => tg.addEventListener('click', (e) => {
      const btn = e.target.closest('button'); if (!btn) return; fKey = btn.dataset.k;
      document.querySelectorAll('.fToggle button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.k === fKey)); renderFeeders();
    }));
    renderFeeders(); renderSched(); renderLook();
  }
})();
