
// ============================================================================
// CHUNK 10 — PRACTICE IQ MANAGER (CRUD + management screens)
// Full settings coverage: Associates, Treatments (97 BSA), Chairs,
// AR/AP, Cash Projection, Categories/Ledger Accounts, Org Settings.
// ============================================================================

// ===== 97 BSA TREATMENT SEED =====
const BSA_TREATMENTS = [
  ['INV-Lite','Lite Invisalign package',2950,'Orthodontics',180],
  ['.£001','Interspace Brush',5,'Product',5],
  ['.CM','Metal Crown',520,'Prosthodontics',60],
  ['.CP','Porcelain Crown',680,'Prosthodontics',60],
  ['.MG','Soft Mouthguard',180,'Miscellaneous',30],
  ['A','Amalgam Filling',95,'Restorative',30],
  ['ADD-DN','Addition of Tooth to a Denture',180,'Prosthodontics',45],
  ['ASSESS@','Assessment And Advice',45,'Diagnosis',20],
  ['AUTONOTE','Note',0,'Miscellaneous',5],
  ['C','Composite Filling',185,'Restorative',30],
  ['C1','Crown Preparation And Impression(s)',420,'Prosthodontics',60],
  ['C1.','Post Crown Prep & Impression(s)',480,'Prosthodontics',75],
  ['D1','Primary Denture Impression(s)',95,'Prosthodontics',30],
  ['D2','Secondary Denture Impression(s)',95,'Prosthodontics',30],
  ['D3','Denture Bite Visit',75,'Prosthodontics',20],
  ['D4','Denture Try-in',75,'Prosthodontics',20],
  ['D5','Metal Try-in',85,'Prosthodontics',25],
  ['DAF','Full Acrylic Denture Upper Or Lower',680,'Prosthodontics',45],
  ['DAFF','Full Acrylic Denture',1200,'Prosthodontics',60],
  ['DAP','Partial Acrylic Denture',520,'Prosthodontics',45],
  ['DCR','Chrome Cobalt Denture',980,'Prosthodontics',60],
  ['DRESS@','Temp Fill/Dressing',55,'Restorative',15],
  ['DR-RIM!','Resin Denture Impression + Rims',120,'Prosthodontics',30],
  ['EMER','Emergency Appointment',95,'Miscellaneous',20],
  ['EX15','15 min Routine Examination',45,'Diagnosis',15],
  ['EXAM','Examination',55,'Diagnosis',20],
  ['EXPI','Plan Inclusive Routine Examination',0,'Diagnosis',20],
  ['EXRAY-S','Bitewing Radiograph(s)',18,'Diagnosis',5],
  ['EXRAY-SP','Periapical Radiograph(s)',18,'Diagnosis',5],
  ['EXT','Extraction',120,'Oral Surgery',20],
  ['EXT@','Urgent Extraction (2 Only)',180,'Oral Surgery',30],
  ['FAM','Amalgam Restoration',95,'Restorative',30],
  ['FCO','Cosmetic Resin Filling',220,'Cosmetic',45],
  ['FCP','Posterior Composite Filling',185,'Restorative',30],
  ['FGI','Glass Ionomer',95,'Restorative',25],
  ['FLU','Fluoride Varnish',25,'Periodontology',10],
  ['GI','Glass Ionomer Filling',95,'Restorative',25],
  ['HYG','Hygienist (Scaling and Polishing)',90,'Periodontology',30],
  ['I1','Inlay Preparation & Impression(s)',520,'Restorative',60],
  ['I-DI','Dental Implant',2400,'Oral Surgery',90],
  ['IMP','Implant Assessment',120,'Diagnosis',45],
  ['INVIS.3','Invisalign Level 3',3800,'Orthodontics',240],
  ['PRSCPT','Issue of a Prescription',25,'Miscellaneous',5],
  ['PSP','Scale & Polish With The Dentist',75,'Periodontology',20],
  ['PSPP1','Plan Inclusive Scale and Polish',0,'Periodontology',20],
  ['RADM','Xray Medium Film',22,'Diagnosis',5],
  ['RADS','Xray Small Film',18,'Diagnosis',5],
  ['RADS@','Xray Small Film',18,'Diagnosis',5],
  ['RCT','Root Canal Filling',680,'Endodontics',75],
  ['RCT!','Open Root Canal For Drainage',180,'Endodontics',30],
  ['RCT2','Root Canal Filling',680,'Endodontics',75],
  ['RECBO@','Recement Bridge',95,'Prosthodontics',30],
  ['C%','Urgent Composite (2 Only)',220,'Restorative',40],
  ['CPJ','Porcelain Jacket Crown Fit',680,'Prosthodontics',45],
  ['DEASE','Denture Ease',45,'Prosthodontics',15],
  ['H','HYGIENIST SERVICES',90,'Periodontology',30],
  ['INVIS-EXAM','Initial Invisalign Assessment',180,'Diagnosis',45],
  ['B1','Bridge Preparation & Impression(s)',780,'Prosthodontics',75],
  ['ICF','Composite Inlay Fit',420,'Restorative',45],
  ['PONT-PO','Porcelain Pontic',520,'Prosthodontics',45],
  ['RADL','Xray Large Film',28,'Diagnosis',5],
  ['#','Fractured Tooth',95,'Restorative',20],
  ['.AZI','Comprehensive Invisalign Assessment',225,'Diagnosis',60],
  ['.DA','Acrylic Denture',680,'Prosthodontics',45],
  ['CP','Crown Prep',480,'Prosthodontics',60],
  ['D.','DENTURE RELATED SERVICES',95,'Prosthodontics',30],
  ['DM','Mouthguard (Clear) - Fit',180,'Miscellaneous',30],
  ['DM-','Nightguard',180,'Miscellaneous',30],
  ['FIS','Fissure Sealant/Fluoride Application',45,'Periodontology',15],
  ['O-RETR','Removable Retainer',280,'Orthodontics',30],
  ['PAN@','Panoral',45,'Diagnosis',10],
  ['.BPBF','Porcelain Bonded Bridge',2200,'Prosthodontics',90],
  ['.CPJ','Porcelain Jacket Crown',680,'Prosthodontics',60],
  ['.EMER1','Emergency Appointment (working hours)',95,'Miscellaneous',20],
  ['AB·Prescription','Antibiotic Prescription',25,'Miscellaneous',5],
  ['BNDN/PREC','Bonded Full or Jacket Crown Non-precious',520,'Prosthodontics',60],
  ['DIMP','Impressions (Nightguards etc)',95,'Prosthodontics',20],
  ['EXRAY-M','Medium Radiograph(s)',22,'Diagnosis',5],
  ['.BNPM','Bonded Non Precious Metal Bridge',1800,'Prosthodontics',90],
  ['.BRPM','Bridge Retainer Precious Metal',780,'Prosthodontics',75],
  ['DP-COMP!','Partial Plate Denture Not Fitted',420,'Prosthodontics',45],
  ['DR-COMP!','Resin Denture Not Fitted',520,'Prosthodontics',45],
  ['FTEMP','Temporary Filling',65,'Restorative',15],
  ['MANDREF','Referral for Advanced Mandatory Services',0,'Diagnosis',15],
  ['PAN','Panoral',45,'Diagnosis',10],
  ['.DC','Chrome Denture',980,'Prosthodontics',60],
  ['C2','Post Fit',180,'Prosthodontics',30],
  ['T.TRAY','Teeth Whitening Tray',280,'Cosmetic',30],
  ['.CROWNUM','Crown Unknown Material',520,'Prosthodontics',60],
  ['.FT','Filling (Temp/Unknown Material)',95,'Restorative',20],
  ['ADJO','Other Adjustments to Dentures',45,'Prosthodontics',15],
  ['MST','Stone & Smooth Tooth Surface',45,'Restorative',10],
  ['ADCL','Addition of Clasp to a Denture',95,'Prosthodontics',20],
  ['BMF','Maryland Pontic Fit',420,'Prosthodontics',45],
  ['BMFW','Maryland Wing Fit',280,'Prosthodontics',30],
  ['DRESS!','Dressing!',55,'Restorative',15],
  ['EXREV','Review Appointment',45,'Diagnosis',15]
];

const TREATMENT_GROUPS = ['Product','Diagnosis','Prosthodontics','Restorative','Miscellaneous','Oral Surgery','Periodontology','Orthodontics','Endodontics','Cosmetic','Uncategorized'];

// ===== STATE =====
function pimLoad() {
  const s = localStorage.getItem('elv-pim');
  if (s) return JSON.parse(s);
  const data = {
    associates: [
      {id:'a1', name:'Dr A · Principal',     email:'a@example.com', phone:'07700 900001', chair:'Surgery 1', splitPct:30, labSplitPct:50, joining:'2018-04-01', leaving:''},
      {id:'a2', name:'Dr B · Associate',      email:'b@example.com', phone:'07700 900002', chair:'Surgery 2', splitPct:45, labSplitPct:50, joining:'2020-09-15', leaving:''},
      {id:'a3', name:'Dr C · Associate',      email:'c@example.com', phone:'07700 900003', chair:'Surgery 3', splitPct:42, labSplitPct:50, joining:'2021-06-01', leaving:''},
      {id:'a4', name:'Dr D · Implants',       email:'d@example.com', phone:'07700 900004', chair:'Surgery 4', splitPct:38, labSplitPct:50, joining:'2019-11-20', leaving:''},
      {id:'a5', name:'Dr E · Cosmetic',       email:'e@example.com', phone:'07700 900005', chair:'Surgery 5', splitPct:40, labSplitPct:50, joining:'2022-03-10', leaving:''},
      {id:'a6', name:'Dr F · NHS-mixed',      email:'f@example.com', phone:'07700 900006', chair:'Surgery 6', splitPct:48, labSplitPct:50, joining:'2017-08-01', leaving:''},
      {id:'a7', name:'Hyg G · Hygienist',    email:'g@example.com', phone:'07700 900007', chair:'Surgery 7', splitPct:50, labSplitPct:0, joining:'2023-01-15', leaving:''}
    ],
    treatments: BSA_TREATMENTS.map((t,i) => ({
      id:'t'+(i+1),
      code: t[0],
      name: t[1],
      value: t[2],
      group: t[3],
      timeMins: t[4],
      dentistMins: t[4],
      therapistMins: 0,
      labBill: t[3]==='Prosthodontics' ? Math.round(t[2]*0.25) : t[3]==='Orthodontics' ? Math.round(t[2]*0.30) : 0,
      labDiscountPct: 5,
      materialsCost: Math.round(t[2]*0.05),
      associatePct: 42,
      therapistRate: 32,
      financePct: t[2]>1000?2:0,
      opCostPerHour: 80
    })),
    chairSettings: {
      chairs: 8,
      hoursPerDay: 9,
      weeksPerYear: 46,
      daysPerWeek: 5,
      daysPerYear: 230,
      benchmarkOccPct: 80,
      benchmarkRevPerHour: 280
    },
    arItems: [
      {id:1, ref:'INV-3401', patient:'Patient A', date:'2026-04-18', dueDate:'2026-05-18', overdue:6, expected:'2026-05-25', paid:0, due:680},
      {id:2, ref:'INV-3402', patient:'Patient B', date:'2026-05-02', dueDate:'2026-05-30', overdue:0, expected:'2026-05-28', paid:1200, due:1200},
      {id:3, ref:'INV-3403', patient:'Patient C', date:'2026-05-08', dueDate:'2026-06-07', overdue:0, expected:'2026-06-05', paid:0, due:2400},
      {id:4, ref:'INV-3404', patient:'Patient D', date:'2026-04-22', dueDate:'2026-05-22', overdue:2, expected:'2026-06-01', paid:0, due:185},
      {id:5, ref:'INV-3405', patient:'Patient E', date:'2026-03-15', dueDate:'2026-04-15', overdue:39, expected:'2026-06-10', paid:0, due:3800}
    ],
    apItems: [
      {id:1, ref:'B-2401', supplier:'Henry Schein', date:'2026-05-10', dueDate:'2026-06-09', overdue:0, expected:'2026-06-09', paid:0, due:4280},
      {id:2, ref:'B-2402', supplier:'Lab · CrownPro', date:'2026-05-12', dueDate:'2026-06-11', overdue:0, expected:'2026-06-11', paid:0, due:6840},
      {id:3, ref:'B-2403', supplier:'NPower Energy', date:'2026-05-01', dueDate:'2026-05-31', overdue:0, expected:'2026-05-30', paid:0, due:1840},
      {id:4, ref:'B-2404', supplier:'Plandent', date:'2026-04-28', dueDate:'2026-05-28', overdue:4, expected:'2026-06-04', paid:0, due:2200},
      {id:5, ref:'B-2405', supplier:'Salaries', date:'2026-05-25', dueDate:'2026-05-25', overdue:0, expected:'2026-05-25', paid:0, due:42000}
    ],
    cashTransactions: [
      {id:1, date:'2026-05-23', type:'Receipt', name:'Patient · Implant', memo:'INV-3398', payer:'Patient G', for:'Implant', in:2400, out:0, balance:285000},
      {id:2, date:'2026-05-23', type:'Payment', name:'Henry Schein', memo:'Materials May', payer:'', for:'Materials', in:0, out:1840, balance:283160},
      {id:3, date:'2026-05-22', type:'Receipt', name:'NHS BSA', memo:'May NHS', payer:'NHS BSA', for:'NHS', in:23750, out:0, balance:285000},
      {id:4, date:'2026-05-21', type:'Payment', name:'Lab · CrownPro', memo:'Apr lab', payer:'', for:'Lab', in:0, out:4280, balance:261250},
      {id:5, date:'2026-05-20', type:'Receipt', name:'Patient · Invisalign', memo:'INV-3392', payer:'Patient F', for:'Invisalign', in:3800, out:0, balance:265530}
    ],
    plannedInflow: [
      {id:1, item:'NHS BSA Jun', amount:23750, date:'2026-06-15'},
      {id:2, item:'Implant cases (3 booked)', amount:7200, date:'2026-06-20'},
      {id:3, item:'Invisalign deposits', amount:11400, date:'2026-06-25'},
      {id:4, item:'AR collection target', amount:18000, date:'2026-06-30'}
    ],
    plannedOutflow: [
      {id:1, item:'Salaries Jun', amount:42000, date:'2026-06-25'},
      {id:2, item:'Lab fees', amount:8400, date:'2026-06-15'},
      {id:3, item:'Rent', amount:6500, date:'2026-06-01'},
      {id:4, item:'Materials order', amount:3200, date:'2026-06-10'},
      {id:5, item:'Corporation Tax', amount:18500, date:'2026-06-30'}
    ],
    ledgerCategories: {
      received: {
        'Cash Received From Operations': ['200 Sales','201 NHS income','202 Membership income','203 Private Income','204 Dental Products','260 Other Revenue'],
        'Cash Received From Investing': ['270 Interest Income'],
        'Cash Received From Financing': ['495 Loan Received','496 Director Loan In'],
        'Intra Company Receipts': ['960 Intra Group Receipts'],
        'Intra Account Receipts': ['970 Bank Transfer In'],
        'Tax Refund': ['285 VAT Refund','286 Corp Tax Refund']
      },
      paid: {
        'Direct Costs': ['310 Cost of Goods Sold','320 Direct Wages','336 Locum Charges','337 Materials','355 Dental Associates','370 Implant Stock','375 Lab Fees'],
        'Overheads': ['400 Advertising','401 Audit','404 Bank Fees','408 Cleaning','412 Insurance','420 Rent','424 Repairs','428 Subscriptions','432 Telephone','436 Utilities'],
        'Cash Paid To Investing': ['610 Equipment Purchase','611 Property Improvement'],
        'Cash Paid To Financing': ['497 Loan Repayment','498 Director Loan Out','499 Dividends'],
        'Intra Company Payments': ['961 Intra Group Payment'],
        'Intra Account Payments': ['971 Bank Transfer Out'],
        'Compliance': ['480 Corporation Tax','481 PAYE','482 VAT','483 NHS Superannuation','484 NHS Non-Super']
      }
    },
    organization: {
      name: 'Crestwell Dental Group Ltd',
      country: 'United Kingdom',
      contact: '01234 567890',
      email: 'admin@example.com',
      address1: 'Suite 12',
      address2: 'Canterbury Road',
      city: 'Herne Bay',
      state: 'Kent',
      zip: 'CT6 5RQ',
      fyStartMonth: 4,
      currency: 'GBP',
      companyNo: '08123456',
      vatNo: 'GB 123 4567 89',
      utr: '1234567890'
    },
    tutorialProgress: { current: 17, total: 34 }
  };
  localStorage.setItem('elv-pim', JSON.stringify(data));
  return data;
}
function pimSave(d) { localStorage.setItem('elv-pim', JSON.stringify(d)); }

window.pimSetTab = function(t) { localStorage.setItem('pim-tab', t); navigate('practice-iq-manager'); };
window.pimAddAssociate = function() {
  const d = pimLoad();
  const name = prompt('Associate name:');
  if (!name) return;
  d.associates.push({id:'a'+Date.now(), name, email:'', phone:'', chair:'', splitPct:42, labSplitPct:50, joining:new Date().toISOString().split('T')[0], leaving:''});
  pimSave(d);
  navigate('practice-iq-manager');
};
window.pimRemoveAssociate = function(id) {
  if (!confirm('Remove this associate?')) return;
  const d = pimLoad();
  d.associates = d.associates.filter(a => a.id !== id);
  pimSave(d);
  navigate('practice-iq-manager');
};
window.pimUpdateChair = function(k, v) {
  const d = pimLoad();
  d.chairSettings[k] = parseFloat(v) || 0;
  if (k === 'weeksPerYear' || k === 'daysPerWeek') {
    d.chairSettings.daysPerYear = d.chairSettings.weeksPerYear * d.chairSettings.daysPerWeek;
  }
  pimSave(d);
  navigate('practice-iq-manager');
};
window.pimUpdateOrg = function(k, v) {
  const d = pimLoad();
  d.organization[k] = v;
  pimSave(d);
};
window.pimUpdateTreatmentFilter = function(g) { localStorage.setItem('pim-tx-filter', g); navigate('practice-iq-manager'); };

PAGES['practice-iq-manager'] = () => {
  const d = pimLoad();
  const tab = localStorage.getItem('pim-tab') || 'associates';
  const tabs = [
    {k:'associates',     l:'Associates',           i:'👥'},
    {k:'assocupload',    l:'Monthly Upload',       i:'📤'},
    {k:'assocgoals',     l:'Associate Goals',      i:'🎯'},
    {k:'udagoals',       l:'UDA Goals',            i:'🏛'},
    {k:'txmaster',       l:'Treatment Master (97)',i:'🦷'},
    {k:'txgroups',       l:'Treatment Groups',     i:'🏷'},
    {k:'txgoals',        l:'Treatment Goals',      i:'🎯'},
    {k:'chairsettings',  l:'Chair Settings',       i:'🪑'},
    {k:'chairefficiency',l:'Chair Efficiency',     i:'⚙'},
    {k:'arman',          l:'AR Management',        i:'📥'},
    {k:'apman',          l:'AP Management',        i:'📤'},
    {k:'cashinflow',     l:'Inflow Monitor',       i:'💷'},
    {k:'cashoutflow',    l:'Outflow Monitor',      i:'💸'},
    {k:'planinflow',     l:'Plan Inflow',          i:'📈'},
    {k:'planoutflow',    l:'Plan Outflow',         i:'📉'},
    {k:'categories',     l:'Categories & Ledger',  i:'📚'},
    {k:'users',          l:'Users',                i:'👤'},
    {k:'organization',   l:'Organization',         i:'🏢'},
    {k:'integrations',   l:'Integrations',         i:'🔌'},
    {k:'tutorial',       l:'Tutorial Progress',    i:'🧭'}
  ];

  let panel = '';

  // ===== ASSOCIATES CRUD =====
  if (tab === 'associates') {
    panel = `<div style="display:flex;justify-content:space-between;margin-bottom:14px"><div style="font-size:12.5px;color:#475569">${d.associates.length} associates configured · click ✏ to edit · 🗑 to remove</div>${mBtn('+ Add Associate','primary','pimAddAssociate()')}</div>
    ${mCard('Associate Register', mTable(
      [{l:'Name'},{l:'Email'},{l:'Phone'},{l:'Primary Chair'},{l:'Split %',align:'right'},{l:'Lab Split %',align:'right'},{l:'Joined'},{l:'Left'},{l:'Action'}],
      d.associates.map(a => [
        '<b>'+a.name+'</b>',
        '<span style="font-size:12px;color:#475569">'+a.email+'</span>',
        '<span style="font-size:12px;color:#475569">'+a.phone+'</span>',
        a.chair,
        a.splitPct+'%',
        a.labSplitPct+'%',
        a.joining,
        a.leaving || '—',
        `<button onclick="pimRemoveAssociate('${a.id}')" style="background:#FEE2E2;color:#991B1B;border:none;padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer">🗑 Remove</button>`
      ])
    ))}`;
  }

  // ===== MONTHLY UPLOAD =====
  else if (tab === 'assocupload') {
    const months = ['Apr 25','May 25','Jun 25','Jul 25','Aug 25','Sep 25','Oct 25','Nov 25','Dec 25','Jan 26','Feb 26','Mar 26'];
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>📤 Auto-syncs from Dentally</b> · Manual override available · Upload CSV/Excel if PMS not connected</div>
    ${mCard('Associates Net Production · Monthly', mTable(
      [{l:'Associate'}].concat(months.map(m=>({l:m,align:'right'}))).concat([{l:'YTD',align:'right'}]),
      d.associates.map(a => {
        const monthly = months.map(()=>Math.round((a.splitPct*200+Math.random()*8000)));
        const ytd = monthly.reduce((s,v)=>s+v,0);
        return ['<b>'+a.name+'</b>'].concat(monthly.map(v=>'£'+v.toLocaleString())).concat(['<b>£'+ytd.toLocaleString()+'</b>']);
      })
    ),`${mBtn('📤 Upload CSV','secondary')}${mBtn('🔄 Sync from Dentally','primary')}`)}
    <div style="margin-top:14px">${mCard('Working Hours · Monthly', mTable(
      [{l:'Associate'}].concat(months.map(m=>({l:m,align:'right'}))).concat([{l:'YTD Hrs',align:'right'}]),
      d.associates.map(a => {
        const monthly = months.map(()=>140+Math.round(Math.random()*40));
        const ytd = monthly.reduce((s,v)=>s+v,0);
        return ['<b>'+a.name+'</b>'].concat(monthly.map(v=>v+'h')).concat(['<b>'+ytd+'h</b>']);
      })
    ),mBtn('+ Add Working Hours','secondary'))}</div>`;
  }

  // ===== ASSOCIATE GOALS =====
  else if (tab === 'assocgoals') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B">Operational Costs & Profit</div><div style="margin-top:8px;font-size:12.5px;color:#475569;line-height:1.6">Op costs: <b>£${(d.chairSettings.chairs*d.chairSettings.hoursPerDay*d.chairSettings.daysPerYear*45).toLocaleString()}/yr</b><br>Target Profit: <b>15%</b><br>OCPSPD: <b>£280</b></div></div>
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B">Operational Schedule</div><div style="margin-top:8px;font-size:12.5px;color:#475569;line-height:1.6">Weeks: <b>${d.chairSettings.weeksPerYear}</b><br>Days/week: <b>${d.chairSettings.daysPerWeek}</b><br>Surgeries: <b>${d.chairSettings.chairs}</b><br>Surgery-days: <b>${d.chairSettings.daysPerYear*d.chairSettings.chairs}</b></div></div>
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B">Associate Available</div><div style="margin-top:8px;font-size:12.5px;color:#475569;line-height:1.6">Weeks: <b>${d.chairSettings.weeksPerYear}</b><br>Days/week: <b>${d.chairSettings.daysPerWeek}</b><br>Days/year: <b>${d.chairSettings.daysPerYear}</b></div></div>
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B">Practice Expenses</div><div style="margin-top:8px;font-size:12.5px;color:#475569;line-height:1.6">Materials: <b>5%</b><br>Lab Cost: <b>10%</b></div></div>
    </div>
    ${mCard('Profit Goals · Per Associate · Actual vs Planned', mTable(
      [{l:'Associate'},{l:'Avg/Day Actual',align:'right'},{l:'Avg/Day Planned',align:'right'},{l:'Total Actual',align:'right'},{l:'Total Planned',align:'right'},{l:'Variance',align:'right'},{l:'Costs',align:'right'},{l:'Profit',align:'right'}],
      d.associates.map(a => {
        const actual = a.splitPct === 50 ? 680 : 900 + Math.round(Math.random()*1500);
        const planned = actual + Math.round((Math.random()-0.5)*400);
        const variance = actual - planned;
        const totalActual = actual * 230;
        const totalPlanned = planned * 230;
        const costs = totalActual * (a.splitPct + 15) / 100;
        const profit = totalActual - costs;
        return [
          '<b>'+a.name+'</b>',
          '£'+actual.toLocaleString(),
          '£'+planned.toLocaleString(),
          '£'+totalActual.toLocaleString(),
          '£'+totalPlanned.toLocaleString(),
          `<b style="color:${variance>=0?'#10B981':'#EF4444'}">${variance>=0?'+':''}£${variance.toLocaleString()}</b>`,
          '£'+Math.round(costs).toLocaleString(),
          `<b style="color:${profit>50000?'#10B981':'#F59E0B'}">£${Math.round(profit).toLocaleString()}</b>`
        ];
      })
    ))}`;
  }

  // ===== UDA GOALS =====
  else if (tab === 'udagoals') {
    panel = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px">
      <h3 style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 12px">UDA Contract Settings</h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
        ${[['Financial Year','2026-27'],['NHS Contract Value','£285,000'],['Total UDA Obligation','10,035'],['UDA Rate','£28.40']].map(([l,v])=>`<div><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">${l}</label><input type="text" value="${v}" style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:13.5px;font-weight:600"></div>`).join('')}
      </div>
    </div>
    ${mCard('Yearly UDA Obligation · Per Associate', mTable(
      [{l:'Associate'},{l:'Annual Target',align:'right'},{l:'Monthly Target',align:'right'},{l:'Completed YTD',align:'right'},{l:'% Complete',align:'right'}],
      [
        ['Dr A · Principal',2800,233,1180,42],
        ['Dr F · NHS-mixed',5200,433,2240,43],
        ['Dr C · Associate',2035,170,840,41]
      ].map(([n,t,mt,c,p])=>['<b>'+n+'</b>',t.toLocaleString(),mt.toString(),c.toLocaleString(),p+'%'])
    ))}
    <div style="margin-top:14px">${mCard('Monthly Actual vs Target · Group', mTable(
      [{l:'Month'},{l:'Target UDA',align:'right'},{l:'Actual UDA',align:'right'},{l:'Variance',align:'right'},{l:'Cumulative',align:'right'}],
      ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'].map((m,i)=>{
        const tgt=836,act=820+Math.round(Math.random()*60-30);
        return ['<b>'+m+'</b>',tgt.toString(),act.toString(),`<b style="color:${act>=tgt?'#10B981':'#EF4444'}">${act-tgt>=0?'+':''}${act-tgt}</b>`,((i+1)*tgt).toLocaleString()];
      })
    ))}</div>`;
  }

  // ===== TREATMENT MASTER =====
  else if (tab === 'txmaster') {
    const filter = localStorage.getItem('pim-tx-filter') || 'All';
    const filtered = filter === 'All' ? d.treatments : d.treatments.filter(t=>t.group===filter);
    panel = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span style="font-size:11.5px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;margin-right:6px">Filter:</span>
      ${['All'].concat(TREATMENT_GROUPS).map(g=>`<button onclick="pimUpdateTreatmentFilter('${g}')" style="padding:4px 9px;font-size:11px;font-weight:700;border:1px solid ${filter===g?'#0E7C7B':'#E5E7EB'};background:${filter===g?'#0E7C7B':'#fff'};color:${filter===g?'#fff':'#475569'};border-radius:5px;cursor:pointer">${g}</button>`).join('')}</div>
      <div style="display:flex;gap:8px">${mBtn('+ Add Treatment','primary')}${mBtn('📤 Import Excel','secondary')}${mBtn('⬇ Export','secondary')}</div>
    </div>
    <div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:12.5px;color:#0F172A"><b>${filtered.length}</b> of <b>${d.treatments.length}</b> treatments shown · 97 BSA dental codes seeded</div>
    ${mCard('', mTable(
      [{l:'Code'},{l:'Treatment'},{l:'Group'},{l:'Value £',align:'right'},{l:'Time min',align:'right'},{l:'Lab £',align:'right'},{l:'Mat £',align:'right'},{l:'Assoc %',align:'right'}],
      filtered.slice(0,50).map(t=>[
        '<code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;font-size:11.5px;color:#0F172A">'+t.code+'</code>',
        '<b>'+t.name+'</b>',
        mBadge(t.group,'info'),
        '£'+t.value.toLocaleString(),
        t.timeMins.toString(),
        '£'+t.labBill.toLocaleString(),
        '£'+t.materialsCost.toLocaleString(),
        t.associatePct+'%'
      ])
    ), filtered.length>50?'<span style="font-size:12px;color:#64748B">Showing first 50 of '+filtered.length+' · use filter to narrow</span>':null)}`;
  }

  // ===== TREATMENT GROUPS =====
  else if (tab === 'txgroups') {
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>🏷 Treatment Groupings</b> · Drag treatments between groups · used in revenue/profit reporting</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
      ${TREATMENT_GROUPS.map(g=>{
        const inGroup = d.treatments.filter(t=>t.group===g);
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-top:4px solid #0E7C7B;border-radius:10px;padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div style="font-weight:700;font-size:13.5px;color:#0F172A">${g}</div>
            <span style="font-size:11px;font-weight:700;padding:2px 8px;background:#F0FDFA;color:#0E7C7B;border-radius:4px">${inGroup.length}</span>
          </div>
          <div style="font-size:11.5px;color:#475569;line-height:1.5;max-height:160px;overflow-y:auto">${inGroup.slice(0,8).map(t=>`• ${t.code} — ${t.name}`).join('<br>')}${inGroup.length>8?'<br><span style="color:#94A3B8">+'+(inGroup.length-8)+' more</span>':''}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // ===== TREATMENT GOALS =====
  else if (tab === 'txgoals') {
    panel = `${mCard('Profit Goals · By Treatment Group · Actual vs Target', mTable(
      [{l:'Group'},{l:'Treatments',align:'right'},{l:'Revenue Target',align:'right'},{l:'Actual Revenue',align:'right'},{l:'Variance',align:'right'},{l:'Target Profit',align:'right'},{l:'Actual Profit',align:'right'}],
      TREATMENT_GROUPS.map(g => {
        const inGroup = d.treatments.filter(t=>t.group===g);
        const revTarget = inGroup.reduce((s,t)=>s+t.value,0) * 12;
        const actual = revTarget * (0.85 + Math.random()*0.3);
        const variance = actual - revTarget;
        const profitT = revTarget * 0.22;
        const profitA = actual * 0.22;
        return [
          '<b>'+g+'</b>',
          inGroup.length.toString(),
          '£'+Math.round(revTarget).toLocaleString(),
          '£'+Math.round(actual).toLocaleString(),
          `<b style="color:${variance>=0?'#10B981':'#EF4444'}">${variance>=0?'+':''}£${Math.round(variance).toLocaleString()}</b>`,
          '£'+Math.round(profitT).toLocaleString(),
          '£'+Math.round(profitA).toLocaleString()
        ];
      })
    ))}`;
  }

  // ===== CHAIR SETTINGS =====
  else if (tab === 'chairsettings') {
    panel = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px">
      <h3 style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 12px">Chair Configuration</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
        ${[
          ['Number of Chairs','chairs',d.chairSettings.chairs],
          ['Opening Hours/Day','hoursPerDay',d.chairSettings.hoursPerDay],
          ['Working Weeks/Year','weeksPerYear',d.chairSettings.weeksPerYear],
          ['Working Days/Week','daysPerWeek',d.chairSettings.daysPerWeek],
          ['Days/Year (auto)','daysPerYear',d.chairSettings.daysPerYear],
          ['Benchmark Occupancy %','benchmarkOccPct',d.chairSettings.benchmarkOccPct],
          ['Benchmark Revenue/Chair/Hour £','benchmarkRevPerHour',d.chairSettings.benchmarkRevPerHour]
        ].map(([l,k,v])=>`<div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">${l}</label>
          <input type="number" value="${v}" onchange="pimUpdateChair('${k}', this.value)" ${k==='daysPerYear'?'readonly':''} style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:14px;font-weight:600${k==='daysPerYear'?';background:#F8FAFC':''}">
        </div>`).join('')}
      </div>
    </div>
    <div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;font-size:13px;color:#0F172A">
      <b>Calculated:</b> ${d.chairSettings.chairs} chairs × ${d.chairSettings.hoursPerDay}h × ${d.chairSettings.daysPerYear} days = <b>${(d.chairSettings.chairs*d.chairSettings.hoursPerDay*d.chairSettings.daysPerYear).toLocaleString()} chair-hours/year</b> available capacity.
    </div>`;
  }

  // ===== CHAIR EFFICIENCY =====
  else if (tab === 'chairefficiency') {
    panel = `${mCard('Chair Efficiency Engine · Treatments × Time × Income', mTable(
      [{l:'Date'},{l:'Treatment'},{l:'Avg Time',align:'right'},{l:'Units',align:'right'},{l:'Total Time (min)',align:'right'},{l:'Chair Time (hr)',align:'right'},{l:'Income',align:'right'}],
      d.treatments.slice(0,20).map(t=>{
        const units = Math.round(Math.random()*40 + 5);
        const totalMin = t.timeMins * units;
        return [
          '2026-05-23',
          '<b>'+t.name+'</b>',
          t.timeMins+' min',
          units.toString(),
          totalMin.toLocaleString(),
          (totalMin/60).toFixed(1),
          '£'+(t.value*units).toLocaleString()
        ];
      })
    ))}`;
  }

  // ===== AR MANAGEMENT =====
  else if (tab === 'arman') {
    const total = d.arItems.reduce((s,i)=>s+i.due-i.paid,0);
    const overdue = d.arItems.filter(i=>i.overdue>0).reduce((s,i)=>s+i.due-i.paid,0);
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('📥','Total AR','£'+total.toLocaleString(),'','outstanding receivables')}
      ${mKpi('⚠','Overdue','£'+overdue.toLocaleString(),'',d.arItems.filter(i=>i.overdue>0).length+' invoices')}
      ${mKpi('💷','Avg Invoice','£'+Math.round(total/d.arItems.length).toLocaleString(),'','across open')}
      ${mKpi('📈','DSO','32 days','-4','target: 28')}
    </div>
    ${mCard('Accounts Receivable · Step 1 of 3', mTable(
      [{l:'#'},{l:'Ref'},{l:'Patient'},{l:'Date'},{l:'Due Date'},{l:'Overdue',align:'right'},{l:'Expected'},{l:'Paid',align:'right'},{l:'Due',align:'right'}],
      d.arItems.map((i,n)=>[
        (n+1).toString(),
        '<code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;font-size:11.5px">'+i.ref+'</code>',
        '<b>'+i.patient+'</b>',
        i.date,
        i.dueDate,
        i.overdue>0?`<b style="color:#EF4444">${i.overdue}d</b>`:'—',
        i.expected,
        '£'+i.paid.toLocaleString(),
        '<b>£'+i.due.toLocaleString()+'</b>'
      ])
    ),mBtn('Next: AP →','primary'))}`;
  }

  // ===== AP MANAGEMENT =====
  else if (tab === 'apman') {
    const total = d.apItems.reduce((s,i)=>s+i.due-i.paid,0);
    const overdue = d.apItems.filter(i=>i.overdue>0).reduce((s,i)=>s+i.due-i.paid,0);
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('📤','Total AP','£'+total.toLocaleString(),'','outstanding payables')}
      ${mKpi('⚠','Overdue','£'+overdue.toLocaleString(),'',d.apItems.filter(i=>i.overdue>0).length+' bills')}
      ${mKpi('🔁','DPO','48 days','+6','optimal stretch')}
      ${mKpi('💷','Avg Bill','£'+Math.round(total/d.apItems.length).toLocaleString(),'','across open')}
    </div>
    ${mCard('Accounts Payable · Step 2 of 3', mTable(
      [{l:'#'},{l:'Ref'},{l:'Supplier'},{l:'Date'},{l:'Due Date'},{l:'Overdue',align:'right'},{l:'Expected'},{l:'Paid',align:'right'},{l:'Due',align:'right'}],
      d.apItems.map((i,n)=>[
        (n+1).toString(),
        '<code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;font-size:11.5px">'+i.ref+'</code>',
        '<b>'+i.supplier+'</b>',
        i.date,
        i.dueDate,
        i.overdue>0?`<b style="color:#EF4444">${i.overdue}d</b>`:'—',
        i.expected,
        '£'+i.paid.toLocaleString(),
        '<b>£'+i.due.toLocaleString()+'</b>'
      ])
    ),mBtn('Next: Closing Target →','primary'))}`;
  }

  // ===== CASH INFLOW MONITOR =====
  else if (tab === 'cashinflow') {
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>💷 Cash Inflow Monitoring</b> · Real transaction-level tracking · Step 1 of 3 (A-Analysis)</div>
    ${mCard('Cash Inflows · Last 30 days', mTable(
      [{l:'Date'},{l:'Type'},{l:'Name'},{l:'Memo'},{l:'Who Paid'},{l:'For What'},{l:'Money IN',align:'right'},{l:'Balance',align:'right'}],
      d.cashTransactions.filter(t=>t.in>0).map(t=>[
        t.date,
        mBadge(t.type,'success'),
        '<b>'+t.name+'</b>',
        '<span style="font-size:12px;color:#475569">'+t.memo+'</span>',
        t.payer,
        t.for,
        '<b style="color:#10B981">£'+t.in.toLocaleString()+'</b>',
        '£'+t.balance.toLocaleString()
      ])
    ))}`;
  }

  // ===== CASH OUTFLOW MONITOR =====
  else if (tab === 'cashoutflow') {
    panel = `<div style="background:#FEE2E2;border-left:3px solid #EF4444;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#991B1B"><b>💸 Cash Outflow Monitoring</b> · Where money goes · Step 2 of 3</div>
    ${mCard('Cash Outflows · Last 30 days', mTable(
      [{l:'Date'},{l:'Type'},{l:'Name'},{l:'Memo'},{l:'For What'},{l:'Money OUT',align:'right'},{l:'Balance',align:'right'}],
      d.cashTransactions.filter(t=>t.out>0).map(t=>[
        t.date,
        mBadge(t.type,'danger'),
        '<b>'+t.name+'</b>',
        '<span style="font-size:12px;color:#475569">'+t.memo+'</span>',
        t.for,
        '<b style="color:#EF4444">£'+t.out.toLocaleString()+'</b>',
        '£'+t.balance.toLocaleString()
      ])
    ))}`;
  }

  // ===== PLANNED INFLOW =====
  else if (tab === 'planinflow') {
    panel = `<div style="display:flex;justify-content:space-between;margin-bottom:14px"><div style="font-size:13px;color:#475569"><b>Planned Cash Inflow</b> · Forward projection · Step 1 of 3 (P-Projection)</div>${mBtn('+ Add Plan','primary')}</div>
    ${mCard('', mTable(
      [{l:'Item'},{l:'Amount',align:'right'},{l:'Date'},{l:'Status'}],
      d.plannedInflow.map(p=>[
        '<b>'+p.item+'</b>',
        '<b style="color:#10B981">£'+p.amount.toLocaleString()+'</b>',
        p.date,
        mBadge('Confirmed','success')
      ])
    ),'<div style="text-align:right;font-weight:700;font-size:14px;color:#0F172A;padding-top:10px;border-top:2px solid #E5E7EB;margin-top:10px">Total Planned Inflow: £'+d.plannedInflow.reduce((s,p)=>s+p.amount,0).toLocaleString()+'</div>')}`;
  }

  // ===== PLANNED OUTFLOW =====
  else if (tab === 'planoutflow') {
    panel = `<div style="display:flex;justify-content:space-between;margin-bottom:14px"><div style="font-size:13px;color:#475569"><b>Planned Cash Outflow</b> · Forward commitments · Step 2 of 3</div>${mBtn('+ Add Plan','primary')}</div>
    ${mCard('', mTable(
      [{l:'Item'},{l:'Amount',align:'right'},{l:'Date'},{l:'Type'}],
      d.plannedOutflow.map(p=>[
        '<b>'+p.item+'</b>',
        '<b style="color:#EF4444">£'+p.amount.toLocaleString()+'</b>',
        p.date,
        mBadge(p.item.includes('Tax')?'Tax':p.item.includes('Salar')?'Payroll':'Operating','info')
      ])
    ),'<div style="text-align:right;font-weight:700;font-size:14px;color:#0F172A;padding-top:10px;border-top:2px solid #E5E7EB;margin-top:10px">Total Planned Outflow: £'+d.plannedOutflow.reduce((s,p)=>s+p.amount,0).toLocaleString()+'</div>')}
    <div style="margin-top:14px;background:#FEF3C7;border-left:3px solid #F59E0B;padding:14px;border-radius:8px;font-size:13px;color:#92400E"><b>📊 Projected Net:</b> +£${(d.plannedInflow.reduce((s,p)=>s+p.amount,0)-d.plannedOutflow.reduce((s,p)=>s+p.amount,0)).toLocaleString()} for the projection period.</div>`;
  }

  // ===== CATEGORIES & LEDGER =====
  else if (tab === 'categories') {
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>📚 Chart of Accounts Mapping</b> · Map Xero ledger accounts to standardised cash-flow categories</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div>
        <h3 style="font-size:13px;font-weight:700;color:#10B981;margin:0 0 10px;text-transform:uppercase;letter-spacing:.04em">💷 RECEIVED Side</h3>
        ${Object.entries(d.ledgerCategories.received).map(([cat,accts])=>`<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid #10B981;border-radius:8px;padding:12px;margin-bottom:8px">
          <div style="font-weight:700;font-size:13px;color:#065F46;margin-bottom:8px">${cat}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${accts.map(a=>`<span style="font-size:11px;padding:3px 8px;background:#ECFDF5;color:#065F46;border-radius:4px;font-weight:600">${a}</span>`).join('')}</div>
        </div>`).join('')}
      </div>
      <div>
        <h3 style="font-size:13px;font-weight:700;color:#EF4444;margin:0 0 10px;text-transform:uppercase;letter-spacing:.04em">💸 PAID Side</h3>
        ${Object.entries(d.ledgerCategories.paid).map(([cat,accts])=>`<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid #EF4444;border-radius:8px;padding:12px;margin-bottom:8px">
          <div style="font-weight:700;font-size:13px;color:#991B1B;margin-bottom:8px">${cat}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${accts.map(a=>`<span style="font-size:11px;padding:3px 8px;background:#FEE2E2;color:#991B1B;border-radius:4px;font-weight:600">${a}</span>`).join('')}</div>
        </div>`).join('')}
      </div>
    </div>`;
  }

  // ===== USERS =====
  else if (tab === 'users') {
    panel = `<div style="display:flex;justify-content:space-between;margin-bottom:14px"><input type="search" placeholder="Search users..." style="padding:8px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:13px;width:280px">${mBtn('+ Invite User','primary')}</div>
    ${mCard('User Management', mTable(
      [{l:'Email'},{l:'Name'},{l:'Org'},{l:'Role'},{l:'Status'},{l:'Action'}],
      [
        ['owner@example.com','Owner','Crestwell Dental Group',mBadge('Owner','info'),mBadge('Active','success'),'<button style="font-size:11px;color:#0E7C7B;border:none;background:none;cursor:pointer">✏ Edit</button>'],
        ['manager@example.com','Practice Manager','Crestwell Dental Group',mBadge('Admin','info'),mBadge('Active','success'),'<button style="font-size:11px;color:#0E7C7B;border:none;background:none;cursor:pointer">✏ Edit</button>'],
        ['a@example.com','Dr A · Principal','Crestwell Dental Group',mBadge('Associate','neutral'),mBadge('Active','success'),'<button style="font-size:11px;color:#0E7C7B;border:none;background:none;cursor:pointer">✏ Edit</button>'],
        ['accountant@firm.com','External Accountant','Crestwell Dental Group',mBadge('Accountant','neutral'),mBadge('Active','success'),'<button style="font-size:11px;color:#0E7C7B;border:none;background:none;cursor:pointer">✏ Edit</button>'],
        ['new@example.com','Pending Invite','Crestwell Dental Group',mBadge('Read-Only','neutral'),mBadge('Pending','warn'),'<button style="font-size:11px;color:#0E7C7B;border:none;background:none;cursor:pointer">↩ Resend</button>']
      ]
    ))}`;
  }

  // ===== ORGANIZATION =====
  else if (tab === 'organization') {
    panel = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px">
      <h3 style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 12px">Organisation Settings</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
        ${[
          ['Practice Name','name'],['Country','country'],['Contact','contact'],
          ['Email','email'],['Address Line 1','address1'],['Address Line 2','address2'],
          ['City','city'],['County','state'],['Postcode','zip'],
          ['Company No','companyNo'],['VAT No','vatNo'],['UTR','utr']
        ].map(([l,k])=>`<div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">${l}</label>
          <input type="text" value="${d.organization[k]}" onchange="pimUpdateOrg('${k}', this.value)" style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:13.5px">
        </div>`).join('')}
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid #E5E7EB;display:flex;gap:12px">
        <div style="flex:1"><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Financial Year Start Month</label><select style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:13.5px"><option>April (UK default)</option><option>January</option><option>October</option></select></div>
        <div style="flex:1"><label style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Currency</label><select style="width:100%;padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:13.5px"><option>GBP (£)</option><option>EUR (€)</option><option>USD ($)</option></select></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${mCard('Security', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        <button style="padding:10px 14px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:7px;text-align:left;font-weight:600;cursor:pointer">🔐 Change Password</button>
        <button style="padding:10px 14px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:7px;text-align:left;font-weight:600;cursor:pointer">📱 Two-Factor Authentication</button>
        <button style="padding:10px 14px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:7px;text-align:left;font-weight:600;cursor:pointer">📜 Session History</button>
      </div>`)}
      ${mCard('Multi-Org', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        <button style="padding:10px 14px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:7px;text-align:left;font-weight:600;cursor:pointer">🏢 Switch Organisation</button>
        <button style="padding:10px 14px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:7px;text-align:left;font-weight:600;cursor:pointer">+ Add Organisation</button>
        <div style="font-size:11.5px;color:#64748B;padding:8px">Current: Crestwell Dental Group Ltd</div>
      </div>`)}
    </div>`;
  }

  // ===== INTEGRATIONS =====
  else if (tab === 'integrations') {
    const ints = [
      {n:'Xero', desc:'Accounting · invoices, bills, P&L, balance sheet', status:'Connected', last:'2h ago', icon:'💼'},
      {n:'QuickBooks Online', desc:'Accounting alternative', status:'Not connected', last:'—', icon:'💼'},
      {n:'Dentally', desc:'Practice management · appointments, treatments, patients', status:'Connected', last:'15min ago', icon:'🦷'},
      {n:'Software of Excellence', desc:'PMS alternative · SOE/Dentrix', status:'Not connected', last:'—', icon:'🦷'},
      {n:'Plandent', desc:'Materials & supplies orders', status:'Not connected', last:'—', icon:'📦'},
      {n:'Open Banking · Plaid', desc:'Direct bank feed', status:'Not connected', last:'—', icon:'🏦'},
      {n:'TrueLayer', desc:'Open Banking · UK', status:'Not connected', last:'—', icon:'🏦'},
      {n:'NHS BSA', desc:'UDA performance data', status:'CSV upload', last:'CSV monthly', icon:'🏛'},
      {n:'Stripe', desc:'Patient payments + subscriptions', status:'Connected', last:'Live', icon:'💳'},
      {n:'Twilio', desc:'SMS reminders + payment chasers', status:'Connected', last:'Live', icon:'📱'},
      {n:'SendGrid', desc:'Transactional email', status:'Connected', last:'Live', icon:'📧'}
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
      ${ints.map(i=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div style="display:flex;gap:12px;align-items:center;flex:1">
          <div style="font-size:28px">${i.icon}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:13.5px;color:#0F172A">${i.n}</div>
            <div style="font-size:11.5px;color:#64748B">${i.desc}</div>
            <div style="font-size:10.5px;color:#94A3B8;margin-top:2px">Last sync: ${i.last}</div>
          </div>
        </div>
        ${i.status==='Connected'||i.status==='Live'?'<button style="background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;padding:6px 12px;border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer">✓ Connected</button>':'<button style="background:#0E7C7B;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer">Connect →</button>'}
      </div>`).join('')}
    </div>`;
  }

  // ===== TUTORIAL PROGRESS =====
  else if (tab === 'tutorial') {
    const steps = [
      {id:1,n:'Connect Xero',done:true},
      {id:2,n:'Connect Dentally',done:true},
      {id:3,n:'Set Categories',done:true},
      {id:4,n:'Map Ledger Accounts',done:true},
      {id:5,n:'Configure Chairs',done:true},
      {id:6,n:'Add Associates',done:true},
      {id:7,n:'Upload Monthly Data',done:true},
      {id:8,n:'Set UDA Targets',done:true},
      {id:9,n:'Configure Treatment Master',done:true},
      {id:10,n:'Cash Inflow Monitoring',done:true},
      {id:11,n:'Cash Outflow Monitoring',done:true},
      {id:12,n:'Closing Bank Trend',done:true},
      {id:13,n:'Planned Cash Inflow',done:true},
      {id:14,n:'Planned Cash Outflow',done:true},
      {id:15,n:'Projected Cash Flow',done:true},
      {id:16,n:'Cash Flow Insights · Past',done:true},
      {id:17,n:'Cash Flow Insights · Present',done:false},
      {id:18,n:'Cash Flow Insights · Future',done:false},
      {id:19,n:'Profit Benchmark',done:false},
      {id:20,n:'Associate Overview',done:false},
      {id:21,n:'Associate List',done:false},
      {id:22,n:'Associate Monthly Upload',done:false},
      {id:23,n:'Associate Profit Goals',done:false},
      {id:24,n:'Associate UDA Goals',done:false},
      {id:25,n:'Treatment Overview',done:false},
      {id:26,n:'Treatment List & Steps',done:false},
      {id:27,n:'Treatment Master',done:false},
      {id:28,n:'Treatment Grouping',done:false},
      {id:29,n:'Treatment Profitability',done:false},
      {id:30,n:'Treatment Profit Goals',done:false},
      {id:31,n:'Chair Overview',done:false},
      {id:32,n:'Chair Settings',done:false},
      {id:33,n:'Chair Efficiency',done:false},
      {id:34,n:'Chair Recovery',done:false}
    ];
    const doneCount = steps.filter(s=>s.done).length;
    panel = `<div style="background:linear-gradient(135deg,#0E7C7B,#0F766E);color:#fff;border-radius:14px;padding:24px;margin-bottom:18px">
      <h3 style="font-size:18px;font-weight:700;margin:0 0 6px">Onboarding Tutorial Progress</h3>
      <div style="font-size:13px;opacity:.9;margin-bottom:14px">${doneCount} of ${steps.length} steps completed · ${Math.round(doneCount/steps.length*100)}%</div>
      <div style="background:rgba(255,255,255,.18);height:10px;border-radius:5px;overflow:hidden"><div style="background:#fff;height:100%;width:${doneCount/steps.length*100}%"></div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      ${steps.map(s=>`<div style="background:${s.done?'#ECFDF5':'#fff'};border:1px solid ${s.done?'#A7F3D0':'#E5E7EB'};border-radius:7px;padding:10px;display:flex;align-items:center;gap:8px">
        <div style="width:24px;height:24px;border-radius:50%;background:${s.done?'#10B981':'#E5E7EB'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${s.done?'✓':s.id}</div>
        <div style="font-size:12px;font-weight:600;color:${s.done?'#065F46':'#475569'}">${s.n}</div>
      </div>`).join('')}
    </div>`;
  }

  return mPage('Practice IQ Manager · CRUD & Settings','Associates · 97 BSA treatments · groups · chair config · AR/AP · cash inflow/outflow · plan inflow/outflow · ledger mapping · users · org · integrations · 34-step tutorial', `${mBtn('⬇ Export config','secondary')}${mBtn('📤 Import','secondary')}`) + mTabs(tab, tabs, 'pimSetTab') + panel + `</div>`;
};
