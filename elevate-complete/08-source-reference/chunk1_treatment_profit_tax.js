
/* TREATMENT MASTER — 97-treatment catalogue */
const ELV_GROUPS=['Product','Diagnosis','Prosthodontics','Restorative','Miscellaneous','Oral Surgery','Periodontology','Orthodontics','Endodontics','Cosmetic','Uncategorized'];
const ELV_GROUP_COLOURS={'Product':'#8B5CF6','Diagnosis':'#3B82F6','Prosthodontics':'#EC4899','Restorative':'#10B981','Miscellaneous':'#94A3B8','Oral Surgery':'#EF4444','Periodontology':'#F59E0B','Orthodontics':'#06B6D4','Endodontics':'#A855F7','Cosmetic':'#F472B6','Uncategorized':'#64748B'};
function loadTreatmentMaster(){
  const cached=localStorage.getItem('elevate-treatment-master');
  if(cached){try{return JSON.parse(cached)}catch(e){}}
  function classify(code,desc){const d=desc.toLowerCase(),c=code.toLowerCase();if(/invisalign|brace|retain|ortho/.test(d)||/^inv|invis/.test(c))return'Orthodontics';if(/whitening|bonding|veneer|cosmet|jacket crown/.test(d))return'Cosmetic';if(/root canal|rct/.test(d)||/^rct/.test(c))return'Endodontics';if(/scale|polish|hygien|fluoride|fissure|interspace|periodont/.test(d))return'Periodontology';if(/extraction|surg|implant/.test(d)||c==='ext'||/^i-di|^imp/.test(c))return'Oral Surgery';if(/denture|crown|bridge|pontic|inlay|maryland/.test(d))return'Prosthodontics';if(/filling|amalgam|composite|glass ionomer|temp fill|dressing/.test(d)||c==='a'||c==='c'||c==='gi')return'Restorative';if(/exam|radiograph|xray|panoral|assess|note|prescription|emergency/.test(d))return'Diagnosis';if(/mouthguard|nightguard|brush|tray/.test(d))return'Product';if(/referral|review|adjustment/.test(d))return'Miscellaneous';return'Uncategorized'}
  const groupDefaults={'Product':{time:15,value:50,material:5,labBill:0,assocPct:50,finPct:0},'Diagnosis':{time:15,value:65,material:2,labBill:0,assocPct:50,finPct:0},'Prosthodontics':{time:60,value:850,material:25,labBill:140,assocPct:50,finPct:1},'Restorative':{time:30,value:165,material:12,labBill:0,assocPct:50,finPct:0},'Miscellaneous':{time:15,value:30,material:0,labBill:0,assocPct:50,finPct:0},'Oral Surgery':{time:45,value:240,material:20,labBill:0,assocPct:50,finPct:1},'Periodontology':{time:30,value:75,material:5,labBill:0,assocPct:50,finPct:0},'Orthodontics':{time:30,value:2950,material:0,labBill:380,assocPct:50,finPct:3},'Endodontics':{time:75,value:550,material:18,labBill:0,assocPct:50,finPct:1},'Cosmetic':{time:60,value:450,material:22,labBill:120,assocPct:50,finPct:2},'Uncategorized':{time:20,value:80,material:5,labBill:0,assocPct:50,finPct:0}};
  const SEED=[['INV-LITE','Lite Invisalign Package'],['IB001','Interspace Brush'],['CRMM','Metal Crown'],['CRPP','Porcelain Crown'],['MGS','Soft Mouthguard'],['AMA','Amalgam Filling'],['ADD-DN','Addition of Tooth to a Denture'],['ASSESS','Assessment and Advice'],['NOTE','Clinical Note'],['COM','Composite Filling'],['CRN-PREP','Crown Preparation and Impressions'],['CRN-POST','Post Crown Prep and Impressions'],['DEN-P1','Primary Denture Impressions'],['DEN-P2','Secondary Denture Impressions'],['DEN-BITE','Denture Bite Visit'],['DEN-TRY','Denture Try-in'],['DEN-MTRY','Metal Try-in'],['DAF','Full Acrylic Denture Upper or Lower'],['DAFF','Full Acrylic Denture'],['DAP','Partial Acrylic Denture'],['DCR','Chrome Cobalt Denture'],['DRESS-TMP','Temporary Filling / Dressing'],['DEN-RIM','Resin Denture Impression with Rims'],['EMER','Emergency Appointment'],['EX15','15 Minute Routine Examination'],['EXAM','Examination'],['EXPI','Plan-Inclusive Routine Examination'],['XR-BW','Bitewing Radiographs'],['XR-PA','Periapical Radiographs'],['EXT','Extraction'],['EXT-URG','Urgent Extraction'],['FAM','Amalgam Restoration'],['FCO','Cosmetic Resin Filling'],['FCP','Posterior Composite Filling'],['FGI','Glass Ionomer'],['FLU','Fluoride Varnish'],['GI','Glass Ionomer Filling'],['HYG','Hygienist Scaling and Polishing'],['INL-PREP','Inlay Preparation and Impression'],['IMP-FIT','Dental Implant Fitting'],['IMP-ASS','Implant Assessment'],['INVIS-L3','Invisalign Level 3'],['PRESC','Issue of Prescription'],['PSP','Scale and Polish with the Dentist'],['PSPP','Plan-Inclusive Scale and Polish with the Dentist'],['XR-MED','Medium Radiograph'],['XR-SM','Small Radiograph'],['XR-SM2','Small Radiograph (alt)'],['RCT','Root Canal Treatment'],['RCT-DRAIN','Open Root Canal for Drainage'],['RCT2','Root Canal Treatment (Molar)'],['BR-RECEM','Recement Bridge'],['COM-URG','Urgent Composite'],['CPJ-FIT','Porcelain Jacket Crown Fit'],['DEN-EASE','Denture Ease'],['HYG-SVC','Hygienist Services'],['INVIS-EX','Initial Invisalign Assessment'],['BR-PREP','Bridge Preparation and Impressions'],['INL-FIT','Composite Inlay Fit'],['PONT-PO','Porcelain Pontic'],['XR-LG','Large Radiograph'],['FRTOOTH','Fractured Tooth'],['INVIS-CMP','Comprehensive Invisalign Assessment'],['DA','Acrylic Denture'],['CRN-PREP-2','Crown Prep'],['DEN-SVC','Denture Services'],['MG-CLEAR','Clear Mouthguard Fit'],['NG','Nightguard'],['FIS','Fissure Sealant'],['RETR','Removable Retainer'],['PAN','Panoral'],['BR-BPBF','Porcelain Bonded Bridge'],['CRN-PJ','Porcelain Jacket Crown'],['EMER-WH','Emergency Appointment (Working Hours)'],['AB-RX','Antibiotic Prescription'],['CRN-BNP','Bonded Full or Jacket Crown Non-Precious'],['DIMP','Impressions (Nightguards etc)'],['XR-M','Medium Radiograph (alt)'],['BR-BNPM','Bonded Non-Precious Metal Bridge'],['BR-RPM','Bridge Retainer Precious Metal'],['DP-COMP','Partial Plate Denture Not Fitted'],['DR-COMP','Resin Denture Not Fitted'],['F-TEMP','Temporary Filling'],['REF-MAND','Referral for Advanced Mandatory Services'],['PAN-ALT','Panoral (alt)'],['DC','Chrome Denture'],['CRN-POST-FIT','Post Fit'],['T-TRAY','Teeth Whitening Tray'],['CRN-UNK','Crown Unknown Material'],['F-UNK','Filling Temp Unknown Material'],['ADJ-O','Other Adjustments to Dentures'],['MST','Stone and Smooth Tooth Surface'],['ADD-CLASP','Addition of Clasp to a Denture'],['MD-FIT','Maryland Pontic Fit'],['MD-WING','Maryland Wing Fit'],['DRESS-2','Dressing'],['EX-REV','Review Appointment']];
  const overrides={'IMP-FIT':{value:3500,material:380,labBill:280,time:90,finPct:2},'IMP-ASS':{value:250,material:15,labBill:0,time:45},'INVIS-CMP':{value:175,material:5,labBill:0,time:30},'INV-LITE':{value:2950,material:25,labBill:380,time:30,finPct:3},'INVIS-L3':{value:4250,material:25,labBill:550,time:30,finPct:4},'CRPP':{value:625,material:18,labBill:165,time:60,finPct:1},'CRMM':{value:495,material:15,labBill:120,time:60,finPct:1},'BR-BPBF':{value:1450,material:40,labBill:380,time:90,finPct:2},'DAFF':{value:850,material:25,labBill:185,time:60,finPct:1},'DCR':{value:1250,material:30,labBill:320,time:75,finPct:1},'COM':{value:165,material:12,labBill:0,time:30},'FCO':{value:225,material:14,labBill:0,time:45},'FCP':{value:195,material:13,labBill:0,time:40},'RCT':{value:550,material:18,labBill:0,time:75,finPct:1},'RCT2':{value:725,material:20,labBill:0,time:90,finPct:1},'EXT':{value:165,material:8,labBill:0,time:30},'HYG':{value:75,material:5,labBill:0,time:30},'EXAM':{value:65,material:2,labBill:0,time:15},'EX15':{value:65,material:2,labBill:0,time:15},'BR-PREP':{value:850,material:30,labBill:220,time:75,finPct:1}};
  const treatments=SEED.map((s,idx)=>{const[code,desc]=s;const group=classify(code,desc);const d=groupDefaults[group];const o=overrides[code]||{};return{id:'t-'+String(idx+1).padStart(3,'0'),code,description:desc,group,value:o.value??d.value,materialCost:o.material??d.material,labBill:o.labBill??d.labBill,labDiscountPct:0,associatePct:o.assocPct??d.assocPct,therapistPayPerHour:35,financeFeePct:o.finPct??d.finPct,dentistTimeMins:o.time??d.time,therapistTimeMins:0,active:true}});
  try{localStorage.setItem('elevate-treatment-master',JSON.stringify(treatments))}catch(e){}
  return treatments;
}
function setTMFilter(g){localStorage.setItem('elevate-tm-filter',g);render()}
function setTMSearch(s){localStorage.setItem('elevate-tm-search',s);render()}
PAGES['treatment-master']=()=>{
  const treatments=loadTreatmentMaster();
  const filter=localStorage.getItem('elevate-tm-filter')||'all';
  const search=(localStorage.getItem('elevate-tm-search')||'').toLowerCase();
  const counts={};ELV_GROUPS.forEach(g=>counts[g]=treatments.filter(t=>t.group===g).length);
  let list=treatments;
  if(filter!=='all')list=list.filter(t=>t.group===filter);
  if(search)list=list.filter(t=>t.code.toLowerCase().includes(search)||t.description.toLowerCase().includes(search));
  return `<div class="topbar"><div class="page-title-row"><h1>Treatment Master</h1><p>${treatments.length} treatments across ${ELV_GROUPS.length} clinical groupings · industry-standard dental codes · materials, lab bills, time, associate %, finance %.</p></div>
  <div class="flex gap8"><button class="btn">Import</button><button class="btn">Export</button><button class="btn btn-primary">+ Add treatment</button></div></div>
  <div class="card"><div class="flex gap8" style="flex-wrap:wrap;margin-bottom:14px">
  <button onclick="setTMFilter('all')" style="padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${filter==='all'?'var(--teal)':'var(--line)'};background:${filter==='all'?'var(--teal)':'white'};color:${filter==='all'?'white':'var(--ink)'}">All · ${treatments.length}</button>
  ${ELV_GROUPS.map(g=>`<button onclick="setTMFilter('${g}')" style="padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${filter===g?ELV_GROUP_COLOURS[g]:'var(--line)'};background:${filter===g?ELV_GROUP_COLOURS[g]:'white'};color:${filter===g?'white':'var(--ink)'}">${g} · ${counts[g]||0}</button>`).join('')}
  </div>
  <input value="${search}" oninput="setTMSearch(this.value)" placeholder="Search by code or description…" style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:8px;font-size:13px;margin-bottom:12px;box-sizing:border-box">
  <div style="overflow:auto;max-height:600px"><table style="font-size:11px"><thead><tr><th>Code</th><th>Description</th><th>Group</th><th class="num">Value</th><th class="num">Material</th><th class="num">Lab bill</th><th class="num">Assoc %</th><th class="num">Fin %</th><th class="num">Time</th></tr></thead><tbody>
  ${list.map(t=>`<tr><td style="font-family:monospace;font-weight:700">${t.code}</td><td>${t.description}</td><td><span style="font-size:10px;padding:3px 8px;background:${ELV_GROUP_COLOURS[t.group]}25;color:${ELV_GROUP_COLOURS[t.group]};border-radius:3px;font-weight:700">${t.group}</span></td><td class="num" style="font-family:monospace;font-weight:700">£${t.value}</td><td class="num muted">£${t.materialCost}</td><td class="num muted">£${t.labBill}</td><td class="num">${t.associatePct}%</td><td class="num">${t.financeFeePct}%</td><td class="num">${t.dentistTimeMins}m</td></tr>`).join('')}
  </tbody></table></div>
  <div class="muted small mt8">Showing ${list.length} of ${treatments.length} treatments.</div></div>`;
};

/* PROFIT BENCHMARK — industry standard RAG model */
PAGES['profit-benchmark']=()=>{
  const annualRev=3680000;
  const lines=[
    {cat:'DENTIST',benchPct:45,actualAmt:1693000},
    {cat:'STAFF',benchPct:18,actualAmt:603000},
    {cat:'LAB + MATERIAL',benchPct:15,actualAmt:592000},
    {cat:'OTHER FIXED COSTS',benchPct:12,actualAmt:418000},
    {cat:'PROFIT',benchPct:10,actualAmt:374000}
  ];
  const ragCard=(label,range,colour,explain)=>`<div style="padding:14px 16px;background:${colour}15;border:1px solid ${colour};border-radius:10px"><div style="font-size:11px;font-weight:700;color:${colour};margin-bottom:4px;text-transform:uppercase">${range}</div><div style="font-weight:600;margin-bottom:4px">${label}</div><div class="muted small">${explain}</div></div>`;
  return `<div class="topbar"><div class="page-title-row"><h1>Profit Benchmark</h1><p>Your cost mix vs UK private practice benchmark. Variance arrow shows direction — colour-coded RAG.</p></div></div>
  <div class="card"><h3>Cost structure vs UK benchmark · YTD 2026</h3>
  <table class="mt12"><thead><tr><th>Category</th><th class="num">Expected</th><th class="num">Bench %</th><th class="num">Actual</th><th class="num">Actual %</th><th class="num">Variance</th><th>Status</th><th>Action</th></tr></thead><tbody>
  ${lines.map(l=>{const benchAmt=annualRev*l.benchPct/100;const actualPct=(l.actualAmt/annualRev*100);const variance=actualPct-l.benchPct;const isProfit=l.cat==='PROFIT';const good=isProfit?variance>=0:variance<=0;const cls=good?'pos':(Math.abs(variance)>3?'neg':'warn');const arrow=variance>0?'↑':variance<0?'↓':'→';const status=Math.abs(variance)<=1?'On benchmark':good?(Math.abs(variance)<3?'Slight improvement':'Fantastic improvement'):(Math.abs(variance)<3?'Slight erosion':'Eroding');const action=isProfit?(variance>=0?'Reinvest excess':'Tighten cost mix'):(variance>0?'Renegotiate or reduce':'Holding line');return `<tr><td><b>${l.cat}</b></td><td class="num">${f(benchAmt)}</td><td class="num">${l.benchPct}%</td><td class="num">${f(l.actualAmt)}</td><td class="num"><b>${actualPct.toFixed(1)}%</b></td><td class="num ${cls}">${arrow} ${variance>=0?'+':''}${variance.toFixed(1)}pp</td><td><span class="pill ${cls}">${status}</span></td><td class="small">${action}</td></tr>`}).join('')}
  </tbody></table></div>
  <div class="card mt16"><h3>RAG card key</h3>
  <div class="grid g4">
  ${ragCard('Fantastic improvement','-3% & below','#10B981','Cost lines well below benchmark or profit well above. Lock in gains.')}
  ${ragCard('Slight improvement','-1pp to -3pp','#10B981','Moving in the right direction. Keep pushing.')}
  ${ragCard('Slight erosion','+1pp to +3pp','#F59E0B','Trend wrong — intervene now.')}
  ${ragCard('Critical erosion','+3% & above','#EF4444','Material drift — immediate action required.')}
  </div></div>`;
};

/* CORPORATION TAX PLANNING */
PAGES['corp-tax']=()=>{
  const annualProfit=374000;
  const smallProfits=Math.min(annualProfit,250000)*0.19;
  const mainRate=Math.max(0,annualProfit-250000)*0.25;
  const corpTax=smallProfits+mainRate;
  return `<div class="topbar"><div class="page-title-row"><h1>Corporation Tax Planning</h1><p>Annual tax liability · small profits band, main rate, quarterly VAT. Plan reliefs and timing.</p></div></div>
  <div class="grid g4" style="margin-bottom:14px">${kpi('Annual profit','£'+annualProfit.toLocaleString(),{txt:'FY26',dir:'flat'})}${kpi('Estimated corp tax','£'+corpTax.toLocaleString(),{txt:'Due 1 Feb 2027',dir:'flat'},'warn')}${kpi('Effective tax rate',(corpTax/annualProfit*100).toFixed(1)+'%',null)}${kpi('Quarterly VAT due','£42,180',{txt:'7 Jul 2026',dir:'flat'})}</div>
  <div class="grid g2"><div class="card"><h3>Corporation tax calc · FY26</h3>
  <table class="mt12"><tr><td>Annual profit (per management accounts)</td><td class="num">${f(annualProfit)}</td></tr>
  <tr><td>Add back: non-deductible</td><td class="num">£0</td></tr>
  <tr><td>Less: capital allowances (AIA)</td><td class="num neg">-£18,200</td></tr>
  <tr style="font-weight:600;border-top:1px solid var(--line)"><td><b>Taxable profit</b></td><td class="num"><b>${f(annualProfit-18200)}</b></td></tr>
  <tr><td>Small profits band (£0-£250k @ 19%)</td><td class="num">${f(Math.min(annualProfit-18200,250000)*0.19)}</td></tr>
  <tr><td>Main rate (over £250k @ 25%)</td><td class="num">${f(Math.max(0,annualProfit-18200-250000)*0.25)}</td></tr>
  <tr style="font-weight:600;border-top:2px solid var(--ink)"><td><b>Total corporation tax</b></td><td class="num" style="color:var(--teal)"><b>${f(corpTax)}</b></td></tr>
  <tr><td>Due date</td><td class="num">1 Feb 2027</td></tr></table></div>
  <div class="card"><h3>VAT breakdown · Q1 FY26</h3>
  <table class="mt12"><tr><td>Total quarterly revenue</td><td class="num">£920,000</td></tr>
  <tr><td>Exempt (dental services)</td><td class="num">£809,600</td></tr>
  <tr><td>Standard rated (cosmetic, retail)</td><td class="num">£110,400</td></tr>
  <tr><td>Input VAT reclaim</td><td class="num neg">-£6,420</td></tr>
  <tr style="font-weight:600;border-top:1px solid var(--line)"><td><b>VAT due (20%)</b></td><td class="num" style="color:var(--teal)"><b>£15,660</b></td></tr></table>
  <div class="hint info mt8 small">Dental services are VAT-exempt (Group 7, Sched 9 VATA 1994). Standard-rated: whitening, mouthguards, dental products, cosmetic.</div></div></div>
  <div class="card mt16"><h3>Tax planning levers · FY26</h3>
  <table class="mt12"><thead><tr><th>Lever</th><th class="num">Saving</th><th>Implementation</th><th>Deadline</th><th>Status</th></tr></thead><tbody>
  <tr><td>AIA on CBCT scanner</td><td class="num pos">£42,500</td><td>Capex before 31 Mar 2027</td><td>31 Mar 2027</td><td><span class="pill warn">Consider</span></td></tr>
  <tr><td>Pension contribution (Director SSAS)</td><td class="num pos">£14,800</td><td>£40k contribution</td><td>31 Mar 2027</td><td><span class="pill pos">Recommended</span></td></tr>
  <tr><td>R&D tax credit (clinical innovation)</td><td class="num pos">£18,200</td><td>Submit with accounts</td><td>2 yrs post-FY</td><td><span class="pill warn">Pending</span></td></tr>
  <tr><td>Staff bonus (deductible)</td><td class="num pos">£8,400</td><td>£35k bonus pool</td><td>FY end</td><td><span class="pill info">Annual</span></td></tr>
  <tr><td>Director loan repayment timing</td><td class="num pos">£3,200</td><td>Repay within 9mo of period end</td><td>9mo post FY</td><td><span class="pill pos">Scheduled</span></td></tr>
  </tbody></table>
  <div class="hint info mt12"><b>Total saving potential: £87,100</b> — reduces effective rate from ${(corpTax/annualProfit*100).toFixed(1)}% to ${((corpTax-87100)/annualProfit*100).toFixed(1)}%.</div></div>`;
};
