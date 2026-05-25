
// ============================================================================
// CHUNK 5 — BUSINESS HUB (per-business deep-dive · all trackers in one place)
// ============================================================================

const BH_PRACTICES = [
  {id:'beechcroft', name:'Beechcroft Dental', color:'#0E7C7B', site:'Region 1 · High Street'},
  {id:'edenford', name:'Edenford Practice', color:'#7C3AED', site:'Region 2'},
  {id:'belmont', name:'Belmont Smile Centre', color:'#EC4899', site:'Region 3'},
  {id:'westfield', name:'Westfield Dental Studio', color:'#F59E0B', site:'Region 4'},
  {id:'hartwell', name:'Hartwell Implant Clinic', color:'#3B82F6', site:'Region 5'}
];

const BH_DATA = {
  beechcroft: {
    revenueMTD:180000, revenueYTD:920000, profit:39600, margin:22,
    patientsActive:3840, patientsNew:142, retentionRate:78, ltv:2840,
    marketingSpend:14400, leads:248, cpl:58, roas:5.2, consultations:84, treatmentStarts:42,
    chairUtil:78, noShowRate:6.2, udaProgress:74, recallCompliance:88,
    treatmentMix:[{n:'Implants',v:32},{n:'Invisalign',v:24},{n:'Cosmetic',v:18},{n:'Hygiene',v:14},{n:'Routine',v:12}],
    teamSize:18, clinicians:6, hygienists:3, nurses:5, reception:3, manager:1,
    complianceScore:96, dbsExpiringSoon:0, gdcExpiringSoon:1, indemnityExpiringSoon:0,
    alerts:[
      {p:'urgent',t:'Chair 3 utilisation dropped 12% this week'},
      {p:'med',t:'Dr Smith GDC renewal due in 28 days'}
    ],
    topClinician:'Dr Patel · £42k MTD',
    keyMetricTrend:'+18% YoY'
  },
  edenford: {
    revenueMTD:140000, revenueYTD:680000, profit:25200, margin:18,
    patientsActive:2920, patientsNew:98, retentionRate:72, ltv:2240,
    marketingSpend:9800, leads:172, cpl:57, roas:4.8, consultations:62, treatmentStarts:28,
    chairUtil:68, noShowRate:8.4, udaProgress:62, recallCompliance:82,
    treatmentMix:[{n:'Routine',v:38},{n:'Hygiene',v:24},{n:'Composite',v:16},{n:'Crown/Bridge',v:12},{n:'Implants',v:10}],
    teamSize:14, clinicians:4, hygienists:2, nurses:4, reception:3, manager:1,
    complianceScore:91, dbsExpiringSoon:1, gdcExpiringSoon:0, indemnityExpiringSoon:0,
    alerts:[
      {p:'urgent',t:'No-show rate above 8% target'},
      {p:'med',t:'Hygienist booking 2.4 weeks ahead — add capacity'}
    ],
    topClinician:'Dr Chen · £28k MTD',
    keyMetricTrend:'+9% YoY'
  },
  belmont: {
    revenueMTD:120000, revenueYTD:580000, profit:33600, margin:28,
    patientsActive:2280, patientsNew:84, retentionRate:81, ltv:3120,
    marketingSpend:7200, leads:138, cpl:52, roas:5.8, consultations:56, treatmentStarts:34,
    chairUtil:82, noShowRate:5.1, udaProgress:78, recallCompliance:91,
    treatmentMix:[{n:'Cosmetic',v:34},{n:'Implants',v:26},{n:'Invisalign',v:20},{n:'Hygiene',v:12},{n:'Routine',v:8}],
    teamSize:12, clinicians:4, hygienists:2, nurses:3, reception:2, manager:1,
    complianceScore:98, dbsExpiringSoon:0, gdcExpiringSoon:0, indemnityExpiringSoon:0,
    alerts:[
      {p:'low',t:'Highest margin practice — model for others'}
    ],
    topClinician:'Dr Brooks · £38k MTD',
    keyMetricTrend:'+24% YoY'
  },
  westfield: {
    revenueMTD:95000, revenueYTD:480000, profit:20900, margin:22,
    patientsActive:2140, patientsNew:72, retentionRate:75, ltv:2480,
    marketingSpend:6800, leads:124, cpl:55, roas:4.6, consultations:48, treatmentStarts:22,
    chairUtil:71, noShowRate:7.3, udaProgress:68, recallCompliance:85,
    treatmentMix:[{n:'Routine',v:32},{n:'Hygiene',v:22},{n:'Crown/Bridge',v:18},{n:'Implants',v:16},{n:'Cosmetic',v:12}],
    teamSize:11, clinicians:3, hygienists:2, nurses:3, reception:2, manager:1,
    complianceScore:93, dbsExpiringSoon:0, gdcExpiringSoon:2, indemnityExpiringSoon:1,
    alerts:[
      {p:'urgent',t:'2 clinicians have GDC renewals within 30 days'},
      {p:'med',t:'Recall compliance below 90% target'}
    ],
    topClinician:'Dr Khan · £22k MTD',
    keyMetricTrend:'+12% YoY'
  },
  hartwell: {
    revenueMTD:75000, revenueYTD:380000, profit:18000, margin:24,
    patientsActive:1480, patientsNew:54, retentionRate:84, ltv:4280,
    marketingSpend:5400, leads:86, cpl:63, roas:6.1, consultations:38, treatmentStarts:24,
    chairUtil:85, noShowRate:4.2, udaProgress:0, recallCompliance:94,
    treatmentMix:[{n:'Implants',v:62},{n:'Full Arch',v:18},{n:'Cosmetic',v:12},{n:'Sedation',v:5},{n:'Hygiene',v:3}],
    teamSize:9, clinicians:3, hygienists:1, nurses:3, reception:1, manager:1,
    complianceScore:97, dbsExpiringSoon:0, gdcExpiringSoon:0, indemnityExpiringSoon:0,
    alerts:[
      {p:'low',t:'Highest patient LTV — implant focus paying off'},
      {p:'med',t:'New patient volume below target — increase ad spend'}
    ],
    topClinician:'Dr Mehta · £42k MTD',
    keyMetricTrend:'+28% YoY'
  }
};

window.bhSelect = function(id) { localStorage.setItem('bh-selected', id || ''); navigate('business-hub'); };
window.bhSetSubTab = function(t) { localStorage.setItem('bh-subtab', t); navigate('business-hub'); };

PAGES['business-hub'] = () => {
  const selected = localStorage.getItem('bh-selected') || '';
  const subTab = localStorage.getItem('bh-subtab') || 'overview';

  // ============ ALL BUSINESSES VIEW ============
  if (!selected) {
    const totals = Object.values(BH_DATA).reduce((acc, d) => ({
      revenueMTD: acc.revenueMTD + d.revenueMTD,
      profit: acc.profit + d.profit,
      patients: acc.patients + d.patientsActive,
      leads: acc.leads + d.leads,
      alerts: acc.alerts + d.alerts.filter(a=>a.p==='urgent').length,
      teamSize: acc.teamSize + d.teamSize
    }), {revenueMTD:0,profit:0,patients:0,leads:0,alerts:0,teamSize:0});

    const kpis = `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:18px">
      ${mKpi('🏢','Active Sites', BH_PRACTICES.length.toString(), '', 'across the group')}
      ${mKpi('£','Group Revenue MTD', '£'+totals.revenueMTD.toLocaleString(), '+14%', 'vs last month')}
      ${mKpi('£','Group Profit', '£'+totals.profit.toLocaleString(), '', `${(totals.profit/totals.revenueMTD*100).toFixed(1)}% margin`)}
      ${mKpi('👥','Active Patients', totals.patients.toLocaleString(), '', 'total base')}
      ${mKpi('🎯','New Leads MTD', totals.leads.toString(), '', 'across all sites')}
      ${mKpi('⚠','Urgent Alerts', totals.alerts.toString(), '', 'needs attention')}
    </div>`;

    const cards = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:14px">
      ${BH_PRACTICES.map(p => {
        const d = BH_DATA[p.id];
        const urgentCount = d.alerts.filter(a=>a.p==='urgent').length;
        return `<div onclick="bhSelect('${p.id}')" style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${p.color};border-radius:12px;padding:18px;cursor:pointer;transition:all .15s" onmouseover="this.style.boxShadow='0 4px 14px rgba(15,23,42,.08)';this.style.borderColor='${p.color}'" onmouseout="this.style.boxShadow='none';this.style.borderColor='#E5E7EB'">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
            <div>
              <div style="font-weight:700;font-size:16px;color:#0F172A;letter-spacing:-.01em">${p.name}</div>
              <div style="font-size:11.5px;color:#64748B;margin-top:2px">${p.site}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              ${urgentCount > 0 ? `<span style="background:#FEE2E2;color:#991B1B;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:700">⚠ ${urgentCount}</span>` : ''}
              <span style="background:${p.color}22;color:${p.color};padding:3px 9px;border-radius:6px;font-size:11px;font-weight:700">${d.keyMetricTrend}</span>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
            <div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">Revenue MTD</div><div style="font-size:18px;font-weight:700;color:#0F172A;letter-spacing:-.01em;margin-top:2px">£${(d.revenueMTD/1000).toFixed(0)}k</div></div>
            <div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">Margin</div><div style="font-size:18px;font-weight:700;color:#0F172A;letter-spacing:-.01em;margin-top:2px">${d.margin}%</div></div>
            <div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">Chair Util</div><div style="font-size:18px;font-weight:700;color:${d.chairUtil>=80?'#10B981':d.chairUtil>=70?'#F59E0B':'#EF4444'};letter-spacing:-.01em;margin-top:2px">${d.chairUtil}%</div></div>
            <div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">ROAS</div><div style="font-size:18px;font-weight:700;color:#0F172A;letter-spacing:-.01em;margin-top:2px">${d.roas}×</div></div>
          </div>
          <div style="padding:10px;background:#F8FAFC;border-radius:8px;font-size:12px;color:#475569;display:flex;justify-content:space-between"><span>👥 ${d.patientsActive.toLocaleString()} patients · ${d.teamSize} team</span><span style="color:#0E7C7B;font-weight:600">View detail →</span></div>
        </div>`;
      }).join('')}
    </div>`;

    const compareTable = mCard('Side-by-Side Comparison', mTable(
      [{l:'Site'},{l:'Revenue MTD',align:'right'},{l:'Profit',align:'right'},{l:'Margin',align:'right'},{l:'Patients',align:'right'},{l:'New',align:'right'},{l:'CPL',align:'right'},{l:'ROAS',align:'right'},{l:'Chair Util',align:'right'},{l:'No-show',align:'right'},{l:'Compliance',align:'right'},{l:'Team',align:'right'}],
      BH_PRACTICES.map(p => {
        const d = BH_DATA[p.id];
        return [
          `<b style="color:${p.color}">${p.name}</b>`,
          '£'+d.revenueMTD.toLocaleString(),
          '£'+d.profit.toLocaleString(),
          d.margin+'%',
          d.patientsActive.toLocaleString(),
          d.patientsNew.toString(),
          '£'+d.cpl,
          d.roas+'×',
          `<span style="color:${d.chairUtil>=80?'#10B981':d.chairUtil>=70?'#F59E0B':'#EF4444'};font-weight:700">${d.chairUtil}%</span>`,
          `<span style="color:${d.noShowRate<=5?'#10B981':d.noShowRate<=7?'#F59E0B':'#EF4444'};font-weight:700">${d.noShowRate}%</span>`,
          `<span style="color:${d.complianceScore>=95?'#10B981':'#F59E0B'};font-weight:700">${d.complianceScore}%</span>`,
          d.teamSize.toString()
        ];
      })
    ));

    return mPage('Business Hub','Per-site deep-dive across all 5 practices · click any card for full drill-down · compare side-by-side', `${mBtn('⬇ Export','secondary')}${mBtn('+ Add site','primary')}`) + kpis + cards + compareTable + `</div>`;
  }

  // ============ SINGLE BUSINESS DETAIL VIEW ============
  const p = BH_PRACTICES.find(x => x.id === selected);
  if (!p) {
    localStorage.removeItem('bh-selected');
    return PAGES['business-hub']();
  }
  const d = BH_DATA[selected];

  const breadcrumb = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <button onclick="bhSelect('')" style="background:#fff;border:1px solid #E5E7EB;color:#475569;padding:8px 14px;border-radius:7px;font-size:12.5px;font-weight:600;cursor:pointer">← All Sites</button>
    <span style="font-size:13px;color:#64748B">›</span>
    <span style="font-size:14px;font-weight:700;color:${p.color}">${p.name}</span>
    <span style="font-size:11.5px;color:#94A3B8;margin-left:auto">${p.site}</span>
  </div>`;

  const subTabs = [
    {k:'overview', l:'Overview', i:'📊'},
    {k:'financials', l:'Financials', i:'💷'},
    {k:'marketing', l:'Marketing', i:'📣'},
    {k:'operations', l:'Operations', i:'⚙'},
    {k:'team', l:'Team', i:'👥'},
    {k:'patients', l:'Patients', i:'🦷'},
    {k:'compliance', l:'Compliance', i:'🛡'}
  ];

  let panel = '';

  // ----- OVERVIEW sub-tab -----
  if (subTab === 'overview') {
    const alertsBlock = d.alerts.length > 0 ? `<div style="margin-bottom:14px">
      ${d.alerts.map(a => {
        const colors = {urgent:{bg:'#FEE2E2',fg:'#991B1B',i:'⚠'}, med:{bg:'#FEF3C7',fg:'#92400E',i:'⚡'}, low:{bg:'#ECFDF5',fg:'#065F46',i:'✓'}};
        const c = colors[a.p] || colors.low;
        return `<div style="background:${c.bg};color:${c.fg};padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:6px"><span style="margin-right:6px">${c.i}</span>${a.t}</div>`;
      }).join('')}
    </div>` : '';

    panel = alertsBlock + `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:18px">
      ${mKpi('£','Revenue MTD','£'+d.revenueMTD.toLocaleString(), d.keyMetricTrend, 'YTD £'+d.revenueYTD.toLocaleString())}
      ${mKpi('£','Profit MTD','£'+d.profit.toLocaleString(), '', d.margin+'% margin')}
      ${mKpi('👥','Active Patients', d.patientsActive.toLocaleString(), '+'+d.patientsNew, 'new this month')}
      ${mKpi('🎯','Leads MTD', d.leads.toString(), '', 'CPL £'+d.cpl)}
      ${mKpi('⚡','Chair Util', d.chairUtil+'%', '', d.chairUtil>=80?'optimal':d.chairUtil>=70?'OK':'low')}
      ${mKpi('🛡','Compliance', d.complianceScore+'%', '', 'across all checks')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('Daily Performance Snapshot', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${[
          ['Top Performer', d.topClinician, '#10B981'],
          ['New Patients Today', '12 (avg 8)', '#10B981'],
          ['Treatment Plans Sent', '8 today', '#3B82F6'],
          ['No-Shows Today', '2 of 86 booked', d.noShowRate<6?'#10B981':'#F59E0B'],
          ['Recall Compliance', d.recallCompliance+'%', d.recallCompliance>=90?'#10B981':'#F59E0B']
        ].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px"><span>${l}</span><b style="color:${c}">${v}</b></div>`).join('')}
      </div>`)}
      ${mCard('Treatment Mix · MTD', `<div style="display:flex;flex-direction:column;gap:8px">
        ${d.treatmentMix.map(t=>`<div>
          <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;color:#0F172A;margin-bottom:4px"><span>${t.n}</span><span>${t.v}%</span></div>
          <div style="background:#F1F5F9;height:8px;border-radius:4px;overflow:hidden"><div style="background:${p.color};height:8px;width:${t.v*2}%"></div></div>
        </div>`).join('')}
      </div>`)}
    </div>`;
  }

  // ----- FINANCIALS sub-tab -----
  else if (subTab === 'financials') {
    const expenses = [
      ['Salaries & Wages', Math.round(d.revenueMTD*0.38), 38],
      ['Lab Fees', Math.round(d.revenueMTD*0.12), 12],
      ['Materials & Stock', Math.round(d.revenueMTD*0.08), 8],
      ['Marketing', d.marketingSpend, Math.round(d.marketingSpend/d.revenueMTD*100)],
      ['Rent & Utilities', Math.round(d.revenueMTD*0.06), 6],
      ['Software & Subs', Math.round(d.revenueMTD*0.02), 2],
      ['Insurance & Indemnity', Math.round(d.revenueMTD*0.015), 1.5],
      ['Other', Math.round(d.revenueMTD*0.04), 4]
    ];
    const totalExp = expenses.reduce((s,e)=>s+e[1], 0);
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('£','Revenue MTD','£'+d.revenueMTD.toLocaleString(), '', 'gross')}
      ${mKpi('£','Total Expenses','£'+totalExp.toLocaleString(), '', 'all categories')}
      ${mKpi('£','Net Profit','£'+(d.revenueMTD-totalExp).toLocaleString(), '', d.margin+'% margin')}
      ${mKpi('£','Cash on Hand','£'+Math.round(d.revenueMTD*0.4).toLocaleString(), '', 'reserves')}
    </div>
    ${mCard('Expense Breakdown · MTD', mTable(
      [{l:'Category'},{l:'Amount',align:'right'},{l:'% of Revenue',align:'right'},{l:'Trend'}],
      expenses.map(([l,v,pct]) => [
        '<b>'+l+'</b>',
        '£'+v.toLocaleString(),
        pct+'%',
        Math.random()>0.5 ? '<span style="color:#10B981">↘ -2%</span>' : '<span style="color:#F59E0B">↗ +3%</span>'
      ])
    ))}
    <div style="margin-top:14px">${mCard('Revenue Trend · Last 6 Months', `<div style="display:flex;align-items:flex-end;justify-content:space-around;height:160px;padding:14px;background:#F8FAFC;border-radius:10px">
      ${[0.82, 0.88, 0.91, 0.95, 0.97, 1.0].map((mult, i) => {
        const value = d.revenueMTD * mult;
        const heightPct = mult * 100;
        const month = new Date(); month.setMonth(month.getMonth() - (5 - i));
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1">
          <div style="font-size:10.5px;font-weight:600;color:#475569">£${(value/1000).toFixed(0)}k</div>
          <div style="width:32px;height:${heightPct}%;background:linear-gradient(180deg,${p.color}AA,${p.color});border-radius:6px 6px 0 0"></div>
          <div style="font-size:10.5px;color:#94A3B8;font-weight:600">${month.toLocaleDateString('en-GB',{month:'short'})}</div>
        </div>`;
      }).join('')}
    </div>`)}</div>`;
  }

  // ----- MARKETING sub-tab -----
  else if (subTab === 'marketing') {
    const channels = [
      {n:'Meta Ads', spend:Math.round(d.marketingSpend*0.45), leads:Math.round(d.leads*0.42), cpl:55, roas:5.4, c:'#1877F2'},
      {n:'Google Ads', spend:Math.round(d.marketingSpend*0.35), leads:Math.round(d.leads*0.32), cpl:62, roas:4.8, c:'#4285F4'},
      {n:'Organic SEO', spend:0, leads:Math.round(d.leads*0.14), cpl:0, roas:99, c:'#10B981'},
      {n:'Referrals', spend:0, leads:Math.round(d.leads*0.10), cpl:0, roas:99, c:'#8B5CF6'},
      {n:'Other', spend:Math.round(d.marketingSpend*0.2), leads:Math.round(d.leads*0.02), cpl:140, roas:2.1, c:'#94A3B8'}
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('£','Spend MTD','£'+d.marketingSpend.toLocaleString(), '', Math.round(d.marketingSpend/d.revenueMTD*100)+'% of revenue')}
      ${mKpi('🎯','Leads MTD', d.leads.toString(), '', 'all channels')}
      ${mKpi('£','Avg CPL', '£'+d.cpl, '', 'industry: £75')}
      ${mKpi('📈','Blended ROAS', d.roas+'×', '', 'target: 4×')}
    </div>
    ${mCard('Channel Performance · MTD', mTable(
      [{l:'Channel'},{l:'Spend',align:'right'},{l:'Leads',align:'right'},{l:'CPL',align:'right'},{l:'ROAS',align:'right'},{l:'Status'}],
      channels.map(ch => [
        `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:${ch.c};border-radius:2px"></span><b>${ch.n}</b></span>`,
        '£'+ch.spend.toLocaleString(),
        ch.leads.toString(),
        ch.cpl>0 ? '£'+ch.cpl : '<span style="color:#10B981;font-weight:700">£0</span>',
        ch.roas===99 ? '<span style="color:#10B981;font-weight:700">∞</span>' : `<b style="color:${ch.roas>=4?'#10B981':ch.roas>=3?'#F59E0B':'#EF4444'}">${ch.roas}×</b>`,
        ch.roas>=4 ? mBadge('Strong','success') : ch.roas>=3 ? mBadge('OK','warn') : mBadge('Underperforming','danger')
      ])
    ))}
    <div style="margin-top:14px">${mCard('Acquisition Funnel · MTD', `<div style="display:flex;flex-direction:column;gap:10px">
      ${[
        ['Leads', d.leads, 100, '#0E7C7B'],
        ['Consultations', d.consultations, Math.round(d.consultations/d.leads*100), '#10B981'],
        ['Treatment Plans Sent', Math.round(d.consultations*0.78), Math.round(d.consultations*0.78/d.leads*100), '#3B82F6'],
        ['Treatment Started', d.treatmentStarts, Math.round(d.treatmentStarts/d.leads*100), '#8B5CF6']
      ].map(([l,v,pct,c])=>`<div>
        <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;color:#0F172A;margin-bottom:5px"><span>${l}</span><span>${v} (${pct}%)</span></div>
        <div style="background:#F1F5F9;height:12px;border-radius:6px;overflow:hidden"><div style="background:${c};height:12px;width:${pct}%;border-radius:6px"></div></div>
      </div>`).join('')}
    </div>`)}</div>`;
  }

  // ----- OPERATIONS sub-tab -----
  else if (subTab === 'operations') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('⚡','Chair Utilisation', d.chairUtil+'%', '', 'target: 85%')}
      ${mKpi('❌','No-show Rate', d.noShowRate+'%', '', 'target: <5%')}
      ${mKpi('📋','UDA Progress', d.udaProgress>0?d.udaProgress+'%':'N/A', '', d.udaProgress>0?'NHS contract':'private only')}
      ${mKpi('🔁','Recall Compliance', d.recallCompliance+'%', '', 'target: 90%')}
    </div>
    ${mCard('Treatment Mix · Revenue Distribution', mTable(
      [{l:'Treatment'},{l:'% of Revenue',align:'right'},{l:'Est. £/month',align:'right'},{l:'Visual'}],
      d.treatmentMix.map(t => [
        '<b>'+t.n+'</b>',
        t.v+'%',
        '£'+Math.round(d.revenueMTD*t.v/100).toLocaleString(),
        `<div style="background:#F1F5F9;height:8px;border-radius:4px;width:120px;overflow:hidden"><div style="background:${p.color};height:8px;width:${t.v*2}%"></div></div>`
      ])
    ))}
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('Chair Activity · By Surgery', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${[1,2,3,4,5].slice(0, Math.ceil(d.teamSize/4)).map(c => {
          const util = 60 + Math.floor(Math.random()*30);
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#F8FAFC;border-radius:7px">
            <span>Surgery ${c}</span>
            <div style="display:flex;align-items:center;gap:10px"><div style="background:#E5E7EB;height:8px;width:100px;border-radius:4px;overflow:hidden"><div style="background:${util>=80?'#10B981':util>=70?'#F59E0B':'#EF4444'};height:8px;width:${util}%"></div></div><b style="color:${util>=80?'#10B981':util>=70?'#F59E0B':'#EF4444'};min-width:36px;text-align:right">${util}%</b></div>
          </div>`;
        }).join('')}
      </div>`)}
      ${mCard('Booking Lead Times', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${[
          ['Routine Check-up', '2 weeks', '#10B981'],
          ['Hygienist', '3 weeks', '#F59E0B'],
          ['Consultation (Implant)', '1 week', '#10B981'],
          ['Cosmetic Consult', '5 days', '#10B981'],
          ['Emergency', 'Same day', '#10B981']
        ].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px"><span>${l}</span><b style="color:${c}">${v}</b></div>`).join('')}
      </div>`)}
    </div>`;
  }

  // ----- TEAM sub-tab -----
  else if (subTab === 'team') {
    const breakdown = [
      ['👨‍⚕️','Clinicians', d.clinicians, '#0E7C7B'],
      ['🦷','Hygienists', d.hygienists, '#10B981'],
      ['👩‍⚕️','Nurses', d.nurses, '#3B82F6'],
      ['💼','Reception', d.reception, '#8B5CF6'],
      ['📋','Manager', d.manager, '#F59E0B']
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px">
      ${breakdown.map(([i,l,v,c])=>`<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${c};border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:22px;margin-bottom:4px">${i}</div>
        <div style="font-size:28px;font-weight:700;color:#0F172A;letter-spacing:-.02em">${v}</div>
        <div style="font-size:11.5px;color:#64748B;font-weight:600;margin-top:2px">${l}</div>
      </div>`).join('')}
    </div>
    ${mCard('Team Performance · MTD', mTable(
      [{l:'Role'},{l:'Headcount',align:'right'},{l:'Avg Revenue / Person',align:'right'},{l:'Top Performer'},{l:'Status'}],
      [
        ['<b>Clinicians</b>', d.clinicians.toString(), '£'+Math.round(d.revenueMTD*0.75/d.clinicians).toLocaleString(), d.topClinician, mBadge('Performing','success')],
        ['<b>Hygienists</b>', d.hygienists.toString(), '£'+Math.round(d.revenueMTD*0.12/d.hygienists).toLocaleString(), 'Sarah B · £8k MTD', mBadge('Performing','success')],
        ['<b>Nurses</b>', d.nurses.toString(), 'N/A', 'Lead nurse: Maria T', mBadge('Stable','info')],
        ['<b>Reception</b>', d.reception.toString(), 'N/A', 'Call answer rate: 96%', mBadge('Strong','success')],
        ['<b>Practice Manager</b>', d.manager.toString(), 'N/A', '—', mBadge('Active','info')]
      ]
    ))}
    <div style="margin-top:14px">${mCard('Workforce Alerts', `<div style="display:flex;flex-direction:column;gap:10px;font-size:13px">
      ${[
        ['Annual leave booked next month', '3 staff', '#F59E0B'],
        ['Sick days MTD', '4 days', '#10B981'],
        ['Training hours due (CPD)', '12 hours pending', '#3B82F6'],
        ['Open vacancies', d.teamSize < 14 ? '1 (Hygienist)' : 'None', d.teamSize<14?'#F59E0B':'#10B981']
      ].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px"><span>${l}</span><b style="color:${c}">${v}</b></div>`).join('')}
    </div>`)}</div>`;
  }

  // ----- PATIENTS sub-tab -----
  else if (subTab === 'patients') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('👥','Active Patients', d.patientsActive.toLocaleString(), '', 'last 12 months')}
      ${mKpi('🆕','New This Month', d.patientsNew.toString(), '', 'first-time visits')}
      ${mKpi('🔁','Retention Rate', d.retentionRate+'%', '', 'rebooked')}
      ${mKpi('£','Patient LTV', '£'+d.ltv.toLocaleString(), '', 'lifetime value')}
    </div>
    ${mCard('Patient Source · MTD', mTable(
      [{l:'Source'},{l:'New Patients',align:'right'},{l:'% of New',align:'right'},{l:'LTV Avg',align:'right'},{l:'Best Channel'}],
      [
        ['Referral (Word of Mouth)', Math.round(d.patientsNew*0.32).toString(), '32%', '£'+Math.round(d.ltv*1.3).toLocaleString(), mBadge('Highest LTV','success')],
        ['Google Search', Math.round(d.patientsNew*0.28).toString(), '28%', '£'+Math.round(d.ltv*1.1).toLocaleString(), mBadge('Strong','success')],
        ['Social Media', Math.round(d.patientsNew*0.22).toString(), '22%', '£'+Math.round(d.ltv*0.85).toLocaleString(), mBadge('OK','info')],
        ['Local Listing', Math.round(d.patientsNew*0.12).toString(), '12%', '£'+Math.round(d.ltv*0.9).toLocaleString(), mBadge('Stable','info')],
        ['Other', Math.round(d.patientsNew*0.06).toString(), '6%', '£'+Math.round(d.ltv*0.7).toLocaleString(), mBadge('Low','warn')]
      ]
    ))}
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('Patient Demographics', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${[
          ['Age 0-17', '18%', '#3B82F6'],
          ['Age 18-34', '24%', '#10B981'],
          ['Age 35-54', '38%', '#F59E0B'],
          ['Age 55+', '20%', '#8B5CF6']
        ].map(([l,v,c])=>`<div>
          <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;margin-bottom:4px"><span>${l}</span><b>${v}</b></div>
          <div style="background:#F1F5F9;height:8px;border-radius:4px;overflow:hidden"><div style="background:${c};height:8px;width:${parseInt(v)*2.5}%"></div></div>
        </div>`).join('')}
      </div>`)}
      ${mCard('Recall & Reactivation', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${[
          ['Due for recall', '142 patients', '#F59E0B'],
          ['Recalls completed MTD', '98', '#10B981'],
          ['Lapsed >12 months', '184 patients', '#EF4444'],
          ['Reactivated MTD', '12', '#10B981']
        ].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px"><span>${l}</span><b style="color:${c}">${v}</b></div>`).join('')}
      </div>`)}
    </div>`;
  }

  // ----- COMPLIANCE sub-tab -----
  else if (subTab === 'compliance') {
    const items = [
      {n:'DBS Checks',expiring:d.dbsExpiringSoon,total:d.teamSize,c:'#3B82F6'},
      {n:'GDC Registration',expiring:d.gdcExpiringSoon,total:d.clinicians+d.hygienists,c:'#10B981'},
      {n:'Professional Indemnity',expiring:d.indemnityExpiringSoon,total:d.clinicians,c:'#8B5CF6'},
      {n:'CPD Hours Tracking',expiring:0,total:d.clinicians+d.hygienists,c:'#F59E0B'},
      {n:'First Aid Training',expiring:1,total:d.teamSize,c:'#EF4444'},
      {n:'Fire Safety',expiring:0,total:1,c:'#F59E0B'},
      {n:'COSHH Assessment',expiring:0,total:1,c:'#06B6D4'},
      {n:'Infection Control Audit',expiring:0,total:1,c:'#10B981'}
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('🛡','Compliance Score', d.complianceScore+'%', '', 'overall')}
      ${mKpi('⏳','Expiring Soon', (d.dbsExpiringSoon+d.gdcExpiringSoon+d.indemnityExpiringSoon).toString(), '', 'within 30 days')}
      ${mKpi('✓','CQC Status', 'Good', '', 'last inspection')}
      ${mKpi('📋','Open Actions', items.reduce((s,i)=>s+i.expiring,0).toString(), '', 'need attention')}
    </div>
    ${mCard('Compliance Items', mTable(
      [{l:'Item'},{l:'Coverage',align:'right'},{l:'Expiring Soon',align:'right'},{l:'Status'}],
      items.map(it => [
        `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:${it.c};border-radius:2px"></span><b>${it.n}</b></span>`,
        it.total.toString()+' staff',
        it.expiring > 0 ? `<span style="color:#EF4444;font-weight:700">⚠ ${it.expiring}</span>` : '<span style="color:#10B981">0</span>',
        it.expiring === 0 ? mBadge('Compliant','success') : mBadge('Action needed','warn')
      ])
    ))}
    <div style="margin-top:14px">${mCard('Upcoming Compliance Calendar', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
      ${[
        ['Annual CQC Self-Assessment', 'Due in 18 days', '#F59E0B'],
        ['Fire Safety Drill', 'Due in 32 days', '#10B981'],
        ['Infection Control Audit', 'Completed (next: 6 months)', '#10B981'],
        ['Patient Survey', 'Quarterly · due in 12 days', '#3B82F6'],
        ['Insurance Renewal', 'Due in 64 days', '#10B981']
      ].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px"><span>${l}</span><b style="color:${c}">${v}</b></div>`).join('')}
    </div>`)}</div>`;
  }

  return mPage(p.name + ' · Business Detail', p.site + ' · all KPIs and trackers for this site', `${mBtn('⬇ Export site report','secondary')}${mBtn('📋 Add task','secondary')}${mBtn('💬 Notes','secondary')}`) + breadcrumb + mTabs(subTab, subTabs, 'bhSetSubTab') + panel + `</div>`;
};
