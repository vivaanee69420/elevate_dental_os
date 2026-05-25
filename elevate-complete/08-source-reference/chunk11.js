
// ============================================================================
// CHUNK 11 — UNIFIED GROUP DASHBOARD + CASH FLOW INSIGHTS
// 5-tab unified dashboard + Past/Present/Future cash flow insights + Decision wizard
// ============================================================================

window.dpdSetTab = function(t) { localStorage.setItem('dpd-tab', t); navigate('unified-dashboard'); };

PAGES['unified-dashboard'] = () => {
  const tab = localStorage.getItem('dpd-tab') || 'overview';
  const tabs = [
    {k:'overview', l:'Overview',  i:'📊'},
    {k:'revenue',  l:'Revenue',   i:'💷'},
    {k:'profit',   l:'Profit',    i:'📈'},
    {k:'cashflow', l:'Cash Flow', i:'💧'},
    {k:'expenses', l:'Expenses',  i:'💸'}
  ];
  let panel = '';

  // ===== OVERVIEW =====
  if (tab === 'overview') {
    panel = `${mCard('Revenue · Net Profit · Net Cash Flow · 12 Months', `<div style="display:flex;align-items:end;gap:8px;height:200px;padding:10px 0;border-bottom:1px solid #E5E7EB;border-left:1px solid #E5E7EB">
      ${['Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May'].map((m,i)=>{
        const rev = 60 + Math.round(Math.random()*30);
        const profit = 25 + Math.round(Math.random()*15);
        const cash = profit + Math.round((Math.random()-0.5)*10);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <div style="width:100%;display:flex;gap:2px;align-items:end;height:170px">
            <div style="flex:1;background:#0E7C7B;height:${rev}%;border-radius:3px 3px 0 0" title="Revenue: £${rev*3}k"></div>
            <div style="flex:1;background:#3B82F6;height:${profit}%;border-radius:3px 3px 0 0" title="Profit: £${profit*3}k"></div>
            <div style="flex:1;background:#10B981;height:${cash}%;border-radius:3px 3px 0 0" title="Cash: £${cash*3}k"></div>
          </div>
          <div style="font-size:10px;color:#64748B;font-weight:600">${m}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:14px;margin-top:10px;font-size:11.5px"><span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:#0E7C7B;border-radius:2px"></span>Revenue</span><span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:#3B82F6;border-radius:2px"></span>Net Profit</span><span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:#10B981;border-radius:2px"></span>Net Cash Flow</span></div>`)}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px">
      ${mKpi('🪑','Revenue per Chair Hour','£268','+8%','vs benchmark £280')}
      ${mKpi('🏥','Avg Profit/Room/Day','£546','+12%','across 8 surgeries')}
      ${mKpi('💷','Current Cash Position','£285,000','','30 Apr 2026')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px">
      ${mKpi('⚖','Breakeven Sales','£186,400','','monthly · 31% buffer')}
      ${mKpi('🪑','OCPSPD','£280','','operating cost / surgery / day')}
      ${mKpi('💰','Excess Cash To Invest','£141,000','+£12k','closing cash − 3mo opex − tax')}
    </div>`;
  }

  // ===== REVENUE =====
  else if (tab === 'revenue') {
    const byTreatment = [
      {n:'Implants & Full Arch', amt:540000, pct:22.5, c:'#0E7C7B'},
      {n:'Invisalign', amt:420000, pct:17.5, c:'#7C3AED'},
      {n:'Cosmetic (composite/bonding)', amt:360000, pct:15.0, c:'#EC4899'},
      {n:'Crown & Bridge', amt:300000, pct:12.5, c:'#3B82F6'},
      {n:'Hygiene', amt:288000, pct:12.0, c:'#10B981'},
      {n:'NHS UDA', amt:285000, pct:11.9, c:'#F59E0B'},
      {n:'Endodontics', amt:120000, pct:5.0, c:'#EF4444'},
      {n:'Other', amt:87000, pct:3.6, c:'#94A3B8'}
    ];
    panel = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('Revenue by Treatment Type', `<div style="display:flex;height:24px;border-radius:6px;overflow:hidden;margin-bottom:14px">${byTreatment.map(t=>`<div style="width:${t.pct}%;background:${t.c};display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700">${t.pct>4?t.pct+'%':''}</div>`).join('')}</div>
      ${byTreatment.map(t=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #F1F5F9;font-size:13px">
        <span style="display:inline-flex;align-items:center;gap:8px"><span style="width:10px;height:10px;background:${t.c};border-radius:2px"></span><b>${t.n}</b></span>
        <span><b>£${t.amt.toLocaleString()}</b> <span style="color:#64748B;font-size:11.5px">(${t.pct}%)</span></span>
      </div>`).join('')}`)}
      ${mCard('Revenue by Associate · Annual', `<div style="display:flex;flex-direction:column;gap:6px">${[
        ['Dr D · Implants','£506,000','#0E7C7B',100],
        ['Dr E · Cosmetic','£437,000','#7C3AED',86],
        ['Dr A · Principal','£414,000','#EC4899',82],
        ['Dr C · Associate','£322,000','#3B82F6',64],
        ['Dr B · Associate','£276,000','#10B981',55],
        ['Dr F · NHS-mixed','£207,000','#F59E0B',41],
        ['Hyg G · Hygienist','£156,000','#94A3B8',31]
      ].map(([n,a,c,w])=>`<div style="padding:8px 0;border-bottom:1px solid #F1F5F9">
        <div style="display:flex;justify-content:space-between;font-size:13px"><b>${n}</b><b>${a}</b></div>
        <div style="background:#F1F5F9;height:6px;border-radius:3px;margin-top:5px;overflow:hidden"><div style="background:${c};height:100%;width:${w}%"></div></div>
      </div>`).join('')}</div>`)}
    </div>`;
  }

  // ===== PROFIT =====
  else if (tab === 'profit') {
    const benchmark = [
      {n:'Dentist',expected:1080000,bench:45,actual:1020000,actualPct:42.5,c:'#0E7C7B'},
      {n:'Staff',expected:432000,bench:18,actual:432000,actualPct:18.0,c:'#3B82F6'},
      {n:'Lab + Material',expected:360000,bench:15,actual:408000,actualPct:17.0,c:'#EF4444'},
      {n:'Other Fixed',expected:288000,bench:12,actual:264000,actualPct:11.0,c:'#F59E0B'},
      {n:'Profit',expected:240000,bench:10,actual:276000,actualPct:11.5,c:'#10B981'}
    ];
    panel = `${mCard('Practice vs Benchmark · % of Revenue', `<div style="display:flex;flex-direction:column;gap:10px">${benchmark.map(b=>{
      const status = b.actualPct < b.bench - 1 ? 'good' : b.actualPct > b.bench + 1 ? 'warn' : 'neutral';
      const adjStatus = b.n === 'Profit' ? (b.actualPct > b.bench ? 'good' : 'warn') : status;
      const c = adjStatus === 'good' ? '#10B981' : adjStatus === 'warn' ? '#EF4444' : '#64748B';
      return `<div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px">
          <b>${b.n}</b>
          <span><b style="color:${c}">${b.actualPct}%</b> <span style="color:#64748B;font-size:11.5px">vs ${b.bench}% bench</span></span>
        </div>
        <div style="background:#F1F5F9;height:14px;border-radius:7px;overflow:hidden;position:relative">
          <div style="background:${c};height:100%;width:${Math.min(b.actualPct*2,100)}%;border-radius:7px"></div>
          <div style="position:absolute;left:${b.bench*2}%;top:0;height:100%;width:2px;background:#0F172A"></div>
        </div>
      </div>`;
    }).join('')}<div style="font-size:11px;color:#64748B;margin-top:8px"><b style="color:#0F172A">|</b> = Industry benchmark</div>`)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
      ${mCard('Associates · Annualised Profit', mTable(
        [{l:'Associate'},{l:'Production',align:'right'},{l:'Profit £',align:'right'},{l:'Margin %',align:'right'}],
        [['Dr D · Implants','£506,000','£148,000','29%'],['Dr E · Cosmetic','£437,000','£124,000','28%'],['Dr A · Principal','£414,000','£128,000','31%'],['Dr C · Associate','£322,000','£88,000','27%'],['Dr B · Associate','£276,000','£71,000','26%'],['Dr F · NHS-mixed','£207,000','£42,000','20%'],['Hyg G · Hygienist','£156,000','£62,000','40%']].map(r=>r.map((c,i)=>i===2?`<b style="color:#10B981">${c}</b>`:c))
      ))}
      ${mCard('% Profit · Last 12 Months', `<div style="display:flex;align-items:end;gap:6px;height:160px;padding:10px 0">${['J','J','A','S','O','N','D','J','F','M','A','M'].map(()=>{const v=10+Math.random()*5;return `<div style="flex:1;background:linear-gradient(to top,#10B981,#34D399);height:${v*6}%;border-radius:3px 3px 0 0" title="${v.toFixed(1)}%"></div>`;}).join('')}</div>
      <div style="text-align:center;font-size:11px;color:#64748B">Avg: <b>11.5%</b> · Target: <b>10%</b> · Trending ↗</div>`)}
    </div>`;
  }

  // ===== CASH FLOW =====
  else if (tab === 'cashflow') {
    panel = `<div style="background:#FEE2E2;border-left:3px solid #EF4444;padding:14px;border-radius:8px;margin-bottom:14px">
      <div style="font-size:14px;font-weight:700;color:#991B1B;margin-bottom:4px">⚠ Will I Run Out of Money?</div>
      <div style="font-size:13px;color:#991B1B;line-height:1.5">No projected breach in the next 26 weeks at current burn (£8,500/wk). Buffer holds above £100k minimum. <b>Status: Safe.</b></div>
    </div>
    ${mCard('Expenses I Need To Plan in Next 3 Months', mTable(
      [{l:'Expense'},{l:'Amount £',align:'right'},{l:'When'},{l:'Priority'}],
      [
        ['Corporation Tax · Q4','£56,500','30 Jun 2026',mBadge('Critical','danger')],
        ['Salaries · Jun','£42,000','25 Jun 2026',mBadge('Critical','danger')],
        ['VAT · Q1','£28,400','07 Jul 2026',mBadge('Critical','danger')],
        ['Equipment finance','£18,000','15 Jul 2026',mBadge('High','warn')],
        ['Insurance renewal','£14,200','01 Aug 2026',mBadge('High','warn')],
        ['NHS Superannuation','£8,400','30 Jun 2026',mBadge('Med','info')],
        ['Software subscriptions','£3,800','Throughout',mBadge('Routine','neutral')]
      ]
    ))}`;
  }

  // ===== EXPENSES =====
  else if (tab === 'expenses') {
    const exp5 = [
      {n:'Dentist (Associate Fees)',amt:1020000,pct:42.5,bench:45,c:'#0E7C7B'},
      {n:'Staff Salaries',amt:432000,pct:18.0,bench:18,c:'#3B82F6'},
      {n:'Lab & Materials',amt:408000,pct:17.0,bench:15,c:'#EF4444'},
      {n:'Advertising',amt:144000,pct:6.0,bench:5,c:'#F59E0B'},
      {n:'Operating Lease',amt:120000,pct:5.0,bench:5,c:'#8B5CF6'}
    ];
    panel = `${mCard('5 Expenses to Track', mTable(
      [{l:'Category'},{l:'Amount £',align:'right'},{l:'% of Revenue',align:'right'},{l:'Benchmark %',align:'right'},{l:'Variance',align:'right'}],
      exp5.map(e=>{
        const v = e.pct - e.bench;
        return [
          `<span style="display:inline-flex;align-items:center;gap:8px"><span style="width:10px;height:10px;background:${e.c};border-radius:2px"></span><b>${e.n}</b></span>`,
          '£'+e.amt.toLocaleString(),
          e.pct.toFixed(1)+'%',
          e.bench+'%',
          `<b style="color:${Math.abs(v)<=1?'#64748B':v<0?'#10B981':'#EF4444'}">${v>=0?'+':''}${v.toFixed(1)}%</b>`
        ];
      })
    ))}
    <div style="margin-top:14px">${mCard('Expenses vs Benchmark · Bar Chart', `<div style="display:flex;flex-direction:column;gap:10px">${exp5.map(e=>`<div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px"><b>${e.n}</b><span>${e.pct.toFixed(1)}% (bench ${e.bench}%)</span></div>
      <div style="background:#F1F5F9;height:18px;border-radius:9px;overflow:hidden;position:relative">
        <div style="background:${e.c};height:100%;width:${e.pct*2}%;border-radius:9px"></div>
        <div style="position:absolute;left:${e.bench*2}%;top:0;height:100%;width:2px;background:#0F172A"></div>
      </div>
    </div>`).join('')}</div>`)}</div>`;
  }

  return mPage('Unified Group Dashboard','5-tab unified view: Overview · Revenue · Profit · Cash Flow · Expenses', `${mBtn('⬇ Download PDF','secondary')}${mBtn('🔍 Filter','secondary')}`) + mTabs(tab, tabs, 'dpdSetTab') + panel + `</div>`;
};

// ===========================================================================
// CASH FLOW INSIGHTS · PAST · PRESENT · FUTURE
// ===========================================================================
window.cfiSetTab = function(t) { localStorage.setItem('cfi-tab', t); navigate('cashflow-insights'); };

PAGES['cashflow-insights'] = () => {
  const tab = localStorage.getItem('cfi-tab') || 'past';
  const tabs = [
    {k:'past',     l:'Past',     i:'📜'},
    {k:'present',  l:'Present',  i:'⏱'},
    {k:'future',   l:'Future',   i:'🔮'},
    {k:'decision', l:'Decision', i:'⚡'}
  ];
  let panel = '';

  // ===== PAST =====
  if (tab === 'past') {
    panel = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('💷','Cash Collected (12mo)','£2,460,000','+12%','vs prior year')}
      ${mKpi('💸','Cash Paid (12mo)','£2,184,000','+8%','disciplined growth')}
      ${mKpi('📈','Closing Cash Trend','↗ Improving','+£82k','12-month delta')}
    </div>
    ${mCard('Total Monthly Cash Received vs Paid · 12 Months', `<div style="display:flex;align-items:end;gap:10px;height:240px;padding:14px 0;border-bottom:1px solid #E5E7EB">
      ${['Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May'].map(m=>{
        const rec = 180+Math.round(Math.random()*40);
        const paid = 150+Math.round(Math.random()*35);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center">
          <div style="width:100%;display:flex;gap:3px;align-items:end;height:200px">
            <div style="flex:1;background:#10B981;height:${rec/2.5}%;border-radius:3px 3px 0 0" title="Received £${rec}k"></div>
            <div style="flex:1;background:#EF4444;height:${paid/2.5}%;border-radius:3px 3px 0 0" title="Paid £${paid}k"></div>
          </div>
          <div style="font-size:10.5px;color:#64748B;margin-top:6px;font-weight:600">${m}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:14px;margin-top:10px;font-size:11.5px;justify-content:center">
      <span style="display:flex;align-items:center;gap:5px"><span style="width:12px;height:12px;background:#10B981;border-radius:3px"></span>Received</span>
      <span style="display:flex;align-items:center;gap:5px"><span style="width:12px;height:12px;background:#EF4444;border-radius:3px"></span>Paid</span>
    </div>`)}`;
  }

  // ===== PRESENT =====
  else if (tab === 'present') {
    panel = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('🎯','Closing Target','£320,000','','Month-end target')}
      ${mKpi('📊','Actual','£285,000','-£35k','MTD')}
      ${mKpi('📅','Days Remaining','7','','to hit target')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('Top 3 Cash-Generating Products · MTD', mTable(
        [{l:'Treatment'},{l:'Units',align:'right'},{l:'Cash In',align:'right'},{l:'% of MTD Cash'}],
        [
          ['<b>Single Implant</b>','18','£43,200','22.4%'],
          ['<b>Invisalign Full</b>','9','£34,200','17.7%'],
          ['<b>Composite Bonding (6)</b>','11','£24,200','12.6%']
        ]
      ))}
      ${mCard('Outliers · Top 5 Metrics (anomalies)', mTable(
        [{l:'Metric'},{l:'Expected'},{l:'Actual'},{l:'Variance'}],
        [
          ['<b>Lab fees · Implants</b>','£420/case','£540/case','<b style="color:#EF4444">+28%</b>'],
          ['<b>Dr F · daily prod</b>','£900','£640','<b style="color:#EF4444">-29%</b>'],
          ['<b>NHS BSA payment</b>','£23,750','£21,200','<b style="color:#EF4444">-11%</b>'],
          ['<b>Materials · composite</b>','£840/mo','£1,240/mo','<b style="color:#EF4444">+48%</b>'],
          ['<b>Patient deposits</b>','£14k','£22k','<b style="color:#10B981">+57%</b>']
        ]
      ))}
    </div>
    <div style="margin-top:14px">${mCard('Closing Balance Target vs Actual · Toggle Month/Quarter/Year', `<div style="display:flex;gap:6px;margin-bottom:12px">${['Month','Quarter','Year'].map((p,i)=>`<button style="padding:6px 12px;font-size:11.5px;font-weight:700;border:1px solid #E5E7EB;background:${i===0?'#0E7C7B':'#fff'};color:${i===0?'#fff':'#475569'};border-radius:6px;cursor:pointer">${p}</button>`).join('')}</div>
    <div style="display:flex;align-items:end;gap:10px;height:180px">${[265,278,290,285].map((v,i)=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center">
      <div style="background:${i===3?'#0E7C7B':'#94A3B8'};width:100%;height:${v/3.5}%;border-radius:3px 3px 0 0;position:relative"><div style="position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:700;color:#0F172A">£${v}k</div></div>
      <div style="font-size:10.5px;color:#64748B;margin-top:6px;font-weight:600">W${i+1}</div>
    </div>`).join('')}</div>`)}</div>`;
  }

  // ===== FUTURE =====
  else if (tab === 'future') {
    panel = `<div style="background:#ECFDF5;border-left:3px solid #10B981;padding:14px;border-radius:8px;margin-bottom:14px">
      <div style="font-size:14px;font-weight:700;color:#065F46;margin-bottom:4px">✓ When/If You Will Run Out of Money</div>
      <div style="font-size:13px;color:#065F46;line-height:1.5">At current burn rate, no projected breach in the next 26 weeks. Buffer maintained above £100k. Reassessed daily.</div>
    </div>
    ${mCard('Biggest 3 Tax / One-Off Outflows · Next 12 Months', mTable(
      [{l:'Outflow'},{l:'Amount £',align:'right'},{l:'Due'},{l:'Action'}],
      [
        ['<b>Corporation Tax (FY26)</b>','£56,500','30 Jun 2026','<b>Set aside in tax reserve account</b>'],
        ['<b>VAT · Quarterly</b>','£28,400','07 Jul / Oct / Jan / Apr','Auto-reserve from inflows'],
        ['<b>Equipment finance balloon</b>','£24,000','Sep 2026','Build to £24k by Aug']
      ]
    ))}
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('Free Cash Flow · Forward 12 Months', `<div style="font-size:13px;color:#475569;line-height:1.7">
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F1F5F9"><span>Cash from Operations</span><b style="color:#10B981">£420,000</b></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F1F5F9"><span>− CapEx</span><b style="color:#EF4444">-£78,000</b></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F1F5F9"><span>− One-off Tax</span><b style="color:#EF4444">-£56,500</b></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F1F5F9"><span>− Debt Repayments</span><b style="color:#EF4444">-£48,000</b></div>
        <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid #E5E7EB;font-weight:700;color:#0F172A"><span>= Free Cash Flow</span><b style="color:#10B981">£237,500</b></div>
      </div>`)}
      ${mCard('Excess Cash To Invest', `<div style="background:linear-gradient(135deg,#3B82F6,#2563EB);color:#fff;border-radius:10px;padding:18px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;opacity:.85">Available to Invest</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-.02em;margin:4px 0">£141,000</div>
        <div style="font-size:11.5px;opacity:.9">Cash − (3 × avg opex) − planned taxes</div>
      </div>
      <div style="font-size:12.5px;color:#475569">Allocate to: Pension top-up (£60k) · ISA fill (£20k) · Marketing investment (£40k) · Cash reserve build (£21k)</div>`)}
    </div>`;
  }

  // ===== DECISION 3-step =====
  else {
    const months = ['Nov-25','Dec-25','Jan-26','Feb-26','Mar-26','Apr-26','May-26','Jun-26','Jul-26','Aug-26','Sep-26','Oct-26'];
    let opening = 220000;
    const rows = months.map(m => {
      const inflow = 230000 + Math.round(Math.random()*30000);
      const outflow = 195000 + Math.round(Math.random()*25000);
      const net = inflow - outflow;
      const closing = opening + net;
      const r = {m, opening, totalPaid:outflow, netCF:net, closing};
      opening = closing;
      return r;
    });
    const totalNet = rows.reduce((s,r)=>s+r.netCF,0);
    const totalPaid = rows.reduce((s,r)=>s+r.totalPaid,0);
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>3-Step Decision Process</b> · Step 1: Reality Check (current position) → Step 2: Maximize & Mitigate → Step 3: Mobilize Excess for Growth</div>
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:auto;margin-bottom:14px">
      <table style="width:100%;font-size:11.5px;border-collapse:collapse;min-width:1100px">
        <thead><tr>
          <th style="padding:10px;text-align:left;background:#0E7C7B;color:#fff;font-weight:700;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;position:sticky;left:0;z-index:1">Line</th>
          ${rows.map(r=>`<th style="padding:10px;text-align:right;background:#0E7C7B;color:#fff;font-weight:700;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase">${r.m}</th>`).join('')}
          <th style="padding:10px;text-align:right;background:#0F172A;color:#fff;font-weight:700;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase">TOTAL</th>
        </tr></thead>
        <tbody>
        <tr><td style="padding:9px;font-weight:600;color:#475569;background:#F8FAFC">Opening Balance</td>${rows.map(r=>`<td style="padding:9px;text-align:right">£${Math.round(r.opening/1000)}k</td>`).join('')}<td style="padding:9px;text-align:right;font-weight:700;background:#F1F5F9">£${Math.round(rows[0].opening/1000)}k</td></tr>
        <tr><td style="padding:9px;font-weight:600;color:#EF4444;background:#F8FAFC">Total Paid (Excl Internal)</td>${rows.map(r=>`<td style="padding:9px;text-align:right;color:#EF4444">£${Math.round(r.totalPaid*0.95/1000)}k</td>`).join('')}<td style="padding:9px;text-align:right;font-weight:700;color:#EF4444;background:#FEE2E2">£${Math.round(totalPaid*0.95/1000)}k</td></tr>
        <tr><td style="padding:9px;font-weight:600;color:#EF4444;background:#F8FAFC">Total Paid</td>${rows.map(r=>`<td style="padding:9px;text-align:right;color:#EF4444">£${Math.round(r.totalPaid/1000)}k</td>`).join('')}<td style="padding:9px;text-align:right;font-weight:700;color:#EF4444;background:#FEE2E2">£${Math.round(totalPaid/1000)}k</td></tr>
        <tr style="border-top:2px solid #E5E7EB"><td style="padding:9px;font-weight:700;color:#0F172A;background:#F1F5F9">Net Cashflow</td>${rows.map(r=>`<td style="padding:9px;text-align:right;font-weight:700;color:${r.netCF>=0?'#10B981':'#EF4444'}">£${Math.round(r.netCF/1000)}k</td>`).join('')}<td style="padding:9px;text-align:right;font-weight:700;color:#0F172A;background:#F1F5F9">£${Math.round(totalNet/1000)}k</td></tr>
        <tr><td style="padding:9px;font-weight:700;color:#0E7C7B;background:#F0FDFA">Closing Projected Balance</td>${rows.map(r=>`<td style="padding:9px;text-align:right;font-weight:700;color:#0E7C7B">£${Math.round(r.closing/1000)}k</td>`).join('')}<td style="padding:9px;text-align:right;font-weight:700;color:#0E7C7B;background:#F0FDFA">£${Math.round(rows[11].closing/1000)}k</td></tr>
        </tbody>
      </table>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
      ${mCard('Step 1: Reality Check', `<div style="font-size:13px;color:#475569;line-height:1.6">Current position: <b>£${Math.round(rows[6].closing/1000)}k</b>. Net cashflow trending positive at £${Math.round(totalNet/12/1000)}k/month avg.</div>`)}
      ${mCard('Step 2: Maximize & Mitigate', `<div style="font-size:13px;color:#475569;line-height:1.6"><b>Maximize:</b> Accelerate AR · 5 invoices >30d overdue = £8k recoverable<br><b>Mitigate:</b> Tax reserve £56k for Jun · DON'T spend Q2 surplus</div>`)}
      ${mCard('Step 3: Mobilize for Growth', `<div style="font-size:13px;color:#475569;line-height:1.6">Excess cash <b>£141k</b> deployable: pension £60k · marketing £40k · CapEx £25k · reserve £16k</div>`)}
    </div>`;
  }

  return mPage('Cash Flow Insights · Past · Present · Future','Deep cash intelligence · Top 3 cash generators · Outliers · Run-out detection · 3-step decision process', `${mBtn('⬇ Download Report','secondary')}${mBtn('🤖 AI Insights','primary')}`) + mTabs(tab, tabs, 'cfiSetTab') + panel + `</div>`;
};
