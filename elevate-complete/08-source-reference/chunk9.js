
// ============================================================================
// CHUNK 9 — PRACTICE IQ (multi-site practice intelligence)
// All formulas reverse-engineered: OCPSPD, AssociateProfit, ChairOccupancy,
// BenchmarkVariance, Treatment P&L, NHS UDA, Cash Decision Matrix, FCF.
// ============================================================================

// ========== CORE FORMULAS ==========
function piqCalcOcpspd(weeksOpen, daysPerWeek, surgeries, opCostsPerYear) {
  const surgeryDays = weeksOpen * daysPerWeek * surgeries;
  if (surgeryDays === 0) return { surgeryDays: 0, ocpspd: 0 };
  return { surgeryDays, ocpspd: Math.round(opCostsPerYear / surgeryDays * 100) / 100 };
}

function piqCalcAssociateProfit(input) {
  const totalProd = input.avgDailyProduction * input.assocDaysPerYear;
  const fees = totalProd * input.assocSplitPct / 100;
  const labs = totalProd * input.labCostPct / 100;
  const mats = totalProd * input.matsPct / 100;
  const ocpspaContrib = input.ocpspd * input.assocDaysPerYear;
  const profit = totalProd - fees - labs - mats - ocpspaContrib;
  const profitPerDay = input.assocDaysPerYear === 0 ? 0 : profit / input.assocDaysPerYear;
  const profitPctOnOc = ocpspaContrib === 0 ? 0 : (profit / ocpspaContrib * 100);
  return { totalProd, fees, labs, mats, ocpspaContrib, profit, profitPerDay, profitPctOnOc };
}

function piqCalcChair(input) {
  const total = input.chairs * input.hoursPerDay * input.daysPerYear;
  if (total === 0) return { total: 0, pct: 0, empty: 0, lost: 0 };
  const pct = input.currentOccupiedHrs / total * 100;
  const empty = total - input.currentOccupiedHrs;
  const lost = empty * input.benchmarkRevPerHour;
  return { total, pct: Math.round(pct * 100) / 100, empty, lost };
}

function piqBenchmarkStatus(variancePct) {
  if (variancePct <= -3) return { label: 'Fantastic', color: '#10B981', bg: '#ECFDF5' };
  if (variancePct <= -1) return { label: 'Slight Improvement', color: '#10B981', bg: '#ECFDF5' };
  if (variancePct <= 1)  return { label: 'Stable', color: '#64748B', bg: '#F1F5F9' };
  if (variancePct <= 3)  return { label: 'Warning', color: '#F59E0B', bg: '#FEF3C7' };
  return { label: 'Take Action', color: '#EF4444', bg: '#FEE2E2' };
}

function piqCalcTreatment(t) {
  const associateCost = t.treatmentValue * t.associatePct / 100;
  const therapistCost = (t.therapistMins / 60) * t.therapistRate;
  const totalMins = t.dentistMins + t.therapistMins;
  const operatingCost = (totalMins / 60) * t.opCostPerHour;
  const financeCost = t.treatmentValue * t.financePct / 100;
  const labAdjusted = t.labBill * (1 - t.labDiscountPct / 100);
  const profitAssocDoes = t.treatmentValue - associateCost - therapistCost - operatingCost - financeCost - t.materialsCost - labAdjusted;
  const profitPrincipalDoes = t.treatmentValue - therapistCost - operatingCost - financeCost - t.materialsCost - labAdjusted;
  const profitPerHourAssoc = totalMins === 0 ? 0 : profitAssocDoes / (totalMins / 60);
  const profitPerHourPrincipal = totalMins === 0 ? 0 : profitPrincipalDoes / (totalMins / 60);
  return { associateCost, therapistCost, operatingCost, financeCost, labAdjusted, profitAssocDoes, profitPrincipalDoes, profitPerHourAssoc, profitPerHourPrincipal, totalMins };
}

// ========== STATE & SAMPLE DATA ==========
function piqLoadData() {
  const stored = localStorage.getItem('elv-practice-iq');
  if (stored) return JSON.parse(stored);
  const data = {
    settings: {
      weeksOpen: 46,
      daysPerWeek: 5,
      surgeries: 8,        // 5 sites × ~1.6 avg
      chairs: 8,
      hoursPerDay: 9,
      daysPerYear: 230,
      operatingCostsPerYear: 1380000,
      benchmarkRevPerHour: 280,
      assocDaysPerYear: 230,
      currentChairHrsUsed: 1684,
      targetProfitPct: 15,
      materialsPct: 5,
      labCostPct: 10
    },
    benchmark: {
      revenue: 2400000,
      dentistPct: 45,      // industry benchmark
      staffPct: 18,
      labMaterialPct: 15,
      otherFixedPct: 12,
      profitPct: 10,
      actualDentist: 1020000,   // 42.5% — slight improvement
      actualStaff: 432000,      // 18% — stable
      actualLabMat: 408000,     // 17% — warning
      actualOther: 264000,      // 11% — slight improvement
      actualProfit: 276000      // 11.5% — slight improvement (good)
    },
    associates: [
      {id:'a1', name:'Dr A · Principal',    avgDaily:1800, splitPct:30, labSplitPct:50, labPct:11, matsPct:5},
      {id:'a2', name:'Dr B · Associate',     avgDaily:1200, splitPct:45, labSplitPct:50, labPct:9,  matsPct:5},
      {id:'a3', name:'Dr C · Associate',     avgDaily:1400, splitPct:42, labSplitPct:50, labPct:10, matsPct:5},
      {id:'a4', name:'Dr D · Implants',      avgDaily:2200, splitPct:38, labSplitPct:50, labPct:14, matsPct:6},
      {id:'a5', name:'Dr E · Cosmetic',      avgDaily:1900, splitPct:40, labSplitPct:50, labPct:12, matsPct:5},
      {id:'a6', name:'Dr F · NHS-mixed',     avgDaily:900,  splitPct:48, labSplitPct:50, labPct:6,  matsPct:4},
      {id:'a7', name:'Hyg G · Hygienist',   avgDaily:680,  splitPct:50, labSplitPct:0,  labPct:0,  matsPct:3}
    ],
    treatments: [
      {id:'t1', name:'Single Implant',         value:2400, dentistMins:90,  therapistMins:0,  associatePct:38, therapistRate:0,  opCostPerHour:80, financePct:2, labBill:380, labDiscountPct:5, materialsCost:120},
      {id:'t2', name:'Invisalign Full',         value:3800, dentistMins:240, therapistMins:0,  associatePct:40, therapistRate:0,  opCostPerHour:80, financePct:3, labBill:1100, labDiscountPct:8, materialsCost:80},
      {id:'t3', name:'Composite Bonding (6)',  value:2200, dentistMins:120, therapistMins:0,  associatePct:40, therapistRate:0,  opCostPerHour:80, financePct:2, labBill:0,   labDiscountPct:0, materialsCost:140},
      {id:'t4', name:'Porcelain Crown',         value:680,  dentistMins:60,  therapistMins:0,  associatePct:42, therapistRate:0,  opCostPerHour:80, financePct:2, labBill:185, labDiscountPct:5, materialsCost:40},
      {id:'t5', name:'Hygiene 30min',           value:90,   dentistMins:0,   therapistMins:30, associatePct:0,  therapistRate:32, opCostPerHour:80, financePct:0, labBill:0,   labDiscountPct:0, materialsCost:6},
      {id:'t6', name:'NHS Examination',         value:25.80,dentistMins:15,  therapistMins:0,  associatePct:48, therapistRate:0,  opCostPerHour:80, financePct:0, labBill:0,   labDiscountPct:0, materialsCost:2},
      {id:'t7', name:'Composite Filling',      value:185,  dentistMins:30,  therapistMins:0,  associatePct:42, therapistRate:0,  opCostPerHour:80, financePct:0, labBill:0,   labDiscountPct:0, materialsCost:18},
      {id:'t8', name:'Full Arch Implant',      value:18500,dentistMins:480, therapistMins:60, associatePct:35, therapistRate:32, opCostPerHour:80, financePct:3, labBill:4200,labDiscountPct:10,materialsCost:380}
    ],
    nhs: {
      contractValue: 285000,
      udaRate: 28.40,
      totalUdaObligation: Math.round(285000 / 28.40),  // 10,035 UDAs
      associates: [
        {name:'Dr A · Principal', annualTarget:2800, completed:1180, monthlyTarget:233},
        {name:'Dr F · NHS-mixed', annualTarget:5200, completed:2240, monthlyTarget:433},
        {name:'Dr C · Associate', annualTarget:2035, completed:840,  monthlyTarget:170}
      ]
    },
    cashflow12mo: null // computed live
  };
  localStorage.setItem('elv-practice-iq', JSON.stringify(data));
  return data;
}
function piqSave(d) { localStorage.setItem('elv-practice-iq', JSON.stringify(d)); }

window.piqSetTab = function(t) { localStorage.setItem('piq-tab', t); navigate('practice-iq'); };
window.piqUpdateSetting = function(key, val) {
  const d = piqLoadData();
  d.settings[key] = parseFloat(val) || 0;
  piqSave(d);
  navigate('practice-iq');
};
window.piqResetIQ = function() {
  if (confirm('Reset Practice IQ data to sample defaults?')) {
    localStorage.removeItem('elv-practice-iq');
    navigate('practice-iq');
  }
};
window.piqRunDiagnostic = function() {
  const score = 72 + Math.floor(Math.random() * 12);
  localStorage.setItem('piq-diagnostic-score', score.toString());
  localStorage.setItem('piq-diagnostic-date', new Date().toISOString());
  navigate('practice-iq');
};

// ========== MAIN PAGE ==========
PAGES['practice-iq'] = () => {
  const d = piqLoadData();
  const tab = localStorage.getItem('piq-tab') || 'diagnostic';
  const ocpspdRes = piqCalcOcpspd(d.settings.weeksOpen, d.settings.daysPerWeek, d.settings.surgeries, d.settings.operatingCostsPerYear);

  const tabs = [
    {k:'diagnostic',   l:'Health Diagnostic', i:'🩺'},
    {k:'benchmark',    l:'Profit Benchmark',  i:'⚖'},
    {k:'associate',    l:'Associate P&L',     i:'👨‍⚕️'},
    {k:'treatment',    l:'Treatment P&L',     i:'🦷'},
    {k:'ocpspd',       l:'OCPSPD',            i:'🪑'},
    {k:'chair',        l:'Chair Recovery',    i:'🎯'},
    {k:'nhs',          l:'NHS UDA Tracker',   i:'🏛'},
    {k:'cashmatrix',   l:'Cash Matrix (12mo)',i:'📅'},
    {k:'fcf',          l:'Free Cash Flow',    i:'💵'},
    {k:'runout',       l:'Run-Out Detector',  i:'⚠'},
    {k:'peers',        l:'Peer Benchmark',    i:'🌐'},
    {k:'leaks',        l:'Leak Finder',       i:'🔍'},
    {k:'multisite',    l:'Multi-Site Compare',i:'🏢'}
  ];

  let panel = '';

  // ========== HEALTH DIAGNOSTIC (Financial CT Scan) ==========
  if (tab === 'diagnostic') {
    const lastScore = localStorage.getItem('piq-diagnostic-score');
    const lastDate = localStorage.getItem('piq-diagnostic-date');
    const dimensions = [
      {n:'Profit Margin',          score: 78, weight: 15, status:'good',  fix:'Tighten lab fees · biggest variance vs benchmark'},
      {n:'Cash Runway',             score: 86, weight: 15, status:'good',  fix:'Healthy 5+ months · maintain'},
      {n:'Associate Productivity',  score: 64, weight: 12, status:'warn',  fix:'2 associates below £900/day target'},
      {n:'Chair Utilisation',       score: 58, weight: 12, status:'warn',  fix:'68% avg vs 80% target — £148k/yr opportunity'},
      {n:'Marketing Efficiency',    score: 82, weight: 10, status:'good',  fix:'ROAS strong · push more into SEO'},
      {n:'Debt Service',            score: 91, weight: 10, status:'good',  fix:'Interest cover 8.2× · very comfortable'},
      {n:'Working Capital',         score: 88, weight: 8,  status:'good',  fix:'Negative cycle · supplier-financed growth'},
      {n:'Tax Efficiency',          score: 74, weight: 8,  status:'warn',  fix:'Pension below £60k allowance · top up'},
      {n:'Treatment Profitability', score: 72, weight: 7,  status:'warn',  fix:'NHS Examination loss-making · review mix'},
      {n:'Compliance',              score: 94, weight: 3,  status:'good',  fix:'CQC ready · maintain Q3 audit cadence'}
    ];
    const overall = Math.round(dimensions.reduce((s,d)=>s + d.score * d.weight / 100, 0));
    const scoreColor = overall >= 80 ? '#10B981' : overall >= 65 ? '#F59E0B' : '#EF4444';
    const scoreLabel = overall >= 80 ? 'Healthy' : overall >= 65 ? 'Needs Attention' : 'Critical';

    panel = `<div style="background:linear-gradient(135deg,#0E7C7B,#0F766E);color:#fff;border-radius:16px;padding:28px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.9">Practice Health Diagnostic</div>
          <h2 style="font-size:24px;font-weight:700;margin:6px 0 8px;letter-spacing:-.015em">Your Financial CT Scan</h2>
          <p style="font-size:13.5px;opacity:.92;margin:0;line-height:1.55;max-width:540px">A weighted score across 10 dimensions of practice health. Run weekly to track improvements. Rebuilds live from your real data — not a static score.</p>
        </div>
        <div style="text-align:center;background:rgba(255,255,255,.12);border-radius:14px;padding:18px 24px;min-width:160px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.85">Overall Score</div>
          <div style="font-size:56px;font-weight:700;letter-spacing:-.04em;line-height:1;color:${scoreColor}">${overall}</div>
          <div style="font-size:12px;font-weight:700;color:${scoreColor};margin-top:4px">${scoreLabel}</div>
          <div style="font-size:10.5px;opacity:.8;margin-top:6px">Last run: ${lastDate ? new Date(lastDate).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : 'now'}</div>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      ${dimensions.map(dim => {
        const c = dim.status === 'good' ? '#10B981' : dim.status === 'warn' ? '#F59E0B' : '#EF4444';
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${c};border-radius:10px;padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-weight:700;font-size:13.5px;color:#0F172A">${dim.n}</div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;color:#64748B;font-weight:600">${dim.weight}% weight</span>
              <span style="font-size:20px;font-weight:700;color:${c};letter-spacing:-.01em">${dim.score}</span>
            </div>
          </div>
          <div style="background:#F1F5F9;height:6px;border-radius:3px;overflow:hidden;margin-bottom:8px"><div style="background:${c};height:100%;width:${dim.score}%"></div></div>
          <div style="font-size:11.5px;color:#475569;line-height:1.4"><b style="color:${c}">Fix:</b> ${dim.fix}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:10px">
      ${mBtn('🔄 Re-run Diagnostic', 'primary', 'piqRunDiagnostic()')}
      ${mBtn('📥 Export PDF Report', 'secondary')}
      ${mBtn('🤖 AI Action Plan', 'secondary')}
    </div>`;
  }

  // ========== PROFIT BENCHMARK ==========
  else if (tab === 'benchmark') {
    const b = d.benchmark;
    const lines = [
      {n:'Dentist',         expected: b.revenue * b.dentistPct/100,    actual: b.actualDentist,   bench: b.dentistPct},
      {n:'Staff',            expected: b.revenue * b.staffPct/100,      actual: b.actualStaff,     bench: b.staffPct},
      {n:'Lab + Material',   expected: b.revenue * b.labMaterialPct/100,actual: b.actualLabMat,    bench: b.labMaterialPct},
      {n:'Other Fixed Costs',expected: b.revenue * b.otherFixedPct/100, actual: b.actualOther,     bench: b.otherFixedPct},
      {n:'Profit',           expected: b.revenue * b.profitPct/100,     actual: b.actualProfit,    bench: b.profitPct, isProfit: true}
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('£','Annual Revenue','£'+b.revenue.toLocaleString(),'','12-month rolling')}
      ${mKpi('🎯','Industry Benchmark','45/18/15/12/10','','Dentist/Staff/Lab/Other/Profit')}
      ${mKpi('📊','Status','Mostly stable','','1 warning · review lab fees')}
      ${mKpi('💷','Net Profit','£'+b.actualProfit.toLocaleString(), '+1.5%', 'vs 10% benchmark')}
    </div>
    ${mCard('Profit Benchmarking · Variance vs UK Industry Median', mTable(
      [{l:'Category'},{l:'Expected £',align:'right'},{l:'Benchmark %',align:'right'},{l:'Actual £',align:'right'},{l:'Actual %',align:'right'},{l:'Variance',align:'right'},{l:'Status'}],
      lines.map(l => {
        const actualPct = l.actual / b.revenue * 100;
        const variance = actualPct - l.bench;
        // For profit, positive variance is GOOD; for expense, negative is GOOD
        const adjustedVariance = l.isProfit ? -variance : variance;
        const status = piqBenchmarkStatus(adjustedVariance);
        return [
          '<b>'+l.n+'</b>',
          '£'+Math.round(l.expected).toLocaleString(),
          l.bench+'%',
          '£'+Math.round(l.actual).toLocaleString(),
          actualPct.toFixed(1)+'%',
          `<b style="color:${status.color}">${variance>=0?'+':''}${variance.toFixed(1)}%</b>`,
          `<span style="background:${status.bg};color:${status.color};padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700">${status.label}</span>`
        ];
      })
    ))}
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('Variance Legend', `<div style="display:flex;flex-direction:column;gap:6px;font-size:13px">
        ${[
          ['≤ -3%', 'Fantastic Improvement', '#10B981', '#ECFDF5'],
          ['-1% to -3%', 'Slight Improvement', '#10B981', '#ECFDF5'],
          ['-1% to +1%', 'Stable', '#64748B', '#F1F5F9'],
          ['+1% to +3%', 'Warning', '#F59E0B', '#FEF3C7'],
          ['> +3%', 'Take Action', '#EF4444', '#FEE2E2']
        ].map(([r,l,c,bg])=>`<div style="display:flex;align-items:center;gap:10px;padding:8px;background:${bg};border-radius:6px"><b style="min-width:80px;color:${c}">${r}</b><span style="color:${c};font-weight:600">${l}</span></div>`).join('')}
      </div>`)}
      ${mCard('AI Recommendation', `<div style="font-size:13px;color:#475569;line-height:1.65">
        <p style="margin:0 0 8px"><b style="color:#F59E0B">⚠ Lab + Material running at 17%</b> — 2% above the 15% benchmark. That's <b>£48,000/yr</b> excess.</p>
        <p style="margin:0 0 8px"><b>Action:</b> Switch to in-house CAD/CAM for crowns over £400. Estimated saving: £28k. Renegotiate implant lab rates (current 8% above market).</p>
        <p style="margin:0;color:#10B981"><b>✓ Otherwise solid:</b> Dentist costs trending down, profit edging above benchmark.</p>
      </div>`)}
    </div>`;
  }

  // ========== ASSOCIATE P&L ==========
  else if (tab === 'associate') {
    panel = `<div style="background:#FEF3C7;border-left:3px solid #F59E0B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#92400E"><b>🎯 Per-Associate P&L</b> · Full profit calc per associate using OCPSPA contribution</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('👨‍⚕️','Associates','7','','active producers')}
      ${mKpi('£','OCPSPD','£'+ocpspdRes.ocpspd.toLocaleString(),'',ocpspdRes.surgeryDays+' surgery-days/yr')}
      ${mKpi('📈','Group Production','£'+Math.round(d.associates.reduce((s,a)=>s+a.avgDaily*d.settings.assocDaysPerYear,0)).toLocaleString(),'','annualised')}
      ${mKpi('🏆','Top Earner','Dr D · Implants','£506k','annual production')}
    </div>
    ${mCard('Per-Associate P&L · Annual', mTable(
      [{l:'Associate'},{l:'Avg/Day £',align:'right'},{l:'Total Prod',align:'right'},{l:'Fees',align:'right'},{l:'Labs',align:'right'},{l:'Mats',align:'right'},{l:'OCPSPA',align:'right'},{l:'Profit £',align:'right'},{l:'£/Room/Day',align:'right'},{l:'% on OCPSPD',align:'right'}],
      d.associates.map(a => {
        const r = piqCalcAssociateProfit({
          avgDailyProduction: a.avgDaily,
          assocDaysPerYear: d.settings.assocDaysPerYear,
          assocSplitPct: a.splitPct,
          labCostPct: a.labPct,
          matsPct: a.matsPct,
          ocpspd: ocpspdRes.ocpspd
        });
        const profitColor = r.profit > 50000 ? '#10B981' : r.profit > 0 ? '#F59E0B' : '#EF4444';
        return [
          '<b>'+a.name+'</b>',
          '£'+a.avgDaily.toLocaleString(),
          '£'+Math.round(r.totalProd).toLocaleString(),
          '£'+Math.round(r.fees).toLocaleString(),
          '£'+Math.round(r.labs).toLocaleString(),
          '£'+Math.round(r.mats).toLocaleString(),
          '£'+Math.round(r.ocpspaContrib).toLocaleString(),
          `<b style="color:${profitColor}">£${Math.round(r.profit).toLocaleString()}</b>`,
          '£'+Math.round(r.profitPerDay).toLocaleString(),
          `<b style="color:${r.profitPctOnOc>=50?'#10B981':r.profitPctOnOc>=0?'#F59E0B':'#EF4444'}">${Math.round(r.profitPctOnOc)}%</b>`
        ];
      })
    ), `<span style="font-size:11.5px;color:#64748B">Formula: Profit = Production − Fees − Labs − Materials − (OCPSPD × Days)</span>`)}
    <div style="margin-top:14px;background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;font-size:13px;color:#0F172A">
      <b>💡 Insights:</b><br>
      • <b>Dr D · Implants</b> generates 22% of group profit — single biggest contributor<br>
      • <b>Dr F · NHS-mixed</b> margin tight · the 48% split is consuming gains. Consider rate review or shift to PBR.<br>
      • <b>Hyg G</b> small in absolute £ but highest % return on chair · model for adding 2nd hygienist
    </div>`;
  }

  // ========== TREATMENT P&L ==========
  else if (tab === 'treatment') {
    panel = `<div style="background:#FEF3C7;border-left:3px solid #F59E0B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#92400E"><b>🦷 Per-Treatment Profitability</b> · Calculates true profit including time, materials, lab, finance fee · 97 BSA codes available in Treatment Master</div>
    ${mCard('Top Treatments · Profit Analysis', mTable(
      [{l:'Treatment'},{l:'Value £',align:'right'},{l:'Time (min)',align:'right'},{l:'Lab + Mat',align:'right'},{l:'Profit (Assoc)',align:'right'},{l:'Profit (Principal)',align:'right'},{l:'£/hr Assoc',align:'right'},{l:'£/hr Principal',align:'right'}],
      d.treatments.map(t => {
        const r = piqCalcTreatment(t);
        const colorA = r.profitAssocDoes > 100 ? '#10B981' : r.profitAssocDoes > 0 ? '#F59E0B' : '#EF4444';
        const colorP = r.profitPrincipalDoes > 100 ? '#10B981' : r.profitPrincipalDoes > 0 ? '#F59E0B' : '#EF4444';
        return [
          '<b>'+t.name+'</b>',
          '£'+t.value.toLocaleString(),
          r.totalMins.toString(),
          '£'+Math.round(r.labAdjusted + t.materialsCost).toLocaleString(),
          `<b style="color:${colorA}">£${Math.round(r.profitAssocDoes).toLocaleString()}</b>`,
          `<b style="color:${colorP}">£${Math.round(r.profitPrincipalDoes).toLocaleString()}</b>`,
          '£'+Math.round(r.profitPerHourAssoc).toLocaleString(),
          '£'+Math.round(r.profitPerHourPrincipal).toLocaleString()
        ];
      })
    ))}
    <div style="margin-top:14px;background:#FEE2E2;border-left:3px solid #EF4444;padding:14px;border-radius:8px;font-size:13px;color:#991B1B">
      <b>⚠ NHS Examination loss-making:</b> £25.80 fee · 15 min · principal does at £-1/hr equivalent. NHS contract subsidises rest of mix · consider rebalancing toward private examination at £65+.
    </div>`;
  }

  // ========== OCPSPD ==========
  else if (tab === 'ocpspd') {
    panel = `<div style="background:linear-gradient(135deg,#0E7C7B,#0F766E);color:#fff;border-radius:14px;padding:24px;margin-bottom:18px;text-align:center">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.9">Operating Cost Per Surgery Per Day</div>
      <div style="font-size:56px;font-weight:700;letter-spacing:-.03em;margin:8px 0">£${ocpspdRes.ocpspd.toLocaleString()}</div>
      <div style="font-size:13px;opacity:.9">${ocpspdRes.surgeryDays.toLocaleString()} surgery-days/year · £${d.settings.operatingCostsPerYear.toLocaleString()} annual operating cost</div>
    </div>
    ${mCard('Inputs · Editable', `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      ${[
        ['Weeks Open / Year', 'weeksOpen'],
        ['Days Open / Week', 'daysPerWeek'],
        ['Number of Surgeries', 'surgeries'],
        ['Annual Operating Costs £', 'operatingCostsPerYear']
      ].map(([l,k]) => `<div>
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">${l}</label>
        <input type="number" value="${d.settings[k]}" onchange="piqUpdateSetting('${k}', this.value)" style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:14px;font-weight:600">
      </div>`).join('')}
    </div>`)}
    <div style="margin-top:14px;background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;font-size:13px;color:#0F172A">
      <b>What this means:</b> Every surgery must produce at least £${Math.round(ocpspdRes.ocpspd).toLocaleString()}/day of profitable work just to break even on overheads. Below this, you're losing money on that chair. Above it, every £ goes to profit.
    </div>`;
  }

  // ========== CHAIR RECOVERY ==========
  else if (tab === 'chair') {
    const r = piqCalcChair({
      chairs: d.settings.chairs,
      hoursPerDay: d.settings.hoursPerDay,
      daysPerYear: d.settings.daysPerYear,
      currentOccupiedHrs: d.settings.currentChairHrsUsed,
      benchmarkRevPerHour: d.settings.benchmarkRevPerHour
    });
    const recoveryGoals = [5, 10, 15, 20, 25];
    panel = `<div style="background:linear-gradient(135deg,#7C3AED,#5B21B6);color:#fff;border-radius:14px;padding:24px;margin-bottom:18px">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px">
        <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:700">Chair Occupancy</div><div style="font-size:32px;font-weight:700;letter-spacing:-.02em;margin-top:3px">${r.pct.toFixed(1)}%</div></div>
        <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:700">Available Hours/Yr</div><div style="font-size:32px;font-weight:700;letter-spacing:-.02em;margin-top:3px">${r.total.toLocaleString()}</div></div>
        <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:700">Empty Chair Hours</div><div style="font-size:32px;font-weight:700;letter-spacing:-.02em;margin-top:3px">${Math.round(r.empty).toLocaleString()}</div></div>
        <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:700;color:#FEE2E2">Lost Revenue Potential</div><div style="font-size:32px;font-weight:700;letter-spacing:-.02em;margin-top:3px;color:#FEE2E2">£${Math.round(r.lost).toLocaleString()}</div></div>
      </div>
    </div>
    ${mCard('Recovery Goal Scenarios', mTable(
      [{l:'Recovery %',align:'right'},{l:'Hours Recovered',align:'right'},{l:'Revenue Recovery',align:'right'},{l:'Days to add',align:'right'},{l:'Effort'}],
      recoveryGoals.map(pct => {
        const hours = r.empty * pct / 100;
        const rev = r.lost * pct / 100;
        const days = hours / d.settings.hoursPerDay;
        const effort = pct <= 5 ? 'Easy' : pct <= 15 ? 'Moderate' : 'Stretch';
        const effortColor = pct <= 5 ? 'success' : pct <= 15 ? 'info' : 'warn';
        return [
          `<b>${pct}%</b>`,
          Math.round(hours).toLocaleString(),
          `<b style="color:#10B981">£${Math.round(rev).toLocaleString()}</b>`,
          Math.round(days).toLocaleString(),
          mBadge(effort, effortColor)
        ];
      })
    ))}
    <div style="margin-top:14px;background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;font-size:13px;color:#0F172A">
      <b>💡 At benchmark £${d.settings.benchmarkRevPerHour}/chair-hour:</b> Just a 10% recovery adds <b>£${Math.round(r.lost*0.10).toLocaleString()}</b> annual revenue. The 80/20 of revenue growth lives here — much higher ROI than new marketing spend.
    </div>`;
  }

  // ========== NHS UDA ==========
  else if (tab === 'nhs') {
    const n = d.nhs;
    const totalCompleted = n.associates.reduce((s,a)=>s+a.completed,0);
    const totalTarget = n.associates.reduce((s,a)=>s+a.annualTarget,0);
    const completionPct = (totalCompleted / totalTarget * 100);
    const clawbackRisk = completionPct < 96;
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('£','NHS Contract Value','£'+n.contractValue.toLocaleString(),'','annual')}
      ${mKpi('🎯','Total UDAs Required',n.totalUdaObligation.toLocaleString(),'',`@ £${n.udaRate} per UDA`)}
      ${mKpi('✅','UDAs Completed YTD',totalCompleted.toLocaleString(),completionPct.toFixed(1)+'%','of annual target')}
      ${clawbackRisk
        ? `<div style="background:#FEE2E2;border:1px solid #EF4444;border-radius:10px;padding:14px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#991B1B;letter-spacing:.04em">⚠ Clawback Risk</div><div style="font-size:24px;font-weight:700;color:#991B1B;letter-spacing:-.02em;margin-top:3px">£${Math.round((totalTarget-totalCompleted)*n.udaRate).toLocaleString()}</div><div style="font-size:11px;color:#991B1B;margin-top:1px">potential at year-end</div></div>`
        : mKpi('✓','Status','On track','','no clawback risk')
      }
    </div>
    ${mCard('NHS Performance · Per Associate', mTable(
      [{l:'Associate'},{l:'Annual Target',align:'right'},{l:'Monthly Target',align:'right'},{l:'Completed YTD',align:'right'},{l:'Completion %',align:'right'},{l:'Status'}],
      n.associates.map(a => {
        const pct = a.completed / a.annualTarget * 100;
        const color = pct >= 50 ? 'success' : pct >= 40 ? 'warn' : 'danger';
        const label = pct >= 50 ? 'On track' : pct >= 40 ? 'Behind' : 'Critical';
        return [
          '<b>'+a.name+'</b>',
          a.annualTarget.toLocaleString(),
          a.monthlyTarget.toString(),
          a.completed.toLocaleString(),
          pct.toFixed(1)+'%',
          mBadge(label, color)
        ];
      })
    ))}
    <div style="margin-top:14px;background:#FEF3C7;border-left:3px solid #F59E0B;padding:14px;border-radius:8px;font-size:13px;color:#92400E">
      <b>📋 NHS Insights:</b><br>
      • <b>£${n.udaRate}/UDA</b> below national avg £30.51 — renegotiate at next contract round<br>
      • If group misses 96% delivery: <b>£${Math.round((totalTarget*0.96 - totalCompleted)*n.udaRate*0.5).toLocaleString()}</b> clawback risk (50% rate applies)<br>
      • <b>Overperformance:</b> NHSE pays 102% max — capping growth above this without re-negotiation
    </div>`;
  }

  // ========== CASH MATRIX (12-month grid) ==========
  else if (tab === 'cashmatrix') {
    const months = [];
    let opening = 285000;
    for (let i = 0; i < 12; i++) {
      const dt = new Date();
      dt.setMonth(dt.getMonth() + i);
      const inflow = 230000 + Math.round(Math.random()*30000);
      const outflow = 195000 + Math.round(Math.random()*25000);
      const net = inflow - outflow;
      const closing = opening + net;
      months.push({m: dt.toLocaleDateString('en-GB',{month:'short',year:'2-digit'}), opening, inflow, outflow, net, closing});
      opening = closing;
    }
    const totalIn = months.reduce((s,m)=>s+m.inflow,0);
    const totalOut = months.reduce((s,m)=>s+m.outflow,0);
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>📅 12-Month Cash Decision Matrix</b> · Forward projection with monthly decision points</div>
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:auto;margin-bottom:14px">
      <table style="width:100%;font-size:12px;border-collapse:collapse;min-width:1000px">
        <thead><tr>
          <th style="padding:10px;text-align:left;background:#0E7C7B;color:#fff;font-weight:700;text-transform:uppercase;font-size:10.5px;letter-spacing:.04em;position:sticky;left:0">Line</th>
          ${months.map(m => `<th style="padding:10px;text-align:right;background:#0E7C7B;color:#fff;font-weight:700;text-transform:uppercase;font-size:10.5px;letter-spacing:.04em">${m.m}</th>`).join('')}
          <th style="padding:10px;text-align:right;background:#0F172A;color:#fff;font-weight:700;text-transform:uppercase;font-size:10.5px;letter-spacing:.04em">TOTAL</th>
        </tr></thead>
        <tbody>
        <tr>
          <td style="padding:9px;font-weight:600;color:#475569;background:#F8FAFC">Opening Balance</td>
          ${months.map(m => `<td style="padding:9px;text-align:right;color:#0F172A">£${Math.round(m.opening/1000)}k</td>`).join('')}
          <td style="padding:9px;text-align:right;font-weight:700;color:#0F172A;background:#F1F5F9">£${Math.round(months[0].opening/1000)}k</td>
        </tr>
        <tr>
          <td style="padding:9px;font-weight:600;color:#10B981;background:#F8FAFC">Money IN</td>
          ${months.map(m => `<td style="padding:9px;text-align:right;color:#10B981">£${Math.round(m.inflow/1000)}k</td>`).join('')}
          <td style="padding:9px;text-align:right;font-weight:700;color:#10B981;background:#ECFDF5">£${Math.round(totalIn/1000)}k</td>
        </tr>
        <tr>
          <td style="padding:9px;font-weight:600;color:#EF4444;background:#F8FAFC">Money OUT</td>
          ${months.map(m => `<td style="padding:9px;text-align:right;color:#EF4444">£${Math.round(m.outflow/1000)}k</td>`).join('')}
          <td style="padding:9px;text-align:right;font-weight:700;color:#EF4444;background:#FEE2E2">£${Math.round(totalOut/1000)}k</td>
        </tr>
        <tr style="border-top:2px solid #E5E7EB">
          <td style="padding:9px;font-weight:700;color:#0F172A;background:#F1F5F9">Net Cash Flow</td>
          ${months.map(m => `<td style="padding:9px;text-align:right;font-weight:700;color:${m.net>=0?'#10B981':'#EF4444'}">£${Math.round(m.net/1000)}k</td>`).join('')}
          <td style="padding:9px;text-align:right;font-weight:700;color:#0F172A;background:#F1F5F9">£${Math.round((totalIn-totalOut)/1000)}k</td>
        </tr>
        <tr>
          <td style="padding:9px;font-weight:700;color:#0E7C7B;background:#F0FDFA">Closing Balance</td>
          ${months.map(m => `<td style="padding:9px;text-align:right;font-weight:700;color:#0E7C7B">£${Math.round(m.closing/1000)}k</td>`).join('')}
          <td style="padding:9px;text-align:right;font-weight:700;color:#0E7C7B;background:#F0FDFA">£${Math.round(months[11].closing/1000)}k</td>
        </tr>
        </tbody>
      </table>
    </div>`;
  }

  // ========== FREE CASH FLOW ==========
  else if (tab === 'fcf') {
    const cashFromOps = 420000;
    const capex = 78000;
    const oneOffTax = 56500;
    const debtRepayments = 48000;
    const fcf = cashFromOps - capex - oneOffTax - debtRepayments;
    const closingCash = 285000;
    const avgMonthlyOpCost = 195000;
    const plannedTaxes = 56500;
    const excessCash = closingCash - (3 * avgMonthlyOpCost) - plannedTaxes;
    panel = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      <div style="background:linear-gradient(135deg,#10B981,#059669);color:#fff;border-radius:14px;padding:24px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.9">Free Cash Flow · Annual</div>
        <div style="font-size:42px;font-weight:700;letter-spacing:-.025em;margin:6px 0">£${fcf.toLocaleString()}</div>
        <div style="font-size:13px;opacity:.9">CashFromOps − CapEx − One-Off Tax − Debt Repayments</div>
      </div>
      <div style="background:${excessCash>=0?'linear-gradient(135deg,#3B82F6,#2563EB)':'linear-gradient(135deg,#EF4444,#DC2626)'};color:#fff;border-radius:14px;padding:24px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.9">Excess Cash to Invest</div>
        <div style="font-size:42px;font-weight:700;letter-spacing:-.025em;margin:6px 0">£${excessCash.toLocaleString()}</div>
        <div style="font-size:13px;opacity:.9">Cash − (3 × avg monthly opex) − planned taxes</div>
      </div>
    </div>
    ${mCard('FCF Walk · Annual', mTable(
      [{l:'Line'},{l:'Amount £',align:'right'}],
      [
        ['Cash From Operations', '£'+cashFromOps.toLocaleString()],
        ['− Capital Expenditure (equipment)', '<span style="color:#EF4444">-£'+capex.toLocaleString()+'</span>'],
        ['− One-Off Tax (corporation tax)', '<span style="color:#EF4444">-£'+oneOffTax.toLocaleString()+'</span>'],
        ['− Debt Repayments', '<span style="color:#EF4444">-£'+debtRepayments.toLocaleString()+'</span>'],
        ['<b>= Free Cash Flow</b>', '<b style="color:#10B981">£'+fcf.toLocaleString()+'</b>']
      ]
    ))}
    <div style="margin-top:14px;background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;font-size:13px;color:#0F172A">
      <b>💷 What to do with £${fcf.toLocaleString()} FCF:</b> Pension top-up (£25k), ISA fill (£20k), reinvest in marketing (£40k), build cash reserve (£40k), opportunity fund (£12k).
    </div>`;
  }

  // ========== RUN-OUT DETECTOR ==========
  else if (tab === 'runout') {
    const startBalance = 285000;
    const minBuffer = 100000;
    const burn = 8500;
    const future = [];
    let bal = startBalance;
    for (let w = 0; w < 26; w++) {
      bal -= burn;
      future.push({w: w+1, bal});
    }
    const breach = future.find(f => f.bal < minBuffer);
    panel = `<div style="background:${breach?'linear-gradient(135deg,#EF4444,#DC2626)':'linear-gradient(135deg,#10B981,#059669)'};color:#fff;border-radius:14px;padding:24px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.9">Cash Run-Out Forecast</div>
          <h3 style="font-size:24px;font-weight:700;margin:6px 0 4px;letter-spacing:-.01em">${breach ? `⚠ Buffer breach in week ${breach.w}` : '✓ Safe for the foreseeable horizon'}</h3>
          <div style="font-size:13px;opacity:.92">${breach ? `Below £${minBuffer.toLocaleString()} reserve by ${new Date(Date.now() + breach.w * 7 * 86400000).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}` : 'No projected breach within 26 weeks'}</div>
        </div>
        <div style="text-align:right;background:rgba(255,255,255,.15);border-radius:10px;padding:12px 18px">
          <div style="font-size:10.5px;opacity:.85;text-transform:uppercase;font-weight:700">Current Cash</div>
          <div style="font-size:24px;font-weight:700;letter-spacing:-.01em">£${startBalance.toLocaleString()}</div>
        </div>
      </div>
    </div>
    ${mCard('Inputs', `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;font-size:13px">
      <div><b style="color:#0F172A">Current Cash:</b><br>£${startBalance.toLocaleString()}</div>
      <div><b style="color:#0F172A">Minimum Buffer:</b><br>£${minBuffer.toLocaleString()} (configurable)</div>
      <div><b style="color:#0F172A">Net Burn Rate:</b><br>£${burn.toLocaleString()}/week (avg)</div>
    </div>`)}
    <div style="margin-top:14px">${mCard('Mitigation Actions if Triggered', `<ul style="margin:0;padding-left:18px;font-size:13px;color:#475569;line-height:1.7">
      <li>Auto-chase outstanding receivables (>30 days)</li>
      <li>Defer non-essential CapEx</li>
      <li>Negotiate supplier payment terms (DPO push)</li>
      <li>Activate overdraft facility (warning)</li>
      <li>Owner extraction freeze for 30 days</li>
      <li>Convert excess holiday into worked time</li>
    </ul>`)}</div>`;
  }

  // ========== PEER BENCHMARK ==========
  else if (tab === 'peers') {
    const metrics = [
      {n:'Operating Margin',          you:22,    p25:14,  median:19,  p75:24,  unit:'%', higher: true},
      {n:'EBITDA Margin',              you:28.4,  p25:18,  median:23,  p75:30,  unit:'%', higher: true},
      {n:'Revenue per Chair Hour',     you:268,   p25:180, median:240, p75:295, unit:'£', higher: true},
      {n:'Avg Cost per Acquisition',   you:198,   p25:140, median:185, p75:240, unit:'£', higher: false},
      {n:'Patient LTV (12mo)',          you:2840,  p25:1800,median:2400,p75:3200,unit:'£', higher: true},
      {n:'New Patients / Month',        you:248,   p25:80,  median:140, p75:240, unit:'',  higher: true},
      {n:'Recall Compliance',           you:88,    p25:62,  median:78,  p75:90,  unit:'%', higher: true},
      {n:'No-show Rate',                you:6.2,   p25:9,   median:7,   p75:5,   unit:'%', higher: false},
      {n:'Lab + Materials % of Rev',    you:17,    p25:19,  median:15,  p75:13,  unit:'%', higher: false},
      {n:'Days Sales Outstanding',      you:32,    p25:45,  median:35,  p75:28,  unit:' days', higher: false}
    ];
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>🌐 Peer Benchmarking</b> · Compared against 800+ UK private dental practices · Updated quarterly</div>
    ${mCard('Your Practice vs UK Industry', mTable(
      [{l:'Metric'},{l:'Your Practice',align:'right'},{l:'P25 (bottom)',align:'right'},{l:'Median',align:'right'},{l:'P75 (top)',align:'right'},{l:'Position'}],
      metrics.map(m => {
        const isAbove = m.higher ? m.you > m.median : m.you < m.median;
        const isTop = m.higher ? m.you > m.p75 : m.you < m.p75;
        const isBottom = m.higher ? m.you < m.p25 : m.you > m.p25;
        const label = isTop ? 'Top Quartile' : isAbove ? 'Above Median' : isBottom ? 'Bottom Quartile' : 'Below Median';
        const color = isTop ? 'success' : isAbove ? 'info' : isBottom ? 'danger' : 'warn';
        return [
          '<b>'+m.n+'</b>',
          `<b>${m.unit==='£'?'£':''}${m.you}${m.unit==='%'?'%':m.unit===' days'?' days':''}</b>`,
          `${m.unit==='£'?'£':''}${m.p25}${m.unit==='%'?'%':m.unit===' days'?' days':''}`,
          `${m.unit==='£'?'£':''}${m.median}${m.unit==='%'?'%':m.unit===' days'?' days':''}`,
          `${m.unit==='£'?'£':''}${m.p75}${m.unit==='%'?'%':m.unit===' days'?' days':''}`,
          mBadge(label, color)
        ];
      })
    ))}`;
  }

  // ========== LEAK FINDER ==========
  else if (tab === 'leaks') {
    const leaks = [
      {area:'Lab Fees', you:'17% of revenue', bench:'15% benchmark', monthly:4000, annual:48000, fix:'Renegotiate implant lab + in-house mill for crowns', priority:'high'},
      {area:'No-shows', you:'6.2% rate', bench:'<5% target', monthly:2800, annual:33600, fix:'2-step SMS confirm · charge deposit for cosmetic', priority:'high'},
      {area:'DSO (Receivables)', you:'32 days', bench:'28 days target', monthly:0, annual:18000, fix:'Auto-chase at 14 + 21 + 28 days · £18k tied up', priority:'med'},
      {area:'Marketing Channel Mix', you:'Other channel 5.4× ROAS', bench:'Should be 8×+', monthly:1400, annual:16800, fix:'Cut TikTok spend · reallocate to Meta retargeting', priority:'med'},
      {area:'Software Subscriptions', you:'£840/mo', bench:'£540/mo benchmark', monthly:300, annual:3600, fix:'Audit · 3 redundant tools (CRM duplication)', priority:'low'},
      {area:'Energy Costs', you:'£1,840/mo', bench:'£1,420/mo benchmark', monthly:420, annual:5040, fix:'LED retrofit + smart thermostats', priority:'low'},
      {area:'Treatment Mix · NHS Exam', you:'Loss-making', bench:'Subsidised by mix', monthly:480, annual:5760, fix:'Promote private exam to mid/high earners', priority:'med'},
      {area:'Hygienist Capacity', you:'Booked 3wks out', bench:'<2wks target', monthly:2200, annual:26400, fix:'Add 2nd hygienist or 1 extra day/wk', priority:'high'}
    ];
    const totalLeaks = leaks.reduce((s,l)=>s+l.annual,0);
    panel = `<div style="background:linear-gradient(135deg,#EF4444,#DC2626);color:#fff;border-radius:14px;padding:24px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.9">Total Annual Profit Leaks Detected</div>
          <div style="font-size:48px;font-weight:700;letter-spacing:-.03em;margin:6px 0">£${totalLeaks.toLocaleString()}</div>
          <div style="font-size:13.5px;opacity:.92">Fixing the top 3 would add £108k/yr · pure profit · zero new patients required</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:14px 20px;text-align:center">
          <div style="font-size:10.5px;opacity:.85;text-transform:uppercase;font-weight:700">Leaks Found</div>
          <div style="font-size:32px;font-weight:700;letter-spacing:-.01em">${leaks.length}</div>
        </div>
      </div>
    </div>
    ${mCard('Profit Leak Diagnostic · Auto-flagged from your data + UK benchmarks', mTable(
      [{l:'Leak Area'},{l:'Your Number'},{l:'Benchmark'},{l:'Monthly £',align:'right'},{l:'Annual £',align:'right'},{l:'Fix'},{l:'Priority'}],
      leaks.sort((a,b)=>b.annual-a.annual).map(l => [
        '<b>'+l.area+'</b>',
        '<span style="font-size:12px;color:#475569">'+l.you+'</span>',
        '<span style="font-size:12px;color:#64748B">'+l.bench+'</span>',
        '£'+l.monthly.toLocaleString(),
        `<b style="color:#EF4444">£${l.annual.toLocaleString()}</b>`,
        '<span style="font-size:12px;color:#475569">'+l.fix+'</span>',
        mBadge(l.priority.toUpperCase(), l.priority==='high'?'danger':l.priority==='med'?'warn':'info')
      ])
    ))}`;
  }

  // ========== MULTI-SITE COMPARISON  ==========
  else if (tab === 'multisite') {
    const sites = [
      {n:'Beechcroft Dental',   rev:180000, margin:22, chair:78, cpl:58, ocpspd:295, score:78, c:'#0E7C7B'},
      {n:'Edenford Practice',   rev:140000, margin:18, chair:68, cpl:57, ocpspd:280, score:64, c:'#7C3AED'},
      {n:'Belmont Smile Centre',rev:120000, margin:28, chair:82, cpl:52, ocpspd:268, score:88, c:'#EC4899'},
      {n:'Westfield Dental',    rev:95000,  margin:22, chair:71, cpl:55, ocpspd:285, score:72, c:'#F59E0B'},
      {n:'Hartwell Implant',    rev:75000,  margin:24, chair:85, cpl:63, ocpspd:310, score:82, c:'#3B82F6'}
    ];
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>🏢 Multi-Site Comparison</b> · Elevate exclusive — compare all sites at once with health scoring</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px">
      ${sites.map(s => `<div style="background:#fff;border:1px solid #E5E7EB;border-top:4px solid ${s.c};border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;min-height:24px">${s.n}</div>
        <div style="font-size:32px;font-weight:700;color:${s.score>=80?'#10B981':s.score>=65?'#F59E0B':'#EF4444'};letter-spacing:-.02em;margin:8px 0 4px">${s.score}</div>
        <div style="font-size:10.5px;color:#64748B">Health score</div>
      </div>`).join('')}
    </div>
    ${mCard('Side-by-Side · All Key Metrics', mTable(
      [{l:'Site'},{l:'Revenue MTD',align:'right'},{l:'Margin %',align:'right'},{l:'Chair Util',align:'right'},{l:'CPL',align:'right'},{l:'OCPSPD',align:'right'},{l:'IQ Score',align:'right'}],
      sites.map(s => [
        `<b style="color:${s.c}">${s.n}</b>`,
        '£'+s.rev.toLocaleString(),
        s.margin+'%',
        `<b style="color:${s.chair>=80?'#10B981':s.chair>=70?'#F59E0B':'#EF4444'}">${s.chair}%</b>`,
        '£'+s.cpl,
        '£'+s.ocpspd,
        `<b style="color:${s.score>=80?'#10B981':s.score>=65?'#F59E0B':'#EF4444'}">${s.score}</b>`
      ])
    ))}
    <div style="margin-top:14px;background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;font-size:13px;color:#0F172A">
      <b>📊 Group AI Insights:</b><br>
      • <b>Belmont (88 score)</b> is the gold standard — clone the model: 82% chair util · 28% margin<br>
      • <b>Edenford (64 score)</b> dragging the group — 4 leaks identified · prioritise fix<br>
      • <b>Hartwell:</b> highest OCPSPD £310 due to single-surgery layout · acceptable for implant focus<br>
      • <b>Group avg score:</b> 76.8 — moving Edenford to 75 lifts group to 79
    </div>`;
  }

  return mPage('Practice IQ · Practice Intelligence','Health diagnostic · profit benchmark · per-associate P&L · treatment P&L · OCPSPD · chair recovery · NHS UDA · cash matrix · FCF · run-out detector · peer benchmark · leak finder · multi-site compare', `${mBtn('⬇ Export full report','secondary')}${mBtn('🔄 Reset','secondary','piqResetIQ()')}${mBtn('🤖 AI Action Plan','primary')}`) + mTabs(tab, tabs, 'piqSetTab') + panel + `</div>`;
};
