
// ============================================================================
// CHUNK 7 — WEALTH PRO (estate · insurance · drift · risk-adjusted returns · FIC)
// ============================================================================

window.wpSetTab = function(t) { localStorage.setItem('wp-tab', t); navigate('wealth-pro'); };

PAGES['wealth-pro'] = () => {
  const tab = localStorage.getItem('wp-tab') || 'drift';
  const tabs = [
    {k:'drift', l:'Allocation Drift', i:'🎯'},
    {k:'risk', l:'Risk Metrics', i:'⚖'},
    {k:'estate', l:'Estate Planning', i:'📜'},
    {k:'insurance', l:'Insurance Gap', i:'🛡'},
    {k:'fic', l:'Family Investment Co.', i:'👨‍👩‍👧'},
    {k:'tlh', l:'Tax-Loss Harvest', i:'✂'},
    {k:'inflation', l:'Inflation Impact', i:'📉'},
    {k:'sequence', l:'Sequence Risk', i:'📊'},
    {k:'lisajisa', l:'LISA / JISA', i:'🧒'},
    {k:'fx', l:'Currency Exposure', i:'🌍'},
    {k:'poa', l:'POA & Beneficiaries', i:'⚖'}
  ];

  let panel = '';

  // ===== ALLOCATION DRIFT =====
  if (tab === 'drift') {
    const allocations = [
      {n:'UK Equities', target:25, actual:31, diff:6, action:'Trim 6%', c:'#10B981'},
      {n:'US Equities', target:20, actual:24, diff:4, action:'Trim 4%', c:'#3B82F6'},
      {n:'Global ex-US Equities', target:15, actual:11, diff:-4, action:'Add 4%', c:'#8B5CF6'},
      {n:'UK Bonds', target:15, actual:9, diff:-6, action:'Add 6%', c:'#F59E0B'},
      {n:'Property (REITs + BTL)', target:15, actual:18, diff:3, action:'Hold', c:'#EC4899'},
      {n:'Cash / Money Market', target:5, actual:4, diff:-1, action:'Hold', c:'#94A3B8'},
      {n:'Crypto', target:3, actual:2, diff:-1, action:'Hold', c:'#F97316'},
      {n:'Alternatives (Gold, Commodity)', target:2, actual:1, diff:-1, action:'Hold', c:'#64748B'}
    ];
    const driftCount = allocations.filter(a => Math.abs(a.diff) > 3).length;
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('🎯','Asset Classes Tracked', allocations.length.toString(), '', 'monitored')}
      ${mKpi('⚠','Material Drift', driftCount.toString(), '', '>3% off target')}
      ${mKpi('🔄','Last Rebalance', '94 days ago', '', 'recommended: quarterly')}
      ${mKpi('💷','Total Portfolio', '£740,000', '+8.2%', 'YTD')}
    </div>
    ${mCard('Allocation Drift · Target vs Actual', mTable(
      [{l:'Asset Class'},{l:'Target %',align:'right'},{l:'Actual %',align:'right'},{l:'Drift',align:'right'},{l:'Visual'},{l:'Action'}],
      allocations.map(a => [
        `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:${a.c};border-radius:2px"></span><b>${a.n}</b></span>`,
        a.target+'%',
        '<b>'+a.actual+'%</b>',
        `<b style="color:${Math.abs(a.diff)>3?'#EF4444':Math.abs(a.diff)>1?'#F59E0B':'#10B981'}">${a.diff>=0?'+':''}${a.diff}%</b>`,
        `<div style="position:relative;width:120px;height:16px;background:#F1F5F9;border-radius:8px;overflow:hidden"><div style="position:absolute;left:0;top:0;height:100%;width:${a.actual*2}%;background:${a.c}aa;border-radius:8px"></div><div style="position:absolute;left:${a.target*2}%;top:0;height:100%;width:2px;background:#0F172A"></div></div>`,
        Math.abs(a.diff)>3 ? `<b style="color:#EF4444">${a.action}</b>` : a.action
      ])
    ))}
    <div style="margin-top:14px;background:#FEF3C7;border-left:3px solid #F59E0B;padding:14px;border-radius:8px;font-size:13px;color:#92400E"><b>🔔 Rebalance suggested.</b> 4 asset classes >3% off target. Trim UK + US equities (+10% combined overweight), add Global ex-US + UK Bonds. Estimated tax cost in GIA: £840 CGT.</div>`;
  }

  // ===== RISK METRICS =====
  else if (tab === 'risk') {
    const metrics = [
      {n:'Portfolio Beta', value:0.92, target:'~1.0', desc:'Sensitivity to market moves · 1.0 = same as market'},
      {n:'Sharpe Ratio', value:1.42, target:'>1.0', desc:'Risk-adjusted return · higher = better'},
      {n:'Sortino Ratio', value:1.84, target:'>1.5', desc:'Downside risk-adjusted return'},
      {n:'Max Drawdown', value:-18.4, target:'>-25%', desc:'Worst peak-to-trough in last 5yrs', display:'%'},
      {n:'Standard Deviation', value:12.8, target:'<15%', desc:'Volatility · annualised', display:'%'},
      {n:'Value at Risk (95%)', value:-42000, target:'<-£60k', desc:'Worst expected 1yr loss at 95% confidence', display:'£'},
      {n:'Correlation to FTSE', value:0.78, target:'<0.85', desc:'How tied to UK market'},
      {n:'Diversification Score', value:8.4, target:'>7', desc:'Out of 10 · spread across asset classes'}
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      ${metrics.map(m => `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid #0E7C7B;border-radius:10px;padding:14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">${m.n}</div>
          <span style="font-size:10px;font-weight:700;padding:2px 7px;background:#F0FDFA;color:#0E7C7B;border-radius:4px">Target ${m.target}</span>
        </div>
        <div style="font-size:24px;font-weight:700;color:#0F172A;letter-spacing:-.02em">${m.display==='£'?'£'+Math.abs(m.value).toLocaleString():m.display==='%'?m.value+'%':m.value}</div>
        <div style="font-size:11.5px;color:#64748B;margin-top:4px;line-height:1.4">${m.desc}</div>
      </div>`).join('')}
    </div>`;
  }

  // ===== ESTATE PLANNING =====
  else if (tab === 'estate') {
    const grossEstate = 8400000;
    const nilRateBand = 325000;
    const residenceBand = 175000;
    const totalNilRate = nilRateBand + residenceBand;
    const taxableEstate = grossEstate - totalNilRate;
    const ihtDue = Math.max(0, taxableEstate * 0.40);
    panel = `<div style="background:linear-gradient(135deg,#FEF3C7,#FED7AA);border:1px solid #F59E0B;border-radius:14px;padding:24px;margin-bottom:18px">
      <h3 style="font-size:16px;font-weight:700;color:#92400E;margin:0 0 14px">Estate Snapshot · IHT Exposure</h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
        <div><div style="font-size:11px;text-transform:uppercase;color:#92400E;font-weight:700">Gross Estate</div><div style="font-size:24px;font-weight:700;color:#0F172A;margin-top:3px">£${(grossEstate/1000000).toFixed(2)}M</div></div>
        <div><div style="font-size:11px;text-transform:uppercase;color:#92400E;font-weight:700">Nil-Rate Bands</div><div style="font-size:24px;font-weight:700;color:#10B981;margin-top:3px">£${totalNilRate.toLocaleString()}</div></div>
        <div><div style="font-size:11px;text-transform:uppercase;color:#92400E;font-weight:700">Taxable</div><div style="font-size:24px;font-weight:700;color:#0F172A;margin-top:3px">£${(taxableEstate/1000000).toFixed(2)}M</div></div>
        <div><div style="font-size:11px;text-transform:uppercase;color:#EF4444;font-weight:700">IHT Due @ 40%</div><div style="font-size:24px;font-weight:700;color:#EF4444;margin-top:3px">£${(ihtDue/1000000).toFixed(2)}M</div></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      ${mCard('Estate Planning Documents', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${[
          ['Will · Current version', '✓ Updated Jan 2026', '#10B981'],
          ['Letter of Wishes', '✓ On file', '#10B981'],
          ['Lasting Power of Attorney · Property', '✓ Registered', '#10B981'],
          ['Lasting Power of Attorney · Health', '⚠ Not registered', '#EF4444'],
          ['Trust Deed (Discretionary)', '⚠ Not in place', '#F59E0B'],
          ['Business Property Relief letter', '✓ Solicitor confirmed', '#10B981']
        ].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px"><span>${l}</span><b style="color:${c}">${v}</b></div>`).join('')}
      </div>`)}
      ${mCard('7-Year Gift Tracker', `<div style="font-size:13px;color:#475569">
        ${[
          {amt:60000, yrs:6.2, status:'1.2yrs to exempt'},
          {amt:120000, yrs:4.8, status:'2.6yrs to exempt'},
          {amt:25000, yrs:2.4, status:'5yrs · 60% IHT taper'},
          {amt:8000, yrs:0.6, status:'Recent · full IHT'}
        ].map(g=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px;margin-bottom:6px"><div><b>£${g.amt.toLocaleString()}</b><div style="font-size:11px;color:#64748B">${g.yrs} years ago</div></div><span style="font-size:11px;color:#64748B">${g.status}</span></div>`).join('')}
      </div>`)}
    </div>
    ${mCard('IHT Mitigation Strategies', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:13px;color:#475569;line-height:1.55">
      <div><b style="color:#0F172A">🎁 7-Year Gifts (PETs)</b><br>Outright gifts taper after 3 years · fully exempt after 7. Track regularly · max impact via large early gifts.</div>
      <div><b style="color:#0F172A">🏢 Business Property Relief (BPR)</b><br>100% IHT relief on trading businesses held 2+ years. Your dental group qualifies. Verify trading status annually.</div>
      <div><b style="color:#0F172A">💰 Pension</b><br>Outside estate for IHT. Beneficiaries pay income tax only if you die after 75. Max pension contributions before drawdown.</div>
      <div><b style="color:#0F172A">🏠 Family Trust</b><br>Discretionary trust for next generation · 20% entry charge above NRB · 6% periodic charge. Worth exploring for £8M+ estates.</div>
      <div><b style="color:#0F172A">💍 Spouse Exemption</b><br>100% transferable nil-rate band to spouse · combined £1M with residence relief. Ensure both wills updated.</div>
      <div><b style="color:#0F172A">📜 Family Investment Company (FIC)</b><br>Lower-tax wrapper for accumulating family wealth · alphabet shares for income flexibility · see FIC tab.</div>
    </div>`)}`;
  }

  // ===== INSURANCE GAP =====
  else if (tab === 'insurance') {
    const policies = [
      {n:'Life Cover · Owner', current:500000, recommended:2000000, type:'Term Life', provider:'Vitality', monthly:84, status:'underinsured'},
      {n:'Life Cover · Co-owner', current:250000, recommended:1500000, type:'Term Life', provider:'L&G', monthly:62, status:'underinsured'},
      {n:'Critical Illness · Owner', current:100000, recommended:500000, type:'CI', provider:'Vitality', monthly:48, status:'underinsured'},
      {n:'Income Protection · Owner', current:6000, recommended:10000, type:'IP (monthly)', provider:'Royal London', monthly:120, status:'underinsured'},
      {n:'Key Person · Owner', current:0, recommended:1000000, type:'Key Person', provider:'Not in place', monthly:0, status:'missing'},
      {n:'Key Person · Clinical Lead', current:0, recommended:500000, type:'Key Person', provider:'Not in place', monthly:0, status:'missing'},
      {n:'Shareholder Protection', current:0, recommended:2000000, type:'Cross Option', provider:'Not in place', monthly:0, status:'missing'},
      {n:'Relevant Life Plan', current:0, recommended:1000000, type:'Tax-efficient term', provider:'Not in place', monthly:0, status:'missing'},
      {n:'Professional Indemnity · Clinicians', current:10000000, recommended:10000000, type:'Indemnity', provider:'Dental Protection', monthly:520, status:'adequate'},
      {n:'Practice Insurance', current:5000000, recommended:5000000, type:'Combined', provider:'NFU Mutual', monthly:340, status:'adequate'}
    ];
    const gap = policies.reduce((s,p)=>s + Math.max(0, p.recommended - p.current), 0);
    panel = `<div style="background:#FEE2E2;border:1px solid #EF4444;border-radius:14px;padding:18px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;color:#991B1B;letter-spacing:.04em">Total Cover Gap</div>
        <div style="font-size:32px;font-weight:700;color:#991B1B;letter-spacing:-.02em">£${gap.toLocaleString()}</div>
        <div style="font-size:12.5px;color:#991B1B;margin-top:2px">Shortfall between current and recommended cover · review with adviser</div>
      </div>
      ${mBtn('📞 Book IFA review','primary')}
    </div>
    ${mCard('Insurance Portfolio', mTable(
      [{l:'Policy'},{l:'Current Cover',align:'right'},{l:'Recommended',align:'right'},{l:'Gap',align:'right'},{l:'Type'},{l:'Monthly £',align:'right'},{l:'Status'}],
      policies.map(p => {
        const gap = Math.max(0, p.recommended - p.current);
        return [
          '<b>'+p.n+'</b>',
          '£'+p.current.toLocaleString(),
          '£'+p.recommended.toLocaleString(),
          gap>0 ? `<b style="color:#EF4444">£${gap.toLocaleString()}</b>` : '<span style="color:#10B981">£0</span>',
          '<span style="font-size:12px;color:#64748B">'+p.type+'</span>',
          p.monthly>0 ? '£'+p.monthly : '—',
          p.status==='adequate'?mBadge('Adequate','success'):p.status==='underinsured'?mBadge('Underinsured','warn'):mBadge('Missing','danger')
        ];
      })
    ))}`;
  }

  // ===== FAMILY INVESTMENT COMPANY =====
  else if (tab === 'fic') {
    panel = `<div style="background:linear-gradient(135deg,#0E7C7B,#0F766E);color:#fff;border-radius:14px;padding:24px;margin-bottom:18px">
      <h3 style="font-size:18px;font-weight:700;margin:0 0 6px;letter-spacing:-.01em">Family Investment Company (FIC) Tracker</h3>
      <p style="font-size:13px;opacity:.9;margin:0;line-height:1.5">Lower-tax structure for accumulating family wealth and passing it down. Useful when estate is >£3M and you want flexibility over income distribution.</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('🏢','FIC Status','Active','','est. Mar 2023')}
      ${mKpi('💷','Assets in FIC','£420,000','+18%','YTD')}
      ${mKpi('🧒','Children Shareholders','3','','Class B alphabet shares')}
      ${mKpi('💰','Corporation Tax Saved','£28,400','','vs personal tax')}
    </div>
    ${mCard('Shareholding Structure', mTable(
      [{l:'Shareholder'},{l:'Share Class'},{l:'Voting %',align:'right'},{l:'Economic %',align:'right'},{l:'Value',align:'right'}],
      [
        ['<b>Owner</b>','A Ordinary (voting)','100%','40%','£168,000'],
        ['<b>Spouse</b>','B Ordinary','0%','30%','£126,000'],
        ['<b>Child 1</b>','C Ordinary','0%','12%','£50,400'],
        ['<b>Child 2</b>','D Ordinary','0%','12%','£50,400'],
        ['<b>Child 3</b>','E Ordinary','0%','6%','£25,200']
      ]
    ))}
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('FIC Investments', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${[
          ['Global Equity Portfolio', '£245,000', '#10B981'],
          ['UK Bond Fund', '£68,000', '#3B82F6'],
          ['Property (REIT)', '£62,000', '#8B5CF6'],
          ['Cash Reserve', '£45,000', '#64748B']
        ].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px"><span><span style="display:inline-block;width:8px;height:8px;background:${c};border-radius:50%;margin-right:8px"></span>${l}</span><b>${v}</b></div>`).join('')}
      </div>`)}
      ${mCard('Annual Reviews', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${[
          ['CT600 filed', '15 Sep 2025', '#10B981'],
          ['Confirmation Statement', '12 Oct 2025', '#10B981'],
          ['Director Loan Account', 'In credit £24k', '#10B981'],
          ['Dividend Strategy', 'Next: April 2026', '#3B82F6'],
          ['Articles Review', 'Due in 2026', '#F59E0B']
        ].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px"><span>${l}</span><b style="color:${c}">${v}</b></div>`).join('')}
      </div>`)}
    </div>`;
  }

  // ===== TAX LOSS HARVEST =====
  else if (tab === 'tlh') {
    const positions = [
      {n:'Tech Growth Fund', cost:28000, current:21000, unrealized:-7000, type:'GIA',action:'Harvest now · use £7k loss'},
      {n:'Emerging Markets Index', cost:18000, current:14200, unrealized:-3800, type:'GIA',action:'Harvest · stay in market via similar ETF'},
      {n:'UK Smaller Companies', cost:24000, current:20500, unrealized:-3500, type:'GIA',action:'Harvest after 30-day rule'},
      {n:'Tesla (TSLA)', cost:14200, current:24800, unrealized:10600, type:'GIA',action:'Hold · realise into CGT allowance over 2 yrs'},
      {n:'Bitcoin', cost:18500, current:42600, unrealized:24100, type:'GIA',action:'Consider partial trim · CGT planning'},
      {n:'Nvidia (NVDA)', cost:8400, current:18200, unrealized:9800, type:'GIA',action:'Hold · use CGT allowance gradually'}
    ];
    const totalLosses = positions.filter(p=>p.unrealized<0).reduce((s,p)=>s+p.unrealized,0);
    panel = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('✂','Available Losses','£'+Math.abs(totalLosses).toLocaleString(),'','can offset gains')}
      ${mKpi('🎯','CGT Allowance 2025-26','£3,000','','use it or lose it')}
      ${mKpi('💰','Tax Saved if harvested','£'+Math.round(Math.abs(totalLosses)*0.20).toLocaleString(),'','at 20% CGT rate')}
    </div>
    ${mCard('Positions & TLH Opportunities', mTable(
      [{l:'Position'},{l:'Type'},{l:'Cost',align:'right'},{l:'Current',align:'right'},{l:'Unrealized',align:'right'},{l:'Recommendation'}],
      positions.map(p => [
        '<b>'+p.n+'</b>',
        mBadge(p.type,'info'),
        '£'+p.cost.toLocaleString(),
        '£'+p.current.toLocaleString(),
        `<b style="color:${p.unrealized>=0?'#10B981':'#EF4444'}">${p.unrealized>=0?'+':''}£${p.unrealized.toLocaleString()}</b>`,
        '<span style="font-size:12px;color:#475569">'+p.action+'</span>'
      ])
    ))}
    <div style="margin-top:14px;background:#FEF3C7;border-left:3px solid #F59E0B;padding:14px;border-radius:8px;font-size:13px;color:#92400E"><b>⚠ 30-day rule:</b> Cannot repurchase the same security within 30 days. Buy a similar (not identical) ETF to maintain exposure while crystallising the loss.</div>`;
  }

  // ===== INFLATION IMPACT =====
  else if (tab === 'inflation') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('📉','UK CPI (current)','2.8%','','Bank of England target: 2%')}
      ${mKpi('💷','Cash real return','-2.1%','','3.5% nominal · -2.8% CPI · -2.8% tax effect')}
      ${mKpi('📈','Portfolio real return','+5.4%','','8.2% nominal - 2.8% inflation')}
      ${mKpi('🏖','Retirement income (real)','£62k','','adjusted for 25yr inflation at 2.5%')}
    </div>
    ${mCard('Purchasing Power Erosion · £100k in cash today', mTable(
      [{l:'Years'},{l:'@ 2% inflation',align:'right'},{l:'@ 3% inflation',align:'right'},{l:'@ 4% inflation',align:'right'},{l:'@ 5% inflation',align:'right'}],
      [5,10,15,20,25,30].map(yrs => [
        '<b>'+yrs+' years</b>',
        '£'+Math.round(100000/Math.pow(1.02,yrs)).toLocaleString(),
        '£'+Math.round(100000/Math.pow(1.03,yrs)).toLocaleString(),
        '£'+Math.round(100000/Math.pow(1.04,yrs)).toLocaleString(),
        '<b style="color:#EF4444">£'+Math.round(100000/Math.pow(1.05,yrs)).toLocaleString()+'</b>'
      ])
    ))}
    <div style="margin-top:14px">${mCard('Inflation-Beating Assets', `<div style="font-size:13px;color:#475569;line-height:1.7">
      <b style="color:#0F172A">✓ Strong inflation hedges:</b> UK index-linked gilts · property (long-term) · equities (long-term) · commodities · TIPS<br>
      <b style="color:#EF4444">✗ Inflation losers:</b> Cash · long-dated fixed-rate bonds · annuities not inflation-linked<br>
      <b style="color:#0F172A">📊 Your portfolio:</b> 75% in inflation-beating assets · 18% property · 5% cash · 2% nominal bonds — solid positioning
    </div>`)}</div>`;
  }

  // ===== SEQUENCE OF RETURNS =====
  else if (tab === 'sequence') {
    panel = `<div style="background:#FEF3C7;border-left:3px solid #F59E0B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#92400E"><b>⚠ Why this matters:</b> Same average return + same withdrawals · totally different outcome depending on WHEN losses hit. Bad years early in retirement can wipe a portfolio out.</div>
    ${mCard('Sequence-of-Returns Stress Test · £1M starting, 4% withdrawal', mTable(
      [{l:'Scenario'},{l:'Year 1-5 returns'},{l:'Year 6-25 returns'},{l:'25yr Outcome',align:'right'},{l:'Outcome'}],
      [
        ['Best case', '+10% avg', '+7% avg', '£3,840,000', mBadge('✓ Wealth grew','success')],
        ['Average sequence', '+7% avg', '+7% avg', '£1,920,000', mBadge('✓ Sustained','success')],
        ['<b>Bad early sequence</b>', '<b>-12% avg</b>', '+9% avg', '<b>£185,000</b>', mBadge('⚠ Near depletion','danger')],
        ['Catastrophic early', '-20% avg', '+10% avg', '£0 by year 18', mBadge('✗ Ran out','danger')]
      ]
    ))}
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('Mitigations', `<div style="font-size:13px;color:#475569;line-height:1.7">
        <b style="color:#0F172A">1. Bucket strategy:</b> 2-3 years cash + 5-7 years bonds + rest equities<br>
        <b style="color:#0F172A">2. Flexible spending:</b> Reduce withdrawals 10% in down years<br>
        <b style="color:#0F172A">3. Glide path:</b> 60/40 → 40/60 equity/bond as you near retirement<br>
        <b style="color:#0F172A">4. Bond ladder:</b> Predictable income for known years<br>
        <b style="color:#0F172A">5. Partial annuitisation:</b> Cover essential spending floor
      </div>`)}
      ${mCard('Your readiness', `<div style="font-size:13px;color:#475569;line-height:1.7">
        <b>Cash buffer:</b> ✓ 18 months opex<br>
        <b>Bond allocation:</b> ⚠ 9% (target 15%)<br>
        <b>Withdrawal rate plan:</b> ✓ 3.5% target (safe)<br>
        <b>Multiple income streams:</b> ✓ Business + property + portfolio + pension<br>
        <b>Score:</b> <span style="color:#10B981;font-weight:700">7.2/10 — Strong</span>
      </div>`)}
    </div>`;
  }

  // ===== LISA / JISA =====
  else if (tab === 'lisajisa') {
    const accounts = [
      {n:'Owner LISA', balance:24000, contrib:4000, bonus:1000, age:42, eligibleFor:'House / Retirement (60+)', status:'over 40 - new contributions blocked'},
      {n:'Spouse LISA', balance:32000, contrib:4000, bonus:1000, age:38, eligibleFor:'House / Retirement (60+)', status:'Active'},
      {n:'Child 1 JISA · Stocks & Shares', balance:18000, contrib:9000, bonus:0, age:14, eligibleFor:'At 18', status:'Active'},
      {n:'Child 2 JISA · Stocks & Shares', balance:15000, contrib:9000, bonus:0, age:11, eligibleFor:'At 18', status:'Active'},
      {n:'Child 3 JISA · Cash', balance:8500, contrib:4500, bonus:0, age:7, eligibleFor:'At 18', status:'Active'}
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('💰','Total LISA + JISA','£97,500','','across family')}
      ${mKpi('🎁','Gov Bonus Earned','£12,500','+£2,000','this year')}
      ${mKpi('🎯','Annual JISA Allowance','£9,000','','per child')}
      ${mKpi('🎯','Annual LISA Allowance','£4,000','','per adult under 50')}
    </div>
    ${mCard('LISA & JISA Accounts', mTable(
      [{l:'Account'},{l:'Balance',align:'right'},{l:'Annual £',align:'right'},{l:'Gov Bonus',align:'right'},{l:'Age'},{l:'Status'}],
      accounts.map(a => [
        '<b>'+a.n+'</b>',
        '£'+a.balance.toLocaleString(),
        '£'+a.contrib.toLocaleString(),
        a.bonus>0 ? '<b style="color:#10B981">+£'+a.bonus.toLocaleString()+'</b>' : '—',
        a.age.toString(),
        '<span style="font-size:12px;color:#475569">'+a.status+'</span>'
      ])
    ))}`;
  }

  // ===== CURRENCY EXPOSURE =====
  else if (tab === 'fx') {
    const exposures = [
      {ccy:'GBP', amount:520000, pct:70, c:'#10B981'},
      {ccy:'USD', amount:148000, pct:20, c:'#3B82F6'},
      {ccy:'EUR', amount:44000, pct:6, c:'#8B5CF6'},
      {ccy:'JPY', amount:18500, pct:2.5, c:'#F59E0B'},
      {ccy:'Crypto (USD-pegged)', amount:9500, pct:1.5, c:'#F97316'}
    ];
    panel = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px">
      <h3 style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 12px">Currency Exposure by Asset</h3>
      <div style="display:flex;height:32px;border-radius:8px;overflow:hidden">
        ${exposures.map(e=>`<div style="width:${e.pct}%;background:${e.c};display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">${e.ccy}</div>`).join('')}
      </div>
    </div>
    ${mCard('Currency Breakdown', mTable(
      [{l:'Currency'},{l:'Exposure £',align:'right'},{l:'% of Portfolio',align:'right'},{l:'1yr FX Impact',align:'right'}],
      exposures.map(e => [
        `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:${e.c};border-radius:2px"></span><b>${e.ccy}</b></span>`,
        '£'+e.amount.toLocaleString(),
        '<b>'+e.pct+'%</b>',
        e.ccy==='GBP' ? '—' : `<span style="color:${Math.random()>0.5?'#10B981':'#EF4444'}">${Math.random()>0.5?'+':'-'}${(Math.random()*5).toFixed(1)}%</span>`
      ])
    ))}
    <div style="margin-top:14px;background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;font-size:13px;color:#0F172A"><b>💡 Hedging consideration:</b> Non-GBP exposure is 30% of portfolio. If GBP strengthens 10% vs USD, that's a ~£15k drag. Consider GBP-hedged share classes for large overseas equity positions if GBP volatility concerns you.</div>`;
  }

  // ===== POA & BENEFICIARIES =====
  else {
    panel = `${mCard('Power of Attorney Register', mTable(
      [{l:'Type'},{l:'Donor'},{l:'Attorney(s)'},{l:'Status'},{l:'Registered'}],
      [
        ['Property & Financial Affairs','Owner','Spouse + Sibling',mBadge('Registered','success'),'12 Mar 2023'],
        ['Health & Welfare','Owner','Spouse',mBadge('⚠ Not registered','warn'),'—'],
        ['Property & Financial Affairs','Spouse','Owner',mBadge('Registered','success'),'12 Mar 2023'],
        ['Health & Welfare','Spouse','Owner + Sister',mBadge('Registered','success'),'18 Apr 2023']
      ]
    ))}
    <div style="margin-top:14px">${mCard('Beneficiaries Register · All accounts', mTable(
      [{l:'Account'},{l:'Provider'},{l:'Primary Beneficiary'},{l:'Secondary'},{l:'Updated'}],
      [
        ['SIPP','AJ Bell','Spouse 100%','Children equal',mBadge('Current','success')],
        ['Workplace Pension','Aviva','Spouse 100%','Children equal',mBadge('Current','success')],
        ['Stocks & Shares ISA','iWeb','Spouse 100%','—',mBadge('Current','success')],
        ['Life Insurance · Term','Vitality','Spouse 100%','Estate',mBadge('Current','success')],
        ['Life Insurance · CI','Vitality','Spouse 100%','Estate',mBadge('Current','success')],
        ['Premium Bonds','NS&I','—','—',mBadge('⚠ No nomination','warn')]
      ]
    ))}</div>`;
  }

  return mPage('Wealth Pro · Estate, Risk & Insurance','Allocation drift · risk metrics · estate planning · insurance gap · FIC · tax-loss harvesting · inflation · sequence risk · LISA/JISA · currency · POA', `${mBtn('⬇ Export estate file','secondary')}${mBtn('📞 Book IFA','primary')}`) + mTabs(tab, tabs, 'wpSetTab') + panel + `</div>`;
};
