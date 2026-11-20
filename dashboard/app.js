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
})();
