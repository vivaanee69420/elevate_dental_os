
// ============================================================================
// CHUNK 6 — FINANCE PRO (analyst-grade financial dashboards)
// ============================================================================

window.fpSetTab = function(t) { localStorage.setItem('fp-tab', t); navigate('finance-pro'); };

PAGES['finance-pro'] = () => {
  const tab = localStorage.getItem('fp-tab') || 'cashforecast';
  const tabs = [
    {k:'cashforecast', l:'13-Week Cash Forecast', i:'📅'},
    {k:'variance', l:'Variance Analysis', i:'📊'},
    {k:'ratios', l:'Ratio Dashboard', i:'⚖'},
    {k:'workingcap', l:'Working Capital', i:'💼'},
    {k:'ebitda', l:'EBITDA Reconciliation', i:'📈'},
    {k:'appraisal', l:'Investment Appraisal', i:'🎯'},
    {k:'sensitivity', l:'Sensitivity Analysis', i:'🌡'},
    {k:'cohort', l:'Cohort Revenue', i:'👥'},
    {k:'breakeven', l:'Break-Even', i:'⚡'},
    {k:'capital', l:'Capital Allocation', i:'🧮'},
    {k:'covenants', l:'Loan Covenants', i:'📜'}
  ];

  let panel = '';

  // ===== 13-WEEK CASH FORECAST =====
  if (tab === 'cashforecast') {
    const startCash = 285000;
    const weeks = [];
    let bal = startCash;
    for (let i = 0; i < 13; i++) {
      const wRevenue = 230000 + (Math.random()*40000-20000);
      const wExpenses = 195000 + (Math.random()*15000);
      const wNet = wRevenue - wExpenses;
      bal += wNet;
      weeks.push({week:i+1, revenue:Math.round(wRevenue), expenses:Math.round(wExpenses), net:Math.round(wNet), balance:Math.round(bal)});
    }
    const minBal = Math.min(...weeks.map(w=>w.balance));
    const endBal = weeks[12].balance;
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('💷','Opening Cash','£'+startCash.toLocaleString(),'','today')}
      ${mKpi('📅','Week 13 Ending','£'+endBal.toLocaleString(), endBal>startCash?'+'+(((endBal-startCash)/startCash)*100).toFixed(1)+'%':((endBal-startCash)/startCash*100).toFixed(1)+'%', '13 weeks out')}
      ${mKpi('⬇','Lowest Point','£'+minBal.toLocaleString(),'',minBal<100000?'⚠ tight':'comfortable')}
      ${mKpi('🎯','Min Reserve','£100k', '', 'policy target')}
    </div>
    ${mCard('13-Week Forecast · Rolling', mTable(
      [{l:'Week'},{l:'Inflow',align:'right'},{l:'Outflow',align:'right'},{l:'Net',align:'right'},{l:'Balance',align:'right'},{l:'Status'}],
      weeks.map(w => [
        '<b>W'+w.week+'</b>',
        '£'+w.revenue.toLocaleString(),
        '£'+w.expenses.toLocaleString(),
        `<b style="color:${w.net>=0?'#10B981':'#EF4444'}">${w.net>=0?'+':''}£${w.net.toLocaleString()}</b>`,
        `<b>£${w.balance.toLocaleString()}</b>`,
        w.balance<100000 ? mBadge('Below reserve','danger') : w.balance<200000 ? mBadge('Watch','warn') : mBadge('Healthy','success')
      ])
    ))}`;
  }

  // ===== VARIANCE ANALYSIS =====
  else if (tab === 'variance') {
    const lines = [
      {n:'Patient Revenue · Routine', budget:84000, actual:82400, expl:'2 cancellations from snow week'},
      {n:'Patient Revenue · Cosmetic', budget:120000, actual:142800, expl:'Spring promo overperformed'},
      {n:'Patient Revenue · Implant', budget:180000, actual:165400, expl:'1 case postponed to next month'},
      {n:'Insurance / NHS', budget:48000, actual:50200, expl:'UDA recovery accelerating'},
      {n:'Salaries', budget:142000, actual:138000, expl:'Holiday cover not needed'},
      {n:'Lab Fees', budget:32000, actual:36800, expl:'⚠ Implant lab costs up 15%'},
      {n:'Materials', budget:24000, actual:25200, expl:'Bulk order discount missed'},
      {n:'Marketing', budget:18000, actual:14400, expl:'Ad agency under-spent'},
      {n:'Rent & Utilities', budget:14500, actual:14500, expl:'On budget'},
      {n:'Other OpEx', budget:12000, actual:10800, expl:'Software audit found redundant subs'}
    ];
    panel = `<div style="background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:8px;padding:14px;margin-bottom:14px;font-size:13px;color:#92400E"><b>🤖 AI Flag:</b> 2 lines materially off-budget. Lab Fees +15% needs supplier review. Cosmetic Revenue +19% — consider increasing promo budget.</div>
    ${mCard('Budget vs Actual · MTD', mTable(
      [{l:'Line'},{l:'Budget',align:'right'},{l:'Actual',align:'right'},{l:'Variance £',align:'right'},{l:'Variance %',align:'right'},{l:'Explanation'}],
      lines.map(l => {
        const variance = l.actual - l.budget;
        const pct = (variance/l.budget*100);
        const isRevenue = l.n.includes('Revenue') || l.n.includes('Insurance');
        const good = isRevenue ? variance >= 0 : variance <= 0;
        const color = Math.abs(pct) < 2 ? '#64748B' : good ? '#10B981' : '#EF4444';
        return [
          '<b>'+l.n+'</b>',
          '£'+l.budget.toLocaleString(),
          '£'+l.actual.toLocaleString(),
          `<b style="color:${color}">${variance>=0?'+':''}£${variance.toLocaleString()}</b>`,
          `<b style="color:${color}">${pct>=0?'+':''}${pct.toFixed(1)}%</b>`,
          `<span style="font-size:12px;color:#475569">${l.expl}</span>`
        ];
      })
    ))}`;
  }

  // ===== RATIOS =====
  else if (tab === 'ratios') {
    const ratios = [
      {name:'Current Ratio', value:2.4, target:'≥1.5', desc:'Current Assets / Current Liabilities', status:'good'},
      {name:'Quick Ratio', value:1.8, target:'≥1.0', desc:'(Current Assets - Inventory) / Current Liabilities', status:'good'},
      {name:'Debt-to-Equity', value:0.42, target:'≤0.5', desc:'Total Debt / Total Equity', status:'good'},
      {name:'Interest Coverage', value:8.2, target:'≥3', desc:'EBIT / Interest Expense', status:'good'},
      {name:'Gross Margin %', value:78, target:'≥70%', desc:'(Revenue - COGS) / Revenue', status:'good'},
      {name:'Operating Margin %', value:22, target:'≥18%', desc:'Operating Profit / Revenue', status:'good'},
      {name:'Net Margin %', value:17.5, target:'≥15%', desc:'Net Profit / Revenue', status:'good'},
      {name:'ROE %', value:24.8, target:'≥15%', desc:'Net Profit / Equity', status:'good'},
      {name:'ROA %', value:14.2, target:'≥10%', desc:'Net Profit / Total Assets', status:'good'},
      {name:'ROIC %', value:18.4, target:'≥12%', desc:'NOPAT / Invested Capital', status:'good'},
      {name:'Asset Turnover', value:1.32, target:'≥1.0', desc:'Revenue / Total Assets', status:'good'},
      {name:'EBITDA Margin %', value:28.4, target:'≥25%', desc:'EBITDA / Revenue', status:'good'}
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      ${ratios.map(r => `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${r.status==='good'?'#10B981':r.status==='warn'?'#F59E0B':'#EF4444'};border-radius:10px;padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">${r.name}</div>
          <span style="font-size:10px;font-weight:700;padding:2px 7px;background:${r.status==='good'?'#ECFDF5':'#FEF3C7'};color:${r.status==='good'?'#065F46':'#92400E'};border-radius:4px">Target ${r.target}</span>
        </div>
        <div style="font-size:28px;font-weight:700;color:#0F172A;letter-spacing:-.02em">${typeof r.value==='number' && r.value < 10 ? r.value.toFixed(2) : Math.round(r.value)}${r.name.includes('%')?'%':r.name.includes('Ratio')||r.name.includes('Coverage')||r.name.includes('Turnover')?'':''}</div>
        <div style="font-size:11.5px;color:#64748B;margin-top:4px;line-height:1.4">${r.desc}</div>
      </div>`).join('')}
    </div>`;
  }

  // ===== WORKING CAPITAL =====
  else if (tab === 'workingcap') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('📥','DSO', '32 days', '↘ -4', 'Days Sales Outstanding')}
      ${mKpi('📤','DPO', '48 days', '↗ +6', 'Days Payable Outstanding')}
      ${mKpi('📦','DIO', '12 days', '', 'Days Inventory Outstanding · materials')}
      ${mKpi('🔁','Cash Cycle', '-4 days', '↘ -10', 'Negative = excellent')}
    </div>
    ${mCard('Working Capital Components', mTable(
      [{l:'Component'},{l:'Value',align:'right'},{l:'Days',align:'right'},{l:'Status'}],
      [
        ['<b>Accounts Receivable</b> (patient debt, insurance)', '£245,000', '32', mBadge('Improving','success')],
        ['<b>Accounts Payable</b> (lab fees, suppliers)', '£368,000', '48', mBadge('Stretched optimally','info')],
        ['<b>Inventory</b> (materials, stock)', '£42,000', '12', mBadge('Lean','success')],
        ['<b>Net Working Capital</b>', '<b>-£81,000</b>', '<b>-4</b>', mBadge('Negative cycle = excellent','success')]
      ]
    ))}
    <div style="margin-top:14px">${mCard('Receivables Aging', mTable(
      [{l:'Aging Bucket'},{l:'Amount',align:'right'},{l:'% of Total',align:'right'},{l:'Action'}],
      [
        ['0-30 days','£148,000','60%','Normal'],
        ['31-60 days','£62,000','25%','Reminder sent'],
        ['61-90 days','£24,000','10%','Phone follow-up'],
        ['90+ days','£11,000','5%','<b style="color:#EF4444">⚠ Escalate to debt recovery</b>']
      ]
    ))}</div>`;
  }

  // ===== EBITDA RECONCILIATION =====
  else if (tab === 'ebitda') {
    const lines = [
      ['Net Profit (after tax)', 188400, 'pos'],
      ['+ Tax', 56500, 'pos'],
      ['+ Interest Expense', 14200, 'pos'],
      ['= EBIT (Operating Profit)', 259100, 'subtotal'],
      ['+ Depreciation', 42000, 'pos'],
      ['+ Amortisation', 8500, 'pos'],
      ['= EBITDA (reported)', 309600, 'subtotal'],
      ['+ One-off legal fees (acquisition)', 18000, 'addback'],
      ['+ Director excess remuneration', 24000, 'addback'],
      ['+ Family member salary at market rate', 12000, 'addback'],
      ['+ Rent paid to related party (above market)', 6000, 'addback'],
      ['- One-off insurance rebate', -8400, 'addback'],
      ['= Adjusted EBITDA', 361200, 'total']
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('💼','EBITDA','£309,600','+18%','reported')}
      ${mKpi('✨','Adj. EBITDA','£361,200','','add-backs included')}
      ${mKpi('📈','Adj. Margin','28.5%','','of revenue')}
    </div>
    ${mCard('EBITDA Walk · Net Profit → Adjusted EBITDA', mTable(
      [{l:'Line'},{l:'Amount £',align:'right'}],
      lines.map(([l,v,t]) => {
        let style = '';
        let bg = '';
        if (t === 'subtotal') { style = 'font-weight:700;color:#0F172A'; bg = 'background:#F1F5F9'; }
        if (t === 'total') { style = 'font-weight:700;color:#fff'; bg = 'background:#0E7C7B;color:#fff'; }
        if (t === 'addback') style = 'color:#92400E;font-style:italic';
        return [
          `<span style="${style}">${l}</span>`,
          `<span style="${style}"><b>${v>=0?'£':'-£'}${Math.abs(v).toLocaleString()}</b></span>`
        ];
      })
    ), '<span style="font-size:11.5px;color:#64748B">Add-backs adjusted for one-offs and related-party items · used for valuation</span>')}`;
  }

  // ===== INVESTMENT APPRAISAL =====
  else if (tab === 'appraisal') {
    const projects = [
      {name:'New CBCT Scanner', capex:78000, annualCash:42000, years:7, npv:152800, irr:42, payback:1.9, status:'good'},
      {name:'6th Surgery Build-out', capex:185000, annualCash:96000, years:10, npv:418200, irr:48, payback:1.9, status:'good'},
      {name:'CAD/CAM Same-day Crowns', capex:120000, annualCash:48000, years:8, npv:182400, irr:35, payback:2.5, status:'good'},
      {name:'Practice Acquisition (Site 6)', capex:520000, annualCash:148000, years:10, npv:485000, irr:24, payback:3.5, status:'good'},
      {name:'New Patient Marketing System', capex:24000, annualCash:18000, years:5, npv:48200, irr:65, payback:1.3, status:'good'}
    ];
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;border-radius:8px;padding:14px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>💡 Hurdle rate:</b> 15% (cost of capital). NPV calculated at 10% discount. IRR > hurdle = invest.</div>
    ${mCard('Capital Project Pipeline', mTable(
      [{l:'Project'},{l:'CapEx',align:'right'},{l:'Annual Cash Flow',align:'right'},{l:'Years',align:'right'},{l:'NPV @ 10%',align:'right'},{l:'IRR %',align:'right'},{l:'Payback',align:'right'},{l:'Decision'}],
      projects.map(p => [
        '<b>'+p.name+'</b>',
        '£'+p.capex.toLocaleString(),
        '£'+p.annualCash.toLocaleString(),
        p.years.toString(),
        `<b style="color:#10B981">£${p.npv.toLocaleString()}</b>`,
        `<b style="color:${p.irr>=15?'#10B981':'#EF4444'}">${p.irr}%</b>`,
        p.payback+' yrs',
        p.irr>=20 ? mBadge('✓ Approve','success') : p.irr>=15 ? mBadge('Approve','info') : mBadge('Reject','danger')
      ])
    ))}
    <div style="margin-top:14px">${mCard('Calculator', `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
      ${[['Initial CapEx (£)','80000'],['Annual Cash Flow (£)','40000'],['Years','7'],['Discount Rate %','10']].map(([l,v])=>`<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">${l}</label><input type="number" value="${v}" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13.5px"></div>`).join('')}
    </div><div style="margin-top:12px">${mBtn('⚡ Calculate NPV / IRR / Payback','primary')}</div>`)}</div>`;
  }

  // ===== SENSITIVITY ANALYSIS =====
  else if (tab === 'sensitivity') {
    const scenarios = [
      {n:'Best Case', rev:'+15%', cost:'-5%', profit:582000, npv:8200000, c:'#10B981'},
      {n:'Base Case', rev:'0%', cost:'0%', profit:420000, npv:5800000, c:'#3B82F6'},
      {n:'Mild Downside', rev:'-10%', cost:'+5%', profit:285000, npv:3900000, c:'#F59E0B'},
      {n:'Recession', rev:'-25%', cost:'+10%', profit:98000, npv:1200000, c:'#EF4444'},
      {n:'Severe Stress', rev:'-40%', cost:'+15%', profit:-65000, npv:-580000, c:'#991B1B'}
    ];
    panel = `${mCard('Scenario Analysis · Annual Outcomes', mTable(
      [{l:'Scenario'},{l:'Revenue Δ',align:'right'},{l:'Cost Δ',align:'right'},{l:'Operating Profit',align:'right'},{l:'10yr NPV',align:'right'},{l:'Status'}],
      scenarios.map(s => [
        `<b style="color:${s.c}">${s.n}</b>`,
        s.rev, s.cost,
        `<b style="color:${s.profit>=0?'#10B981':'#EF4444'}">£${s.profit.toLocaleString()}</b>`,
        `<b>£${s.npv.toLocaleString()}</b>`,
        s.profit>200000?mBadge('Healthy','success'):s.profit>0?mBadge('Survive','warn'):mBadge('Loss','danger')
      ])
    ))}
    <div style="margin-top:14px">${mCard('Sensitivity Table · Profit £ at varying Revenue / Margin', `<table style="width:100%;font-size:12px;border-collapse:collapse">
      <thead><tr><th style="padding:8px;text-align:left;background:#F8FAFC;font-weight:700;border:1px solid #E5E7EB;color:#475569;text-transform:uppercase;font-size:10.5px;letter-spacing:.04em">Rev/Margin</th>
      ${['15%','18%','22%','26%','30%'].map(m=>`<th style="padding:8px;text-align:right;background:#F8FAFC;font-weight:700;border:1px solid #E5E7EB;color:#475569;text-transform:uppercase;font-size:10.5px;letter-spacing:.04em">${m}</th>`).join('')}</tr></thead>
      <tbody>
      ${[-20,-10,0,10,20].map(r => `<tr>
        <td style="padding:8px;border:1px solid #E5E7EB;font-weight:700;color:#475569;background:#F8FAFC">${r>=0?'+':''}${r}%</td>
        ${[0.15,0.18,0.22,0.26,0.30].map(m => {
          const baseRev = 2200000;
          const adjRev = baseRev * (1 + r/100);
          const profit = adjRev * m;
          const cell = profit > 500000 ? '#ECFDF5' : profit > 200000 ? '#FEF3C7' : '#FEE2E2';
          return `<td style="padding:8px;text-align:right;border:1px solid #E5E7EB;background:${cell};font-weight:600;color:#0F172A">£${Math.round(profit/1000)}k</td>`;
        }).join('')}
      </tr>`).join('')}
      </tbody>
    </table>`)}</div>`;
  }

  // ===== COHORT REVENUE =====
  else if (tab === 'cohort') {
    const cohorts = [
      {n:'Q1 2024', size:124, m1:142, m3:218, m6:340, m12:520, ltv:1840},
      {n:'Q2 2024', size:142, m1:165, m3:248, m6:380, m12:548, ltv:1920},
      {n:'Q3 2024', size:158, m1:178, m3:264, m6:412, m12:580, ltv:1980},
      {n:'Q4 2024', size:148, m1:172, m3:258, m6:395, m12:548, ltv:1960},
      {n:'Q1 2025', size:184, m1:212, m3:318, m6:468, m12:'-', ltv:'projecting'},
      {n:'Q2 2025', size:198, m1:228, m3:340, m6:'-', m12:'-', ltv:'projecting'},
      {n:'Q3 2025', size:172, m1:198, m3:'-', m6:'-', m12:'-', ltv:'projecting'},
      {n:'Q4 2025', size:206, m1:'-', m3:'-', m6:'-', m12:'-', ltv:'projecting'}
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('👥','Patients Acquired (12mo)', '764', '+18%', 'all cohorts')}
      ${mKpi('£','Avg 12mo LTV', '£1,940', '+8%', 'across cohorts')}
      ${mKpi('📈','Best Cohort', 'Q3 2024', '', '£1,980 LTV')}
      ${mKpi('🔁','Cohort Retention', '78%', '+4%', '12-month')}
    </div>
    ${mCard('Cohort Revenue · £ per cohort over time', mTable(
      [{l:'Cohort'},{l:'Size',align:'right'},{l:'Mo 1 £',align:'right'},{l:'Mo 3 £',align:'right'},{l:'Mo 6 £',align:'right'},{l:'Mo 12 £',align:'right'},{l:'12mo LTV',align:'right'}],
      cohorts.map(c => [
        '<b>'+c.n+'</b>',
        c.size.toString(),
        c.m1==='-'?'—':'£'+c.m1,
        c.m3==='-'?'—':'£'+c.m3,
        c.m6==='-'?'—':'£'+c.m6,
        c.m12==='-'?'—':'£'+c.m12,
        typeof c.ltv === 'number' ? '<b>£'+c.ltv.toLocaleString()+'</b>' : '<span style="color:#94A3B8">'+c.ltv+'</span>'
      ])
    ))}`;
  }

  // ===== BREAK-EVEN =====
  else if (tab === 'breakeven') {
    const treatments = [
      {n:'Routine Exam', price:65, varCost:8, contribution:57, fixedAllocated:18000, beUnits:316},
      {n:'Hygiene', price:90, varCost:15, contribution:75, fixedAllocated:14000, beUnits:187},
      {n:'Composite Filling', price:185, varCost:32, contribution:153, fixedAllocated:22000, beUnits:144},
      {n:'Crown', price:680, varCost:185, contribution:495, fixedAllocated:18000, beUnits:37},
      {n:'Implant (single)', price:2400, varCost:680, contribution:1720, fixedAllocated:42000, beUnits:25},
      {n:'Full Arch', price:18500, varCost:4200, contribution:14300, fixedAllocated:24000, beUnits:2},
      {n:'Invisalign', price:3800, varCost:1100, contribution:2700, fixedAllocated:38000, beUnits:15}
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('🎯','Group Break-Even','£186,400','','monthly revenue needed')}
      ${mKpi('💷','Current Revenue','£610,000','','MTD')}
      ${mKpi('📈','Margin of Safety','69%','','above break-even')}
    </div>
    ${mCard('Treatment-Level Break-Even', mTable(
      [{l:'Treatment'},{l:'Price',align:'right'},{l:'Variable Cost',align:'right'},{l:'Contribution',align:'right'},{l:'Fixed Cost',align:'right'},{l:'BE Units',align:'right'},{l:'Margin'}],
      treatments.map(t => [
        '<b>'+t.n+'</b>',
        '£'+t.price.toLocaleString(),
        '£'+t.varCost.toLocaleString(),
        '<b>£'+t.contribution.toLocaleString()+'</b>',
        '£'+t.fixedAllocated.toLocaleString(),
        '<b>'+t.beUnits+'</b>',
        ((t.contribution/t.price)*100).toFixed(0)+'%'
      ])
    ))}`;
  }

  // ===== CAPITAL ALLOCATION =====
  else if (tab === 'capital') {
    const buckets = [
      {n:'Reinvest in business · capex', pct:40, amount:148000, color:'#0E7C7B', desc:'Equipment · 2nd location · expansion'},
      {n:'Owner extraction (dividend)', pct:25, amount:92500, color:'#F59E0B', desc:'Personal income · lifestyle'},
      {n:'Pension contribution', pct:15, amount:55500, color:'#10B981', desc:'£60k annual allowance · tax-efficient'},
      {n:'Debt repayment', pct:10, amount:37000, color:'#EF4444', desc:'Above minimum required · interest savings'},
      {n:'Investment portfolio', pct:5, amount:18500, color:'#3B82F6', desc:'ISA · GIA · stocks · diversification'},
      {n:'Cash reserve build', pct:5, amount:18500, color:'#8B5CF6', desc:'Min 3 months opex buffer'}
    ];
    panel = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px">
      <h3 style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 12px">Where every £1 of profit goes</h3>
      <div style="display:flex;align-items:center;height:32px;border-radius:8px;overflow:hidden;margin-bottom:14px">
        ${buckets.map(b=>`<div style="width:${b.pct}%;background:${b.color};display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">${b.pct}%</div>`).join('')}
      </div>
      ${buckets.map(b=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #F1F5F9">
        <div style="width:12px;height:12px;background:${b.color};border-radius:3px"></div>
        <div style="flex:1"><div style="font-weight:600;font-size:13.5px;color:#0F172A">${b.n}</div><div style="font-size:11.5px;color:#64748B">${b.desc}</div></div>
        <div style="text-align:right"><div style="font-weight:700;font-size:14px;color:#0F172A">£${b.amount.toLocaleString()}</div><div style="font-size:11px;color:#64748B">${b.pct}%</div></div>
      </div>`).join('')}
    </div>
    ${mCard('Allocation Targets', `<div style="font-size:13px;color:#475569;line-height:1.7">Annual profit pool: <b>£370,000</b> · Allocation reviewed quarterly · Targets editable in Settings · AI suggests rebalancing when actual drifts >5% from policy.</div>`)}`;
  }

  // ===== LOAN COVENANTS =====
  else if (tab === 'covenants') {
    const covenants = [
      {n:'Interest Cover Ratio', threshold:'≥3.0×', actual:8.2, status:'good', loan:'Working Capital Facility'},
      {n:'Debt Service Coverage', threshold:'≥1.25×', actual:2.4, status:'good', loan:'Equipment Finance'},
      {n:'EBITDA / Debt', threshold:'≥0.25', actual:0.62, status:'good', loan:'Working Capital Facility'},
      {n:'Min Cash Balance', threshold:'≥£100k', actual:285000, status:'good', loan:'All facilities'},
      {n:'Loan-to-Value (Property)', threshold:'≤75%', actual:48, status:'good', loan:'Property Mortgage', display:'%'},
      {n:'Director Guarantee', threshold:'Required', actual:'In place', status:'good', loan:'Working Capital Facility'},
      {n:'Quarterly Mgmt Accounts', threshold:'Required', actual:'Q3 submitted on time', status:'good', loan:'All facilities'}
    ];
    panel = `${mCard('Loan Covenants Tracking', mTable(
      [{l:'Covenant'},{l:'Loan'},{l:'Threshold',align:'right'},{l:'Actual',align:'right'},{l:'Headroom',align:'right'},{l:'Status'}],
      covenants.map(c => [
        '<b>'+c.n+'</b>',
        '<span style="font-size:12px;color:#64748B">'+c.loan+'</span>',
        c.threshold,
        typeof c.actual === 'number' ? (c.display==='%' ? c.actual+'%' : c.actual<100 ? c.actual.toFixed(2) : '£'+c.actual.toLocaleString()) : c.actual,
        '<b style="color:#10B981">Significant ✓</b>',
        mBadge('Compliant','success')
      ])
    ))}
    <div style="margin-top:14px;background:#ECFDF5;border-left:3px solid #10B981;padding:14px;border-radius:8px;font-size:13px;color:#065F46"><b>✓ All covenants compliant.</b> Next quarterly submission due in 28 days. Auto-reminder scheduled.</div>`;
  }

  return mPage('Finance Pro · Analyst Dashboards','Forward cash forecasts · variance · ratios · NPV/IRR · cohorts · sensitivity · covenants', `${mBtn('⬇ Export model','secondary')}${mBtn('🤖 AI insights','primary')}`) + mTabs(tab, tabs, 'fpSetTab') + panel + `</div>`;
};
