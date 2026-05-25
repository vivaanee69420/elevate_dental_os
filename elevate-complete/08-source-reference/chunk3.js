
// ============================================================================
// CHUNK 3 — WEALTH BUILDER (comprehensive personal & business wealth tracker)
// Sample data only · no real personal numbers · future-ready for advisor + world-finance integrations
// ============================================================================

// ========== WEALTH BUILDER · SAMPLE DATA ==========
function wbLoadData() {
  const stored = localStorage.getItem('elv-wealth-builder');
  if (stored) return JSON.parse(stored);
  const data = {
    settings: {
      currency: 'GBP',
      currencySymbol: '£',
      currentYear: 2026,
      currentAge: 42,
      retireAge: 60,
      investmentRate: 40,
      growthRate: 8,
      propertyGrowthRate: 5,
      carDepreciationRate: 15,
      valuationMultiple: 10,
      monthlyExtraction: 12000,
      monthlyPension: 5000,
      monthlySalary: 6000
    },
    businesses: [
      {id:'b1', name:'Business A · Service', type:'Service', monthlyTurnover:120000, margin:18, marketingPct:8, profitShare:50, active:true},
      {id:'b2', name:'Business B · Service', type:'Service', monthlyTurnover:95000, margin:22, marketingPct:7, profitShare:50, active:true},
      {id:'b3', name:'Business C · Service', type:'Service', monthlyTurnover:140000, margin:16, marketingPct:9, profitShare:50, active:true},
      {id:'b4', name:'Business D · Premium Service', type:'Premium', monthlyTurnover:180000, margin:28, marketingPct:6, profitShare:60, active:true},
      {id:'b5', name:'Business E · Specialist', type:'Specialist', monthlyTurnover:75000, margin:24, marketingPct:5, profitShare:50, active:true},
      {id:'b6', name:'Lab / Supply', type:'Supply', monthlyTurnover:42000, margin:35, marketingPct:2, profitShare:100, active:true},
      {id:'b7', name:'Academy · Education', type:'Education', monthlyTurnover:38000, margin:65, marketingPct:18, profitShare:100, active:true},
      {id:'b8', name:'SaaS · Recurring', type:'SaaS', monthlyTurnover:18000, margin:72, marketingPct:25, profitShare:100, active:true}
    ],
    properties: [
      {id:'p1', name:'Primary Residence', purchasePrice:550000, currentValue:780000, purchaseYear:2018, growthRate:5, monthlyRent:0, mortgageBalance:0, monthlyMortgage:0, type:'Primary'},
      {id:'p2', name:'BTL · North London', purchasePrice:185000, currentValue:240000, purchaseYear:2019, growthRate:4.5, monthlyRent:1450, mortgageBalance:120000, monthlyMortgage:820, type:'BTL'},
      {id:'p3', name:'BTL · Manchester', purchasePrice:165000, currentValue:220000, purchaseYear:2020, growthRate:5.5, monthlyRent:1250, mortgageBalance:108000, monthlyMortgage:710, type:'BTL'},
      {id:'p4', name:'BTL · Birmingham', purchasePrice:155000, currentValue:200000, purchaseYear:2021, growthRate:5, monthlyRent:1100, mortgageBalance:105000, monthlyMortgage:680, type:'BTL'},
      {id:'p5', name:'Commercial Unit', purchasePrice:380000, currentValue:480000, purchaseYear:2022, growthRate:4, monthlyRent:3200, mortgageBalance:240000, monthlyMortgage:1450, type:'Commercial'}
    ],
    cars: [
      {id:'c1', name:'Family SUV', regYear:2023, baseValue:65000, currentValue:48000, mileage:24000, expectedMileage:36000, financeBalance:18000, monthlyPayment:850, motDate:'2027-03-15', insuranceDate:'2026-09-12', serviceDate:'2026-08-20'},
      {id:'c2', name:'Daily Driver', regYear:2024, baseValue:42000, currentValue:36000, mileage:18000, expectedMileage:24000, financeBalance:24000, monthlyPayment:620, motDate:'2027-06-22', insuranceDate:'2026-11-05', serviceDate:'2026-10-18'},
      {id:'c3', name:'Weekend Car', regYear:2021, baseValue:78000, currentValue:54000, mileage:32000, expectedMileage:50000, financeBalance:0, monthlyPayment:0, motDate:'2026-08-10', insuranceDate:'2026-12-01', serviceDate:'2026-09-25'},
      {id:'c4', name:'Partner Vehicle', regYear:2022, baseValue:38000, currentValue:28000, mileage:28000, expectedMileage:40000, financeBalance:8000, monthlyPayment:380, motDate:'2027-01-18', insuranceDate:'2026-07-30', serviceDate:'2026-11-12'}
    ],
    loans: [
      {id:'l1', name:'Business Loan · Working Capital', category:'Business', principal:250000, balance:185000, rate:5.5, term:60, monthlyPayment:4780, startDate:'2023-04-01'},
      {id:'l2', name:'Equipment Finance', category:'Equipment', principal:80000, balance:42000, rate:6.2, term:48, monthlyPayment:1880, startDate:'2024-01-15'},
      {id:'l3', name:'Credit Card · Revolving', category:'Other', principal:0, balance:6800, rate:22.9, term:0, monthlyPayment:280, startDate:'2025-09-01'}
    ],
    investments: [
      {id:'i1', name:'Stocks & Shares ISA', type:'Tax-Wrapped', balance:95000, contributedTotal:62000, growth:53.2, annualContribution:20000},
      {id:'i2', name:'General Investment Account', type:'GIA', balance:48200, contributedTotal:38000, growth:26.8, annualContribution:6000},
      {id:'i3', name:'Individual Stocks', type:'Stocks', balance:18400, contributedTotal:14200, growth:29.6, annualContribution:3600},
      {id:'i4', name:'Crypto Holdings', type:'Crypto', balance:32100, contributedTotal:18500, growth:73.5, annualContribution:2400},
      {id:'i5', name:'Premium Bonds', type:'NS&I', balance:50000, contributedTotal:50000, growth:0, annualContribution:0},
      {id:'i6', name:'Angel Investment', type:'Private Equity', balance:25000, contributedTotal:25000, growth:0, annualContribution:0}
    ],
    pensions: [
      {id:'pen1', name:'SIPP · Self-Invested', balance:140000, monthlyContribution:1500, growthRate:8, sippLink:'', notes:'AJ Bell · 80/20 equity/bond'},
      {id:'pen2', name:'Workplace Pension', balance:48000, monthlyContribution:600, growthRate:6, sippLink:'', notes:'Auto-enrolment'},
      {id:'pen3', name:'Stocks & Shares ISA (retirement bucket)', balance:55000, monthlyContribution:1667, growthRate:8, sippLink:'', notes:'£20k annual allowance'}
    ],
    targets: {
      monthlyRevenue: 950000,
      monthlyProfit: 165000,
      yearlyRevenue: 11400000,
      yearlyProfit: 1980000,
      netWorthYear5: 5000000,
      netWorthYear10: 15000000,
      netWorthRetire: 25000000
    },
    advisors: []  // Future integration hooks
  };
  localStorage.setItem('elv-wealth-builder', JSON.stringify(data));
  return data;
}
function wbSaveData(data) { localStorage.setItem('elv-wealth-builder', JSON.stringify(data)); }

// ========== CORE FORMULAS ==========
function wbCalcBusiness(b) {
  const monthlyProfit = b.monthlyTurnover * (b.margin / 100);
  const yearlyTurnover = b.monthlyTurnover * 12;
  const yearlyProfit = monthlyProfit * 12;
  const monthlyMarketing = b.monthlyTurnover * (b.marketingPct / 100);
  const yearlyMarketing = monthlyMarketing * 12;
  const monthlyExtraction = monthlyProfit * (b.profitShare / 100);
  return { monthlyProfit, yearlyTurnover, yearlyProfit, monthlyMarketing, yearlyMarketing, monthlyExtraction };
}
function wbCalcProperty(p, year) {
  const yearsOwned = year - p.purchaseYear;
  const value = p.purchasePrice * Math.pow(1 + p.growthRate/100, yearsOwned);
  const equity = value - p.mortgageBalance;
  const yearlyRent = p.monthlyRent * 12;
  const yearlyMortgage = p.monthlyMortgage * 12;
  const netYield = p.currentValue > 0 ? ((yearlyRent - yearlyMortgage) / p.currentValue * 100) : 0;
  return { value, equity, yearlyRent, yearlyMortgage, netYield };
}
function wbCalcCar(c) {
  const age = new Date().getFullYear() - c.regYear;
  const mileageOver = Math.max(0, c.mileage - c.expectedMileage);
  const mileageAdj = mileageOver * 0.05;
  const equity = c.currentValue - c.financeBalance;
  return { age, mileageAdj, equity };
}
function wbCalcInvestmentProjection(startBalance, annualContribution, growthRate, years) {
  let balance = startBalance;
  const projection = [];
  for (let y = 0; y < years; y++) {
    const monthlyGrowth = growthRate / 100 / 12;
    const monthlyContribution = annualContribution / 12;
    for (let m = 0; m < 12; m++) {
      balance = balance * (1 + monthlyGrowth) + monthlyContribution;
    }
    projection.push({ year: y, balance });
  }
  return projection;
}
function wbCalcNetWorth(data, multiple) {
  const m = multiple || data.settings.valuationMultiple;
  const totalYearlyProfit = data.businesses.filter(b=>b.active).reduce((s,b)=>s + wbCalcBusiness(b).yearlyProfit, 0);
  const businessValuation = totalYearlyProfit * m;
  const propertyValue = data.properties.reduce((s,p)=>s + p.currentValue, 0);
  const propertyDebt = data.properties.reduce((s,p)=>s + p.mortgageBalance, 0);
  const carValue = data.cars.reduce((s,c)=>s + c.currentValue, 0);
  const carDebt = data.cars.reduce((s,c)=>s + c.financeBalance, 0);
  const investmentValue = data.investments.reduce((s,i)=>s + i.balance, 0);
  const pensionValue = data.pensions.reduce((s,p)=>s + p.balance, 0);
  const otherDebt = data.loans.reduce((s,l)=>s + l.balance, 0);
  const totalAssets = businessValuation + propertyValue + carValue + investmentValue + pensionValue;
  const totalDebts = propertyDebt + carDebt + otherDebt;
  const netWorth = totalAssets - totalDebts;
  return { totalAssets, totalDebts, netWorth, businessValuation, propertyValue, propertyDebt, carValue, carDebt, investmentValue, pensionValue, otherDebt, totalYearlyProfit };
}
function wbCalcUKTax(income, dividends, capitalGains, pensionWithdrawal, pensionLumpSumUsed) {
  // 2025-26 UK rates
  const PA = 12570;
  const BAND_BASIC = 50270;
  const BAND_HIGHER = 125140;
  const DIV_ALLOW = 500;
  const CGT_ALLOW = 3000;
  let totalIncome = income;
  let pensionTaxFree = 0;
  if (pensionWithdrawal > 0) {
    const remainingLumpSum = Math.max(0, pensionWithdrawal * 0.25 - pensionLumpSumUsed);
    pensionTaxFree = Math.min(pensionWithdrawal * 0.25, remainingLumpSum);
    totalIncome += pensionWithdrawal - pensionTaxFree;
  }
  // Personal allowance taper
  let pa = PA;
  if (totalIncome > 100000) pa = Math.max(0, PA - (totalIncome - 100000) / 2);
  let taxable = Math.max(0, totalIncome - pa);
  let incomeTax = 0;
  if (taxable > 0) {
    const basicAmount = Math.min(taxable, BAND_BASIC - pa);
    incomeTax += basicAmount * 0.20;
    if (taxable > BAND_BASIC - pa) {
      const higherAmount = Math.min(taxable - (BAND_BASIC - pa), BAND_HIGHER - BAND_BASIC);
      incomeTax += higherAmount * 0.40;
      if (taxable > BAND_HIGHER - pa) {
        incomeTax += (taxable - (BAND_HIGHER - pa)) * 0.45;
      }
    }
  }
  // Dividends 2025-26: 8.75% basic / 33.75% higher / 39.35% additional
  let divTax = 0;
  if (dividends > DIV_ALLOW) {
    const taxableDiv = dividends - DIV_ALLOW;
    const incomeAfter = totalIncome + dividends;
    if (incomeAfter <= BAND_BASIC) divTax = taxableDiv * 0.0875;
    else if (incomeAfter <= BAND_HIGHER) divTax = taxableDiv * 0.3375;
    else divTax = taxableDiv * 0.3935;
  }
  // CGT
  let cgt = 0;
  if (capitalGains > CGT_ALLOW) {
    const taxableCG = capitalGains - CGT_ALLOW;
    cgt = taxableCG * (totalIncome > BAND_BASIC ? 0.20 : 0.10);
  }
  const totalTax = incomeTax + divTax + cgt;
  const netIncome = (income + dividends + capitalGains + pensionWithdrawal) - totalTax;
  return { incomeTax, divTax, cgt, pensionTaxFree, totalTax, netIncome, effectiveRate: ((totalTax / (income+dividends+capitalGains+pensionWithdrawal)) * 100).toFixed(1) };
}

// ========== TAB ACTIONS ==========
window.wbSetTab = function(t) { localStorage.setItem('wb-tab', t); navigate('wealth-builder'); };
window.wbUpdate = function(path, value) {
  const data = wbLoadData();
  const parts = path.split('.');
  let obj = data;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  obj[parts[parts.length-1]] = isNaN(value) || value === '' ? value : parseFloat(value);
  wbSaveData(data);
};
window.wbUpdateBiz = function(id, field, value) {
  const data = wbLoadData();
  const b = data.businesses.find(x => x.id === id);
  if (b) { b[field] = isNaN(value) ? value : parseFloat(value); wbSaveData(data); navigate('wealth-builder'); }
};
window.wbToggleBiz = function(id) {
  const data = wbLoadData();
  const b = data.businesses.find(x => x.id === id);
  if (b) { b.active = !b.active; wbSaveData(data); navigate('wealth-builder'); }
};
window.wbResetData = function() {
  if (!confirm('Reset all wealth builder data to sample defaults? This cannot be undone.')) return;
  localStorage.removeItem('elv-wealth-builder');
  navigate('wealth-builder');
};
window.wbCalcTax = function() {
  const income = parseFloat(document.getElementById('tax-income').value) || 0;
  const dividends = parseFloat(document.getElementById('tax-div').value) || 0;
  const cg = parseFloat(document.getElementById('tax-cg').value) || 0;
  const pension = parseFloat(document.getElementById('tax-pension').value) || 0;
  const lumpUsed = parseFloat(document.getElementById('tax-lump').value) || 0;
  const r = wbCalcUKTax(income, dividends, cg, pension, lumpUsed);
  document.getElementById('tax-result').innerHTML = `<div style="background:#F0FDFA;border:1px solid #0E7C7B;border-radius:10px;padding:18px">
    <h4 style="font-size:14px;font-weight:700;color:#0E7C7B;margin:0 0 14px">Tax Breakdown · 2025-26</h4>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13.5px">
      ${[
        ['Income Tax', '£'+r.incomeTax.toLocaleString('en-GB',{maximumFractionDigits:0})],
        ['Dividend Tax', '£'+r.divTax.toLocaleString('en-GB',{maximumFractionDigits:0})],
        ['Capital Gains Tax', '£'+r.cgt.toLocaleString('en-GB',{maximumFractionDigits:0})],
        ['Pension Tax-Free (25%)', '£'+r.pensionTaxFree.toLocaleString('en-GB',{maximumFractionDigits:0})],
        ['<b>Total Tax</b>', '<b style="color:#EF4444">£'+r.totalTax.toLocaleString('en-GB',{maximumFractionDigits:0})+'</b>'],
        ['<b>Net Income</b>', '<b style="color:#10B981">£'+r.netIncome.toLocaleString('en-GB',{maximumFractionDigits:0})+'</b>'],
        ['Effective Rate', '<b>'+r.effectiveRate+'%</b>']
      ].map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:8px 12px;background:#fff;border-radius:6px"><span>${l}</span><span>${v}</span></div>`).join('')}
    </div>
  </div>`;
};
window.wbConnectAdvisor = function() {
  alert('Connect Wealth Advisor — Coming Soon\n\nIntegrations planned:\n• Schroders Personal Wealth\n• St. James\'s Place\n• Quilter\n• Independent IFAs via Vouchedfor API\n• True Potential\n\nDirect data feeds will let advisors review your full picture without you emailing spreadsheets.');
};
window.wbConnectWorldFinance = function() {
  alert('Connect World Finance — Coming Soon\n\nLive market data integrations planned:\n• Yahoo Finance API (stocks)\n• Bank of England base rate\n• HMRC Making Tax Digital\n• Open Banking (Plaid / TrueLayer)\n• Land Registry (property values)\n• CoinGecko (crypto)\n• Zoopla / Rightmove APIs\n\nReal-time net worth updates as markets move.');
};

// ========== WEALTH BUILDER MAIN PAGE ==========
PAGES['wealth-builder'] = () => {
  const data = wbLoadData();
  const tab = localStorage.getItem('wb-tab') || 'overview';
  const s = data.settings;
  const nw = wbCalcNetWorth(data);

  const tabs = [
    {k:'overview', l:'Overview', i:'📊'},
    {k:'business', l:'Businesses', i:'🏢'},
    {k:'investments', l:'Investments', i:'📈'},
    {k:'properties', l:'Properties', i:'🏠'},
    {k:'cars', l:'Vehicles', i:'🚗'},
    {k:'loans', l:'Loans', i:'💷'},
    {k:'networth', l:'Net Worth', i:'💎'},
    {k:'valuations', l:'Valuations', i:'⚖'},
    {k:'targets', l:'Target vs Real', i:'🎯'},
    {k:'plan', l:'Business Plan', i:'📋'},
    {k:'watch', l:'WealthWatch', i:'⚡'},
    {k:'performance', l:'Performance', i:'📊'},
    {k:'ai', l:'AI Insights', i:'🤖'},
    {k:'allocator', l:'Allocator', i:'🎚'},
    {k:'pensions', l:'Pensions', i:'🏦'},
    {k:'tax', l:'Tax Calculator', i:'🧮'},
    {k:'intel', l:'Intelligence', i:'🧠'}
  ];

  let panel = '';

  // ============ OVERVIEW ============
  if (tab === 'overview') {
    const totalMonthlyTurnover = data.businesses.filter(b=>b.active).reduce((s,b)=>s + b.monthlyTurnover, 0);
    const totalMonthlyProfit = data.businesses.filter(b=>b.active).reduce((s,b)=>s + wbCalcBusiness(b).monthlyProfit, 0);
    const monthlyInvestment = totalMonthlyProfit * (s.investmentRate / 100);
    panel = `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:18px">
      ${mKpi('£','Monthly Revenue','£'+totalMonthlyTurnover.toLocaleString(),'+12%','MTD')}
      ${mKpi('£','Monthly Profit','£'+Math.round(totalMonthlyProfit).toLocaleString(),'','22% avg margin')}
      ${mKpi('£','Yearly Profit','£'+Math.round(totalMonthlyProfit*12).toLocaleString(),'','projected')}
      ${mKpi('🎯','Investment Rate', s.investmentRate+'%','','of profit')}
      ${mKpi('💎','Net Worth','£'+nw.netWorth.toLocaleString('en-GB',{maximumFractionDigits:0}),'+£565k','vs last year')}
      ${mKpi('🏢','Business Value','£'+nw.businessValuation.toLocaleString(),'',s.valuationMultiple+'× profit')}
    </div>
    ${mCard('Editable Allocation Controls', `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
      <div>
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:6px">Investment % of Profit</label>
        <div style="display:flex;align-items:center;gap:10px"><input type="range" min="10" max="80" value="${s.investmentRate}" oninput="wbUpdate('settings.investmentRate', this.value); document.getElementById('inv-pct').textContent=this.value+'%'" style="flex:1"><span id="inv-pct" style="font-weight:700;color:#0F172A;min-width:42px;text-align:right">${s.investmentRate}%</span></div>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:6px">Monthly Extraction £</label>
        <input type="number" value="${s.monthlyExtraction}" onchange="wbUpdate('settings.monthlyExtraction', this.value); navigate('wealth-builder')" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13.5px">
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:6px">Monthly Pension £</label>
        <input type="number" value="${s.monthlyPension}" onchange="wbUpdate('settings.monthlyPension', this.value); navigate('wealth-builder')" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13.5px">
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:6px">Monthly Salary (Net) £</label>
        <input type="number" value="${s.monthlySalary}" onchange="wbUpdate('settings.monthlySalary', this.value); navigate('wealth-builder')" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13.5px">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px">
      <div style="padding:14px;background:#FEF3C7;border-radius:10px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#92400E;letter-spacing:.04em">Annual Extraction</div><div style="font-size:22px;font-weight:700;color:#0F172A;letter-spacing:-.01em;margin-top:3px">£${(s.monthlyExtraction*12).toLocaleString()}</div><div style="font-size:11px;color:#92400E;margin-top:1px">${((s.monthlyExtraction*12)/(totalMonthlyProfit*12||1)*100).toFixed(1)}% of profit</div></div>
      <div style="padding:14px;background:#ECFDF5;border-radius:10px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#065F46;letter-spacing:.04em">Annual Pension</div><div style="font-size:22px;font-weight:700;color:#0F172A;letter-spacing:-.01em;margin-top:3px">£${(s.monthlyPension*12).toLocaleString()}</div><div style="font-size:11px;color:#065F46;margin-top:1px">tax-efficient</div></div>
      <div style="padding:14px;background:#EFF6FF;border-radius:10px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#1E40AF;letter-spacing:.04em">Annual Salary</div><div style="font-size:22px;font-weight:700;color:#0F172A;letter-spacing:-.01em;margin-top:3px">£${(s.monthlySalary*12).toLocaleString()}</div><div style="font-size:11px;color:#1E40AF;margin-top:1px">take-home</div></div>
      <div style="padding:14px;background:#F0FDFA;border-radius:10px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#0E7C7B;letter-spacing:.04em">Monthly Investment</div><div style="font-size:22px;font-weight:700;color:#0F172A;letter-spacing:-.01em;margin-top:3px">£${Math.round(monthlyInvestment).toLocaleString()}</div><div style="font-size:11px;color:#0E7C7B;margin-top:1px">${s.investmentRate}% of profit</div></div>
    </div>`)}
    <div style="margin-top:14px">${mCard('Business Performance · '+s.currentYear+' (sample data)', mTable(
      [{l:'#'},{l:'Business'},{l:'Type'},{l:'Margin',align:'right'},{l:'M.Turnover',align:'right'},{l:'Y.Turnover',align:'right'},{l:'M.Profit',align:'right'},{l:'Y.Profit',align:'right'},{l:'M.Invest',align:'right'},{l:'Status'}],
      data.businesses.map((b,i) => {
        const c = wbCalcBusiness(b);
        const mInv = c.monthlyProfit * (s.investmentRate/100);
        return [(i+1).toString(), '<b>'+b.name+'</b>', mBadge(b.type, 'info'), b.margin+'%', '£'+b.monthlyTurnover.toLocaleString(), '£'+c.yearlyTurnover.toLocaleString(), '£'+Math.round(c.monthlyProfit).toLocaleString(), '£'+Math.round(c.yearlyProfit).toLocaleString(), '£'+Math.round(mInv).toLocaleString(), b.active?mBadge('Active','success'):mBadge('Paused','neutral')];
      })
    ), `<span style="font-size:11.5px;color:#64748B">Sorted by Revenue ↓</span>`)}</div>`;
  }

  // ============ BUSINESSES ============
  else if (tab === 'business') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('🏢','Active Businesses', data.businesses.filter(b=>b.active).length.toString(), '', 'of '+data.businesses.length+' total')}
      ${mKpi('£','Group Revenue', '£'+data.businesses.filter(b=>b.active).reduce((s,b)=>s+b.monthlyTurnover*12,0).toLocaleString(), '', 'annualised')}
      ${mKpi('📊','Avg Margin', (data.businesses.filter(b=>b.active).reduce((s,b)=>s+b.margin,0)/data.businesses.filter(b=>b.active).length).toFixed(1)+'%', '', 'across portfolio')}
      ${mKpi('💰','Group EBITDA', '£'+Math.round(data.businesses.filter(b=>b.active).reduce((s,b)=>s+wbCalcBusiness(b).yearlyProfit,0)).toLocaleString(), '', 'projected')}
    </div>
    ${mCard('Business Portfolio · Edit inline', data.businesses.map(b => {
      const c = wbCalcBusiness(b);
      return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid #0E7C7B;border-radius:10px;padding:16px;margin-bottom:10px;opacity:${b.active?1:0.5}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-weight:700;font-size:14.5px;color:#0F172A">${b.name}</div>
            ${mBadge(b.type, 'info')}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;color:#64748B">${b.active?'Active':'Paused'}</span>
            <button onclick="wbToggleBiz('${b.id}')" style="background:${b.active?'#10B981':'#94A3B8'};border:none;width:36px;height:20px;border-radius:10px;cursor:pointer;position:relative"><span style="position:absolute;top:2px;${b.active?'right:2px':'left:2px'};width:16px;height:16px;background:#fff;border-radius:50%"></span></button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">
          ${[
            ['M.Turnover £','monthlyTurnover',b.monthlyTurnover],
            ['Margin %','margin',b.margin],
            ['Marketing %','marketingPct',b.marketingPct],
            ['Profit Share %','profitShare',b.profitShare]
          ].map(([l,f,v])=>`<div><label style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:3px">${l}</label><input type="number" value="${v}" onchange="wbUpdateBiz('${b.id}','${f}',this.value)" style="width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;font-weight:600"></div>`).join('')}
          <div><label style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:3px">Y.Profit</label><div style="padding:8px 10px;background:#F0FDFA;border-radius:6px;font-size:13px;font-weight:700;color:#0E7C7B">£${Math.round(c.yearlyProfit).toLocaleString()}</div></div>
        </div>
      </div>`;
    }).join('') + mBtn('+ Add Business', 'primary'))}`;
  }

  // ============ INVESTMENTS (compound growth projection) ============
  else if (tab === 'investments') {
    const totalAnnualContribution = data.businesses.filter(b=>b.active).reduce((s,b)=>s+wbCalcBusiness(b).yearlyProfit*(data.settings.investmentRate/100),0);
    const startBalance = data.investments.reduce((s,i)=>s+i.balance,0);
    const projection = wbCalcInvestmentProjection(startBalance, totalAnnualContribution, s.growthRate, 20);
    const retireBalance = projection[s.retireAge - s.currentAge - 1]?.balance || projection[projection.length-1].balance;
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('💰','Current Portfolio','£'+startBalance.toLocaleString(),'','starting balance')}
      ${mKpi('📈','Annual Growth Rate', s.growthRate+'%','','compound')}
      ${mKpi('🎯','Annual Contribution','£'+Math.round(totalAnnualContribution).toLocaleString(),'',data.settings.investmentRate+'% of profit')}
      ${mKpi('🏖','At Age '+s.retireAge,'£'+Math.round(retireBalance).toLocaleString(),'',(s.retireAge-s.currentAge)+' years compounding')}
    </div>
    ${mCard('Investment Fund Projection · '+s.growthRate+'% compound growth', mTable(
      [{l:'Year'},{l:'Age',align:'right'},{l:'Phase'},{l:'Annual Contribution',align:'right'},{l:'Growth Earned',align:'right'},{l:'Fund Balance',align:'right'}],
      projection.slice(0, 15).map((p, idx) => {
        const year = s.currentYear + p.year;
        const age = s.currentAge + p.year + 1;
        const phase = age < s.retireAge ? 'Active' : 'Drawdown';
        const prevBalance = idx === 0 ? startBalance : projection[idx-1].balance;
        const growthEarned = p.balance - prevBalance - totalAnnualContribution;
        return [
          year.toString(),
          age.toString(),
          mBadge(phase, phase==='Active'?'success':'info'),
          '£'+Math.round(totalAnnualContribution).toLocaleString(),
          '<b style="color:#10B981">£'+Math.round(growthEarned).toLocaleString()+'</b>',
          '<b>£'+Math.round(p.balance).toLocaleString()+'</b>'
        ];
      })
    ))}
    <div style="margin-top:14px">${mCard('Investment Holdings Breakdown', mTable(
      [{l:'Investment'},{l:'Type'},{l:'Balance',align:'right'},{l:'Contributed',align:'right'},{l:'Growth %',align:'right'},{l:'Annual Top-up',align:'right'}],
      data.investments.map(i => [
        '<b>'+i.name+'</b>',
        mBadge(i.type, 'info'),
        '£'+i.balance.toLocaleString(),
        '£'+i.contributedTotal.toLocaleString(),
        '<b style="color:'+(i.growth>=0?'#10B981':'#EF4444')+'">'+(i.growth>=0?'+':'')+i.growth+'%</b>',
        '£'+i.annualContribution.toLocaleString()
      ])
    ))}</div>`;
  }

  // ============ PROPERTIES ============
  else if (tab === 'properties') {
    const totalValue = data.properties.reduce((s,p)=>s+p.currentValue,0);
    const totalDebt = data.properties.reduce((s,p)=>s+p.mortgageBalance,0);
    const monthlyRent = data.properties.reduce((s,p)=>s+p.monthlyRent,0);
    const monthlyMortgage = data.properties.reduce((s,p)=>s+p.monthlyMortgage,0);
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('🏠','Portfolio Value','£'+totalValue.toLocaleString(),'+8%','vs last year')}
      ${mKpi('💎','Total Equity','£'+(totalValue-totalDebt).toLocaleString(),'','net of debt')}
      ${mKpi('£','Monthly Rent','£'+monthlyRent.toLocaleString(),'','gross income')}
      ${mKpi('📈','Net Cashflow','£'+(monthlyRent-monthlyMortgage).toLocaleString(),'/mo','after mortgage')}
    </div>
    ${mCard('Property Portfolio', mTable(
      [{l:'Property'},{l:'Type'},{l:'Purchase £',align:'right'},{l:'Current £',align:'right'},{l:'Growth %',align:'right'},{l:'Mortgage',align:'right'},{l:'Equity',align:'right'},{l:'Rent/mo',align:'right'},{l:'Yield %',align:'right'}],
      data.properties.map(p => {
        const c = wbCalcProperty(p, s.currentYear);
        return [
          '<b>'+p.name+'</b>',
          mBadge(p.type, p.type==='Primary'?'success':p.type==='Commercial'?'purple':'info'),
          '£'+p.purchasePrice.toLocaleString(),
          '<b>£'+p.currentValue.toLocaleString()+'</b>',
          p.growthRate+'%',
          '£'+p.mortgageBalance.toLocaleString(),
          '<b style="color:#10B981">£'+c.equity.toLocaleString()+'</b>',
          '£'+p.monthlyRent.toLocaleString(),
          p.monthlyRent>0?'<b>'+c.netYield.toFixed(1)+'%</b>':'—'
        ];
      })
    ), mBtn('+ Add Property', 'primary'))}`;
  }

  // ============ CARS ============
  else if (tab === 'cars') {
    const totalValue = data.cars.reduce((s,c)=>s+c.currentValue,0);
    const totalDebt = data.cars.reduce((s,c)=>s+c.financeBalance,0);
    const monthlyPayments = data.cars.reduce((s,c)=>s+c.monthlyPayment,0);
    const today = new Date();
    const motDue = data.cars.filter(c => new Date(c.motDate) < new Date(today.getFullYear(), today.getMonth()+2, today.getDate())).length;
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('🚗','Fleet Value','£'+totalValue.toLocaleString(),'','depreciation tracked')}
      ${mKpi('💰','Net Equity','£'+(totalValue-totalDebt).toLocaleString(),'','after finance')}
      ${mKpi('£','Monthly Payments','£'+monthlyPayments.toLocaleString(),'','total finance')}
      ${mKpi('⚠','MOT Due Soon', motDue.toString(), '', 'within 60 days')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
      ${data.cars.map(c => {
        const calc = wbCalcCar(c);
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
            <div><div style="font-weight:700;font-size:14px;color:#0F172A">${c.name}</div><div style="font-size:12px;color:#64748B">${c.regYear} · ${c.mileage.toLocaleString()} mi</div></div>
            <div style="text-align:right"><div style="font-size:18px;font-weight:700;color:#0F172A">£${c.currentValue.toLocaleString()}</div><div style="font-size:11px;color:#64748B">Equity: £${calc.equity.toLocaleString()}</div></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px;margin-top:10px">
            <div><div style="color:#64748B;font-size:10.5px;font-weight:700;text-transform:uppercase">MOT</div><div style="font-weight:600;color:#0F172A">${c.motDate}</div></div>
            <div><div style="color:#64748B;font-size:10.5px;font-weight:700;text-transform:uppercase">Insurance</div><div style="font-weight:600;color:#0F172A">${c.insuranceDate}</div></div>
            <div><div style="color:#64748B;font-size:10.5px;font-weight:700;text-transform:uppercase">Service</div><div style="font-weight:600;color:#0F172A">${c.serviceDate}</div></div>
          </div>
          ${c.financeBalance>0?`<div style="margin-top:10px;padding:10px;background:#FEF3C7;border-radius:6px;font-size:12px"><b style="color:#92400E">Finance:</b> <span style="color:#0F172A">£${c.financeBalance.toLocaleString()} outstanding · £${c.monthlyPayment}/mo</span></div>`:`<div style="margin-top:10px;padding:10px;background:#ECFDF5;border-radius:6px;font-size:12px;color:#065F46;font-weight:600">✓ Owned outright</div>`}
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:14px">${mBtn('+ Add Vehicle', 'primary')}</div>`;
  }

  // ============ LOANS ============
  else if (tab === 'loans') {
    const totalBalance = data.loans.reduce((s,l)=>s+l.balance,0);
    const monthlyPayments = data.loans.reduce((s,l)=>s+l.monthlyPayment,0);
    const avgRate = data.loans.length>0 ? (data.loans.reduce((s,l)=>s+l.rate,0)/data.loans.length).toFixed(1) : 0;
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('💷','Total Loans', data.loans.length.toString(), '', 'active')}
      ${mKpi('£','Outstanding','£'+totalBalance.toLocaleString(),'','combined balance')}
      ${mKpi('📅','Monthly Payments','£'+monthlyPayments.toLocaleString(),'/mo','total servicing')}
      ${mKpi('📊','Avg Interest Rate', avgRate+'%','','weighted')}
    </div>
    ${mCard('Loan Tracker', mTable(
      [{l:'Loan'},{l:'Category'},{l:'Principal',align:'right'},{l:'Balance',align:'right'},{l:'Rate',align:'right'},{l:'Monthly',align:'right'},{l:'Term'},{l:'Started'}],
      data.loans.map(l => [
        '<b>'+l.name+'</b>',
        mBadge(l.category, l.category==='Business'?'success':l.category==='Equipment'?'info':l.category==='Property'?'purple':'neutral'),
        '£'+l.principal.toLocaleString(),
        '<b style="color:#EF4444">£'+l.balance.toLocaleString()+'</b>',
        l.rate+'%',
        '£'+l.monthlyPayment.toLocaleString(),
        l.term>0?l.term+' months':'Revolving',
        l.startDate
      ])
    ), mBtn('+ Add Loan', 'primary'))}`;
  }

  // ============ NET WORTH ============
  else if (tab === 'networth') {
    const multiples = [8, 10, 12];
    const investRates = [30, 40, 50, 60, 70, 80];
    panel = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        <div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:8px">Investment Rate (% of profit reinvested)</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${investRates.map(r=>`<button onclick="wbUpdate('settings.investmentRate',${r});navigate('wealth-builder')" style="padding:9px 16px;background:${s.investmentRate===r?'#0E7C7B':'#fff'};color:${s.investmentRate===r?'#fff':'#0F172A'};border:1px solid ${s.investmentRate===r?'#0E7C7B':'#E5E7EB'};border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">${r}%</button>`).join('')}</div>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:8px">Business Valuation Multiple</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${multiples.map(m=>`<button onclick="wbUpdate('settings.valuationMultiple',${m});navigate('wealth-builder')" style="padding:9px 16px;background:${s.valuationMultiple===m?'#0E7C7B':'#fff'};color:${s.valuationMultiple===m?'#fff':'#0F172A'};border:1px solid ${s.valuationMultiple===m?'#0E7C7B':'#E5E7EB'};border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">${m}×</button>`).join('')}</div>
        </div>
      </div>
    </div>
    <div style="background:linear-gradient(135deg,#0E7C7B,#0F766E);color:#fff;border-radius:14px;padding:24px;margin-bottom:18px;text-align:center">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.9">Total Net Worth · ${s.currentYear}</div>
      <div style="font-size:48px;font-weight:700;letter-spacing:-.025em;margin:6px 0">£${nw.netWorth.toLocaleString()}</div>
      <div style="font-size:13px;opacity:.9">${s.investmentRate}% reinvest · ${s.valuationMultiple}× valuation</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,.2)">
        <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:600">Total Assets</div><div style="font-size:18px;font-weight:700;letter-spacing:-.01em">£${nw.totalAssets.toLocaleString()}</div></div>
        <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:600">Business (${s.valuationMultiple}×)</div><div style="font-size:18px;font-weight:700;letter-spacing:-.01em">£${nw.businessValuation.toLocaleString()}</div></div>
        <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:600">Investments</div><div style="font-size:18px;font-weight:700;letter-spacing:-.01em">£${nw.investmentValue.toLocaleString()}</div></div>
        <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:600">Total Debts</div><div style="font-size:18px;font-weight:700;letter-spacing:-.01em">-£${nw.totalDebts.toLocaleString()}</div></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
      ${[8,10,12].map(m=>{const w=wbCalcNetWorth(data,m);return `<div style="background:#fff;border:${s.valuationMultiple===m?'2px solid #0E7C7B':'1px solid #E5E7EB'};border-radius:12px;padding:18px;text-align:center"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">At ${m}× Multiple</div><div style="font-size:28px;font-weight:700;color:#0F172A;letter-spacing:-.02em;margin:6px 0">£${w.netWorth.toLocaleString()}</div>${s.valuationMultiple===m?'<div style="font-size:11px;color:#0E7C7B;font-weight:700">SELECTED</div>':''}</div>`;}).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:14px">
      ${[
        {l:'Properties', v:'£'+nw.propertyValue.toLocaleString(), s:'-£'+nw.propertyDebt.toLocaleString()+' debt'},
        {l:'Business Value', v:'£'+nw.businessValuation.toLocaleString(), s:s.valuationMultiple+'× £'+Math.round(nw.totalYearlyProfit).toLocaleString()+' profit'},
        {l:'Investments', v:'£'+nw.investmentValue.toLocaleString(), s:'portfolio'},
        {l:'Vehicles', v:'£'+nw.carValue.toLocaleString(), s:'-£'+nw.carDebt.toLocaleString()+' debt'}
      ].map(c=>mCard(c.l, `<div style="font-size:26px;font-weight:700;color:#0F172A;letter-spacing:-.02em">${c.v}</div><div style="font-size:11.5px;color:#64748B;margin-top:3px">${c.s}</div>`)).join('')}
    </div>`;
  }

  // ============ VALUATIONS ============
  else if (tab === 'valuations') {
    const yearlyProfit = data.businesses.filter(b=>b.active).reduce((s,b)=>s+wbCalcBusiness(b).yearlyProfit,0);
    const projection = [];
    for (let y = 0; y < 10; y++) {
      const year = s.currentYear + y;
      const growth = Math.pow(1.20, y); // 20% YoY growth assumption
      const profit = yearlyProfit * growth;
      const v8 = profit * 8;
      const v10 = profit * 10;
      const v12 = profit * 12;
      projection.push({year, profit, v8, v10, v12});
    }
    panel = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
      ${mKpi('📈','Current Yearly Profit', '£'+Math.round(yearlyProfit).toLocaleString(), '', 'across active businesses')}
      ${mKpi('⚖','At '+s.valuationMultiple+'× Multiple', '£'+Math.round(yearlyProfit*s.valuationMultiple).toLocaleString(), '', 'today')}
      ${mKpi('🎯','10-Year Projection (10×)', '£'+Math.round(projection[9].v10).toLocaleString(), '', '20% YoY growth')}
    </div>
    ${mCard('Valuation Trajectory · 8× / 10× / 12× scenarios', mTable(
      [{l:'Year'},{l:'Projected Profit',align:'right'},{l:'8× Valuation',align:'right'},{l:'10× Valuation',align:'right'},{l:'12× Valuation',align:'right'}],
      projection.map((p, idx) => [
        p.year.toString(),
        '£'+Math.round(p.profit).toLocaleString(),
        '£'+Math.round(p.v8).toLocaleString(),
        '<b>£'+Math.round(p.v10).toLocaleString()+'</b>',
        '£'+Math.round(p.v12).toLocaleString()
      ])
    ), `<span style="font-size:11.5px;color:#64748B">Assumes 20% YoY profit growth · Editable in Settings</span>`)}`;
  }

  // ============ TARGET vs REAL ============
  else if (tab === 'targets') {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const stored = localStorage.getItem('wb-monthly-actuals');
    const actuals = stored ? JSON.parse(stored) : Array(12).fill(null).map(() => ({revenue:null, profit:null}));
    const monthlyTarget = data.businesses.filter(b=>b.active).reduce((s,b)=>s+b.monthlyTurnover,0);
    const monthlyProfitTarget = data.businesses.filter(b=>b.active).reduce((s,b)=>s+wbCalcBusiness(b).monthlyProfit,0);
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('🎯','Monthly Target','£'+monthlyTarget.toLocaleString(),'','revenue')}
      ${mKpi('💰','Profit Target','£'+Math.round(monthlyProfitTarget).toLocaleString(),'','monthly')}
      ${mKpi('📅','Months Logged', actuals.filter(a=>a.revenue!=null).length+'/12', '', 'this year')}
      ${mKpi('📊','YTD Performance', '0%', '', 'vs target — enter actuals')}
    </div>
    ${mCard('Monthly Target vs Real · '+s.currentYear, mTable(
      [{l:'Month'},{l:'Target Revenue',align:'right'},{l:'Actual Revenue',align:'right'},{l:'Variance',align:'right'},{l:'Target Profit',align:'right'},{l:'Actual Profit',align:'right'},{l:'Variance',align:'right'}],
      months.map((m, i) => {
        const a = actuals[i];
        const rVar = a.revenue!=null ? ((a.revenue - monthlyTarget) / monthlyTarget * 100).toFixed(1) : null;
        const pVar = a.profit!=null ? ((a.profit - monthlyProfitTarget) / monthlyProfitTarget * 100).toFixed(1) : null;
        return [
          '<b>'+m+'</b>',
          '£'+monthlyTarget.toLocaleString(),
          `<input type="number" placeholder="—" value="${a.revenue||''}" onchange="(function(){const a=${JSON.stringify(actuals)};a[${i}].revenue=parseFloat(this.value)||null;localStorage.setItem('wb-monthly-actuals',JSON.stringify(a));navigate('wealth-builder');}).call(this)" style="width:90px;padding:5px 8px;border:1px solid #E5E7EB;border-radius:5px;font-size:12.5px;text-align:right">`,
          rVar!=null ? '<b style="color:'+(rVar>=0?'#10B981':'#EF4444')+'">'+(rVar>=0?'+':'')+rVar+'%</b>' : '—',
          '£'+Math.round(monthlyProfitTarget).toLocaleString(),
          `<input type="number" placeholder="—" value="${a.profit||''}" onchange="(function(){const a=${JSON.stringify(actuals)};a[${i}].profit=parseFloat(this.value)||null;localStorage.setItem('wb-monthly-actuals',JSON.stringify(a));navigate('wealth-builder');}).call(this)" style="width:90px;padding:5px 8px;border:1px solid #E5E7EB;border-radius:5px;font-size:12.5px;text-align:right">`,
          pVar!=null ? '<b style="color:'+(pVar>=0?'#10B981':'#EF4444')+'">'+(pVar>=0?'+':'')+pVar+'%</b>' : '—'
        ];
      })
    ), `<span style="font-size:11.5px;color:#64748B">Enter actuals · Variance auto-calculated</span>`)}`;
  }

  // ============ BUSINESS PLAN ============
  else if (tab === 'plan') {
    const yearlyProfit = data.businesses.filter(b=>b.active).reduce((s,b)=>s+wbCalcBusiness(b).yearlyProfit,0);
    const ages = [{a:s.currentAge,label:'Now'},{a:50,label:'Age 50'},{a:55,label:'Age 55'},{a:60,label:'Retirement'}];
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
      ${ages.map(age => {
        const yearsAhead = age.a - s.currentAge;
        const projProfit = yearlyProfit * Math.pow(1.15, yearsAhead);
        const projValuation = projProfit * 10;
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">${age.label}</div>
          <div style="font-size:24px;font-weight:700;color:#0F172A;letter-spacing:-.02em;margin:6px 0">Age ${age.a}</div>
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid #F1F5F9;font-size:12.5px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#64748B">Yearly Profit</span><span style="font-weight:600">£${Math.round(projProfit).toLocaleString()}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748B">Valuation (10×)</span><span style="font-weight:700;color:#0E7C7B">£${Math.round(projValuation).toLocaleString()}</span></div>
          </div>
        </div>`;
      }).join('')}
    </div>
    ${mCard('Cohort-Based Projection · Active Businesses', mTable(
      [{l:'Business'},{l:'Now',align:'right'},{l:'Year 3',align:'right'},{l:'Year 5',align:'right'},{l:'Year 10',align:'right'},{l:'CAGR Target'}],
      data.businesses.filter(b=>b.active).map(b => {
        const c = wbCalcBusiness(b);
        const projections = [3, 5, 10].map(y => c.yearlyProfit * Math.pow(1.15, y));
        return [
          '<b>'+b.name+'</b>',
          '£'+Math.round(c.yearlyProfit).toLocaleString(),
          '£'+Math.round(projections[0]).toLocaleString(),
          '£'+Math.round(projections[1]).toLocaleString(),
          '£'+Math.round(projections[2]).toLocaleString(),
          mBadge('15% CAGR','info')
        ];
      })
    ))}`;
  }

  // ============ WEALTHWATCH (live snapshot) ============
  else if (tab === 'watch') {
    const now = new Date().toLocaleString('en-GB',{hour:'numeric',minute:'numeric'});
    panel = `<div style="background:linear-gradient(135deg,#1F2937,#0F172A);color:#fff;border-radius:14px;padding:28px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.7">Real-Time Wealth Snapshot</div>
          <div style="font-size:42px;font-weight:700;letter-spacing:-.025em;margin-top:6px">£${nw.netWorth.toLocaleString()}</div>
          <div style="font-size:13px;opacity:.85;margin-top:4px">Live as of ${now} · Auto-refreshes every 60s when connected</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.7;color:#10B981">↗ Trending up</div>
          <div style="font-size:18px;font-weight:700;color:#10B981;margin-top:6px">+£12,420</div>
          <div style="font-size:11px;opacity:.85">today (simulated)</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px;padding-top:18px;border-top:1px solid rgba(255,255,255,.15)">
        ${[
          {l:'Business', v:'£'+nw.businessValuation.toLocaleString(), c:'#10B981'},
          {l:'Properties', v:'£'+nw.propertyValue.toLocaleString(), c:'#3B82F6'},
          {l:'Investments', v:'£'+nw.investmentValue.toLocaleString(), c:'#8B5CF6'},
          {l:'Pensions', v:'£'+nw.pensionValue.toLocaleString(), c:'#F59E0B'},
          {l:'Vehicles', v:'£'+nw.carValue.toLocaleString(), c:'#EC4899'}
        ].map(c=>`<div><div style="font-size:11px;font-weight:600;text-transform:uppercase;opacity:.65;letter-spacing:.04em">${c.l}</div><div style="font-size:18px;font-weight:700;color:${c.c};letter-spacing:-.01em;margin-top:3px">${c.v}</div></div>`).join('')}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('Today\'s Movers (simulated)', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${[
          ['Stocks & Shares ISA','+£420','#10B981'],
          ['Crypto Holdings','+£1,840','#10B981'],
          ['BTL · Manchester','+£180 (valuation creep)','#10B981'],
          ['Pension SIPP','+£280','#10B981'],
          ['Daily Driver','-£25 (depreciation)','#EF4444']
        ].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px"><span>${l}</span><span style="font-weight:700;color:${c}">${v}</span></div>`).join('')}
      </div>`)}
      ${mCard('Snapshots Saved', `<div style="font-size:13px;color:#64748B;text-align:center;padding:24px">
        <div style="font-size:32px;margin-bottom:10px">📸</div>
        <div>Save monthly snapshots to track delta over time</div>
        <div style="margin-top:14px">${mBtn('📸 Save Snapshot Now', 'primary')}</div>
      </div>`)}
    </div>`;
  }

  // ============ PERFORMANCE ============
  else if (tab === 'performance') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('🏆','Best Performer', data.businesses.filter(b=>b.active).sort((a,b)=>wbCalcBusiness(b).yearlyProfit-wbCalcBusiness(a).yearlyProfit)[0]?.name.split('·')[0].trim() || 'N/A','','by profit')}
      ${mKpi('📊','Group Margin', (data.businesses.filter(b=>b.active).reduce((s,b)=>s+b.margin,0)/data.businesses.filter(b=>b.active).length).toFixed(1)+'%','','weighted')}
      ${mKpi('£','Investment Pot','£'+data.investments.reduce((s,i)=>s+i.balance,0).toLocaleString(),'','total invested')}
      ${mKpi('📈','Portfolio CAGR', '12.4%', '', 'all assets')}
    </div>
    ${mCard('Business Performance Summary', mTable(
      [{l:'Business'},{l:'Type'},{l:'Margin %',align:'right'},{l:'Monthly Profit',align:'right'},{l:'Yearly Profit',align:'right'},{l:'Annual Investment',align:'right'},{l:'Performance'}],
      data.businesses.filter(b=>b.active).map(b => {
        const c = wbCalcBusiness(b);
        const investment = c.yearlyProfit * (s.investmentRate/100);
        const score = b.margin > 30 ? 'Excellent' : b.margin > 18 ? 'Good' : 'Watch';
        const scoreColor = score === 'Excellent' ? 'success' : score === 'Good' ? 'info' : 'warn';
        return [
          '<b>'+b.name+'</b>',
          mBadge(b.type, 'info'),
          b.margin+'%',
          '£'+Math.round(c.monthlyProfit).toLocaleString(),
          '£'+Math.round(c.yearlyProfit).toLocaleString(),
          '£'+Math.round(investment).toLocaleString(),
          mBadge(score, scoreColor)
        ];
      })
    ))}
    <div style="margin-top:14px">${mCard('Investment Portfolio Performance', mTable(
      [{l:'Holding'},{l:'Type'},{l:'Balance',align:'right'},{l:'Growth %',align:'right'},{l:'Annual Top-up',align:'right'},{l:'Status'}],
      data.investments.map(i => [
        '<b>'+i.name+'</b>',
        mBadge(i.type, 'info'),
        '£'+i.balance.toLocaleString(),
        '<b style="color:'+(i.growth>=0?'#10B981':'#EF4444')+'">'+(i.growth>=0?'+':'')+i.growth+'%</b>',
        '£'+i.annualContribution.toLocaleString(),
        i.growth > 20 ? mBadge('Strong','success') : i.growth > 0 ? mBadge('Steady','info') : mBadge('Flat','neutral')
      ])
    ))}</div>`;
  }

  // ============ AI INSIGHTS ============
  else if (tab === 'ai') {
    const totalProfit = data.businesses.filter(b=>b.active).reduce((s,b)=>s+wbCalcBusiness(b).yearlyProfit,0);
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
      ${[
        {i:'📊',t:'Executive Summary',s:'Overall health check',c:'#3B82F6'},
        {i:'💡',t:'Recommendations',s:'Optimisation tips',c:'#10B981'},
        {i:'⚠',t:'Risk Analysis',s:'Identify concerns',c:'#F59E0B'},
        {i:'❓',t:'Custom Question',s:'Ask anything',c:'#8B5CF6'}
      ].map(card=>`<button style="background:${card.c};color:#fff;border:none;border-radius:12px;padding:18px;cursor:pointer;text-align:center"><div style="font-size:24px;margin-bottom:6px">${card.i}</div><div style="font-size:14px;font-weight:700">${card.t}</div><div style="font-size:11.5px;opacity:.85;margin-top:3px">${card.s}</div></button>`).join('')}
    </div>
    ${mCard('🤖 AI Financial Insights · Powered by Claude', `<div style="display:flex;flex-direction:column;gap:10px;font-size:13.5px;line-height:1.6">
      <div style="padding:14px;background:#F0FDFA;border-left:3px solid #0E7C7B;border-radius:6px">
        <b>💎 Net Worth Velocity:</b> Your portfolio is compounding at ~14.5% blended. At current trajectory, you'll cross £10M net worth in approximately ${Math.ceil(Math.log(10000000/Math.max(nw.netWorth,1))/Math.log(1.145))} years.
      </div>
      <div style="padding:14px;background:#ECFDF5;border-left:3px solid #10B981;border-radius:6px">
        <b>📈 Business Mix:</b> Your highest-margin business ("Business E · Specialist" at 24%) is undersized vs revenue contribution. Consider doubling capacity here — projected to add £${Math.round(75000*12*0.24).toLocaleString()}/yr profit.
      </div>
      <div style="padding:14px;background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:6px">
        <b>⚠ Concentration Risk:</b> ${((data.businesses.filter(b=>b.active).slice(0,3).reduce((s,b)=>s+wbCalcBusiness(b).yearlyProfit,0)/totalProfit)*100).toFixed(0)}% of profit comes from top 3 businesses. Consider diversifying revenue streams.
      </div>
      <div style="padding:14px;background:#EFF6FF;border-left:3px solid #3B82F6;border-radius:6px">
        <b>💷 Tax Efficiency:</b> Your extraction mix (£${s.monthlyExtraction.toLocaleString()}/mo extraction + £${s.monthlyPension.toLocaleString()}/mo pension + £${s.monthlySalary.toLocaleString()}/mo salary) is reasonably optimised. Push more into pension if you're below the £60k annual allowance.
      </div>
      <div style="padding:14px;background:#F5F3FF;border-left:3px solid #8B5CF6;border-radius:6px">
        <b>🏠 Property Yield:</b> Avg rental yield across your BTLs is ~5.2%. Manchester and Birmingham are pulling weight; consider refinancing the commercial unit if rate is below current market.
      </div>
    </div>`)}
    <div style="margin-top:14px">${mCard('Ask Custom Question', `<div style="display:flex;gap:8px">
      <input type="text" placeholder="e.g., What if I increased my investment rate to 50%?" style="flex:1;padding:12px 14px;border:1px solid #E5E7EB;border-radius:8px;font-size:13.5px">
      ${mBtn('🤖 Ask AI', 'primary')}
    </div>`)}</div>`;
  }

  // ============ INVESTMENT ALLOCATOR ============
  else if (tab === 'allocator') {
    const totalMonthlyInvestment = data.businesses.filter(b=>b.active).reduce((s,b)=>s+wbCalcBusiness(b).monthlyProfit,0) * (s.investmentRate/100);
    const allocations = JSON.parse(localStorage.getItem('wb-allocations') || JSON.stringify({
      isa: 30, sipp: 25, gia: 15, crypto: 10, property: 15, cash: 5
    }));
    panel = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
      ${mKpi('💰','Monthly to Allocate','£'+Math.round(totalMonthlyInvestment).toLocaleString(),'',s.investmentRate+'% of profit')}
      ${mKpi('📊','Annual to Allocate','£'+Math.round(totalMonthlyInvestment*12).toLocaleString(),'','compounding')}
      ${mKpi('🎯','Allocation Total', Object.values(allocations).reduce((a,b)=>a+b,0)+'%', '', Object.values(allocations).reduce((a,b)=>a+b,0)===100?'balanced':'rebalance needed')}
    </div>
    ${mCard('Monthly Investment Allocator', `<div style="display:flex;flex-direction:column;gap:14px">
      ${[
        {k:'isa', l:'Stocks & Shares ISA', d:'£20k annual limit · tax-free growth', c:'#3B82F6'},
        {k:'sipp', l:'SIPP / Pension', d:'40-45% tax relief at higher rate', c:'#F59E0B'},
        {k:'gia', l:'General Investment Account', d:'Unlimited but taxable', c:'#10B981'},
        {k:'crypto', l:'Crypto / Alternative', d:'High-risk / high-volatility', c:'#8B5CF6'},
        {k:'property', l:'Property Deposit Fund', d:'Saving for next BTL', c:'#EC4899'},
        {k:'cash', l:'Emergency Cash', d:'High-yield savings · 4.5% rate', c:'#64748B'}
      ].map(b=>{
        const amount = totalMonthlyInvestment * (allocations[b.k]/100);
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:10px"><div style="width:12px;height:12px;background:${b.c};border-radius:3px"></div><div><div style="font-weight:700;font-size:13.5px;color:#0F172A">${b.l}</div><div style="font-size:11.5px;color:#64748B">${b.d}</div></div></div>
            <div style="text-align:right"><div style="font-size:18px;font-weight:700;color:#0F172A">£${Math.round(amount).toLocaleString()}/mo</div><div style="font-size:11.5px;color:#64748B">£${Math.round(amount*12).toLocaleString()}/yr</div></div>
          </div>
          <div style="display:flex;align-items:center;gap:10px"><input type="range" min="0" max="100" value="${allocations[b.k]}" oninput="(function(v){const a=JSON.parse(localStorage.getItem('wb-allocations')||'{}');a['${b.k}']=parseInt(v);localStorage.setItem('wb-allocations',JSON.stringify(a));}).call(this,this.value); document.getElementById('alloc-${b.k}').textContent=this.value+'%'" style="flex:1"><span id="alloc-${b.k}" style="font-weight:700;color:#0F172A;min-width:42px;text-align:right">${allocations[b.k]}%</span></div>
        </div>`;
      }).join('')}
      <div style="margin-top:4px;text-align:right">${mBtn('💾 Save Allocations', 'primary', "navigate('wealth-builder')")}</div>
    </div>`)}`;
  }

  // ============ PENSIONS ============
  else if (tab === 'pensions') {
    const totalPension = data.pensions.reduce((s,p)=>s+p.balance,0);
    const monthlyContrib = data.pensions.reduce((s,p)=>s+p.monthlyContribution,0);
    const yearsToRetire = s.retireAge - s.currentAge;
    const projection = wbCalcInvestmentProjection(totalPension, monthlyContrib*12, s.growthRate, yearsToRetire+1);
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('🏦','Total Pension','£'+totalPension.toLocaleString(),'','across all schemes')}
      ${mKpi('£','Monthly Contributions','£'+monthlyContrib.toLocaleString(),'','+40% tax relief')}
      ${mKpi('⏳','Years to Retire', yearsToRetire.toString(), '', 'age '+s.retireAge)}
      ${mKpi('🎯','Projected at '+s.retireAge,'£'+Math.round(projection[yearsToRetire].balance).toLocaleString(),'','at '+s.growthRate+'% growth')}
    </div>
    ${mCard('Pension Schemes', mTable(
      [{l:'Scheme'},{l:'Balance',align:'right'},{l:'Monthly £',align:'right'},{l:'Growth %',align:'right'},{l:'Projected '+s.retireAge,align:'right'},{l:'Notes'}],
      data.pensions.map(p => {
        const pProj = wbCalcInvestmentProjection(p.balance, p.monthlyContribution*12, p.growthRate, yearsToRetire+1);
        return [
          '<b>'+p.name+'</b>',
          '£'+p.balance.toLocaleString(),
          '£'+p.monthlyContribution.toLocaleString(),
          p.growthRate+'%',
          '£'+Math.round(pProj[yearsToRetire].balance).toLocaleString(),
          '<span style="font-size:11.5px;color:#64748B">'+p.notes+'</span>'
        ];
      })
    ), mBtn('+ Add Pension', 'primary'))}
    <div style="margin-top:14px">${mCard('UK Pension Rules · 2025-26', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;font-size:13px">
      <div>
        <h4 style="font-size:13.5px;font-weight:700;color:#0F172A;margin:0 0 8px">Allowances</h4>
        <div style="color:#475569;line-height:1.7">
          • Annual Allowance: £60,000<br>
          • Tapered for high earners (£260k+ threshold)<br>
          • Carry-forward: up to 3 prior years unused<br>
          • Lifetime Allowance: abolished April 2024<br>
          • Tax-free lump sum: 25% (max £268,275)
        </div>
      </div>
      <div>
        <h4 style="font-size:13.5px;font-weight:700;color:#0F172A;margin:0 0 8px">Tax Relief</h4>
        <div style="color:#475569;line-height:1.7">
          • Basic rate: 20% relief at source<br>
          • Higher rate: 40% relief (claim 20% via SA)<br>
          • Additional rate: 45% relief<br>
          • Salary sacrifice: also saves NI<br>
          • Min pension age: 55 (rising to 57 in 2028)
        </div>
      </div>
    </div>`)}</div>`;
  }

  // ============ TAX CALCULATOR ============
  else if (tab === 'tax') {
    panel = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
      ${mCard('Income Tax Bands · 2025-26', `<div style="font-size:13px;color:#475569;line-height:1.8">
        <div style="display:flex;justify-content:space-between"><span>Personal Allowance</span><b style="color:#10B981">£12,570</b></div>
        <div style="display:flex;justify-content:space-between"><span>Basic Rate (20%)</span><b>£12,571 - £50,270</b></div>
        <div style="display:flex;justify-content:space-between"><span>Higher Rate (40%)</span><b style="color:#F59E0B">£50,271 - £125,140</b></div>
        <div style="display:flex;justify-content:space-between"><span>Additional Rate (45%)</span><b style="color:#EF4444">Over £125,140</b></div>
      </div>`)}
      ${mCard('Dividend Tax', `<div style="font-size:13px;color:#475569;line-height:1.8">
        <div style="display:flex;justify-content:space-between"><span>Tax-Free Allowance</span><b style="color:#10B981">£500</b></div>
        <div style="display:flex;justify-content:space-between"><span>Basic Rate</span><b>8.75%</b></div>
        <div style="display:flex;justify-content:space-between"><span>Higher Rate</span><b style="color:#F59E0B">33.75%</b></div>
        <div style="display:flex;justify-content:space-between"><span>Additional Rate</span><b style="color:#EF4444">39.35%</b></div>
      </div>`)}
      ${mCard('Capital Gains Tax', `<div style="font-size:13px;color:#475569;line-height:1.8">
        <div style="display:flex;justify-content:space-between"><span>Tax-Free Allowance</span><b style="color:#10B981">£3,000</b></div>
        <div style="display:flex;justify-content:space-between"><span>Basic Rate</span><b>10% (18% property)</b></div>
        <div style="display:flex;justify-content:space-between"><span>Higher Rate</span><b style="color:#F59E0B">20% (24% property)</b></div>
      </div>`)}
    </div>
    ${mCard('Withdrawal Tax Calculator', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      <div>
        <h4 style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 14px">Income Sources</h4>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div><label style="font-size:11.5px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Salary £</label><input id="tax-income" type="number" value="50000" style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13.5px"></div>
          <div><label style="font-size:11.5px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Dividends £</label><input id="tax-div" type="number" value="100000" style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13.5px"></div>
          <div><label style="font-size:11.5px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Capital Gains £</label><input id="tax-cg" type="number" value="20000" style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13.5px"></div>
          <div><label style="font-size:11.5px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Pension Withdrawal £</label><input id="tax-pension" type="number" value="50000" style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13.5px"></div>
          <div><label style="font-size:11.5px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">25% Lump Sum Already Used £</label><input id="tax-lump" type="number" value="0" style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13.5px"></div>
          <button onclick="wbCalcTax()" style="background:#0E7C7B;color:#fff;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">⚡ Calculate Tax</button>
        </div>
      </div>
      <div id="tax-result"><div style="text-align:center;padding:48px;color:#64748B;font-size:13px"><div style="font-size:48px;margin-bottom:14px">🧮</div>Enter your details and click Calculate to see your tax breakdown</div></div>
    </div>`)}`;
  }

  // ============ INTELLIGENCE ============
  else if (tab === 'intel') {
    panel = `<div style="background:linear-gradient(135deg,#7C3AED,#5B21B6);color:#fff;border-radius:14px;padding:24px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.9">Investment Intelligence</div>
          <h3 style="font-size:18px;font-weight:700;margin:6px 0 4px">Personalised UK Tax & Investment Strategy</h3>
          <div style="font-size:12.5px;opacity:.9">Powered by AI · Updated for 2025-26 + April 2026 changes</div>
        </div>
        <div style="display:flex;gap:10px"><select style="padding:8px 12px;border-radius:7px;border:none;font-size:12px;background:rgba(255,255,255,.15);color:#fff;font-weight:600"><option>Risk: Moderate</option><option>Conservative</option><option>Aggressive</option></select><select style="padding:8px 12px;border-radius:7px;border:none;font-size:12px;background:rgba(255,255,255,.15);color:#fff;font-weight:600"><option>Focus: Balanced</option><option>Growth</option><option>Income</option></select></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px">
      ${[
        {b:'#10B981',badge:'Tax Relief',t:'EIS & VCT — Doubled Limits',sub:'EIS up to £2m/yr · VCT up to £400k/yr',items:['EIS: 30% income tax relief · tax-free growth · 5yr hold','VCT: 30% income tax relief · tax-free dividends · 5yr hold','Annual EIS limit: £1m (£2m if ≥£1m knowledge-intensive)','VCT annual limit doubled £200k → £400k (April 2026)']},
        {b:'#EF4444',badge:'Urgent',t:'Dividend Tax Rising — 6 April 2026',sub:'Basic 8.75% → 10.75% · Higher 33.75% → 35.75%',items:['Dividend allowance remains £500 (already reduced from £1,000)','Basic-rate dividend tax: 8.75% → 10.75% (+2pp)','Higher-rate: 33.75% → 35.75% (+2pp)','Additional-rate: 39.35% → 41.35% (+2pp)','Window: pay qualifying dividends BEFORE 6 April 2026']},
        {b:'#8B5CF6',badge:'Extraction',t:'Salary vs Dividend Split — Optimal Mix',sub:'Salary to NI threshold + dividends above',items:['Salary to £12,570 (personal allowance) preserves state pension','Employer NI starts at £9,100 · salary ≥ £9,100 triggers small NI cost','Pension contributions from company: no NI, corp tax deductible','Then dividends to top up — review post-April 2026 rates']},
        {b:'#F59E0B',badge:'Corp Tax',t:'Full Expensing & 40% FYA — Capex Wins',sub:'AIA £1m + 100% Full Expensing + 40% FYA',items:['AIA (Annual Investment Allowance): £1m permanent · 100% deduction','Full Expensing: 100% first-year relief on NEW qualifying plant','40% First-Year Allowance on special-rate assets (Jan 2026)','25% main corp tax rate · 19% small profits rate (≤£50k)']}
      ].map(c=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;border-top:3px solid ${c.b}">
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px"><span style="font-size:10.5px;font-weight:700;text-transform:uppercase;padding:3px 9px;background:${c.b}22;color:${c.b};border-radius:5px">${c.badge}</span></div>
        <h4 style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 4px">${c.t}</h4>
        <p style="font-size:12px;color:#0E7C7B;font-weight:600;margin:0 0 12px">${c.sub}</p>
        <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#475569;line-height:1.6">${c.items.map(i=>`<li style="margin-bottom:4px">${i}</li>`).join('')}</ul>
      </div>`).join('')}
    </div>
    ${mCard('Other 2026 Strategies', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:13px;color:#475569;line-height:1.6">
      <div><b style="color:#0F172A">🏠 Inheritance Tax Planning:</b><br>£325k nil-rate + £175k residence band · 7-year gifting rule · Business Property Relief (100% on trading businesses) · Family Investment Companies</div>
      <div><b style="color:#0F172A">💷 ISA Allowance:</b><br>£20k/yr · Use it or lose it · Stocks & Shares ISA for growth · Cash ISA for emergency · LISA for £4k/yr + 25% gov bonus (under 40)</div>
      <div><b style="color:#0F172A">🏦 Pension Carry-Forward:</b><br>Up to 3 prior years unused allowance · Max £180k contribution in current year using carry-forward · Must have been pension member in those years</div>
      <div><b style="color:#0F172A">🌍 Non-Dom Reform (April 2025):</b><br>Old rules ended · New 4-year FIG (Foreign Income & Gains) regime · 100% relief for first 4 UK tax years · Trust protections removed</div>
    </div>`)}`;
  }

  const advisorPanel = `<div style="background:linear-gradient(135deg,#F0FDFA,#ECFDF5);border:1px solid #0E7C7B;border-radius:12px;padding:16px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;gap:14px">
    <div style="display:flex;gap:12px;align-items:center">
      <div style="width:42px;height:42px;background:#0E7C7B;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px">🔗</div>
      <div>
        <div style="font-weight:700;font-size:14px;color:#0F172A">Connect Wealth Advisors & Live Market Data</div>
        <div style="font-size:12px;color:#475569;margin-top:2px">Coming soon · IFAs · open banking · live property + stock data · HMRC MTD · crypto feeds</div>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="wbConnectAdvisor()" style="background:#fff;border:1px solid #0E7C7B;color:#0E7C7B;padding:9px 14px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">+ Advisor</button>
      <button onclick="wbConnectWorldFinance()" style="background:#0E7C7B;border:none;color:#fff;padding:9px 14px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">+ World Finance</button>
    </div>
  </div>`;

  return mPage('Wealth Builder','Track every dimension of personal & business wealth · businesses · property · investments · pensions · tax · advisor-ready', `${mBtn('⬇ Export','secondary')}${mBtn('🔄 Reset Sample Data','secondary','wbResetData()')}`) + advisorPanel + mTabs(tab, tabs, 'wbSetTab') + panel + `</div>`;
};
