
// ============================================================================
// CHUNK 8 — MARKETING PRO + COMPLIANCE PRO + HR PRO
// ============================================================================

// ========== MARKETING PRO ==========
window.mpSetTab = function(t) { localStorage.setItem('mp-tab', t); navigate('marketing-pro'); };
PAGES['marketing-pro'] = () => {
  const tab = localStorage.getItem('mp-tab') || 'ltvcac';
  const tabs = [
    {k:'ltvcac', l:'LTV : CAC', i:'💎'},
    {k:'attribution', l:'Multi-Touch', i:'🎯'},
    {k:'nps', l:'NPS / CSAT', i:'⭐'},
    {k:'abtest', l:'A/B Tests', i:'🧪'},
    {k:'winloss', l:'Win/Loss', i:'🏆'},
    {k:'localseo', l:'Local SEO', i:'📍'},
    {k:'response', l:'Reputation Response', i:'💬'},
    {k:'journey', l:'Customer Journey', i:'🗺'},
    {k:'velocity', l:'Funnel Velocity', i:'⚡'},
    {k:'retention', l:'Cohort Retention', i:'🔁'},
    {k:'voc', l:'Voice of Customer', i:'🎙'},
    {k:'competitive', l:'Competitive Grid', i:'⚔'}
  ];
  let panel = '';

  if (tab === 'ltvcac') {
    const channels = [
      {n:'Meta Ads', cac:198, ltv:2840, ratio:14.3, pb:3.2, c:'#1877F2'},
      {n:'Google Ads', cac:225, ltv:3120, ratio:13.9, pb:3.5, c:'#4285F4'},
      {n:'SEO Organic', cac:42, ltv:2960, ratio:70.5, pb:0.5, c:'#10B981'},
      {n:'Referral', cac:0, ltv:4280, ratio:Infinity, pb:0, c:'#8B5CF6'},
      {n:'TikTok', cac:340, ltv:1840, ratio:5.4, pb:5.8, c:'#000'},
      {n:'Email Marketing', cac:18, ltv:2240, ratio:124.4, pb:0.3, c:'#F59E0B'},
      {n:'Direct (Brand)', cac:0, ltv:3480, ratio:Infinity, pb:0, c:'#3B82F6'}
    ];
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>Healthy benchmark:</b> LTV:CAC ≥ 3× · Payback ≤ 12 months</div>
    ${mCard('LTV : CAC by Channel', mTable(
      [{l:'Channel'},{l:'CAC',align:'right'},{l:'12mo LTV',align:'right'},{l:'LTV:CAC',align:'right'},{l:'Payback',align:'right'},{l:'Verdict'}],
      channels.map(c => [
        `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:${c.c};border-radius:2px"></span><b>${c.n}</b></span>`,
        c.cac>0?'£'+c.cac:'£0',
        '£'+c.ltv.toLocaleString(),
        c.ratio===Infinity?'<b style="color:#10B981">∞</b>':`<b style="color:${c.ratio>=3?'#10B981':'#EF4444'}">${c.ratio.toFixed(1)}×</b>`,
        c.pb>0?c.pb+' mo':'instant',
        c.ratio>=10?mBadge('Excellent','success'):c.ratio>=3?mBadge('Healthy','success'):mBadge('Underperforming','danger')
      ])
    ))}`;
  } else if (tab === 'attribution') {
    panel = `<div style="background:#FEF3C7;border-left:3px solid #F59E0B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#92400E"><b>📊 Multi-touch attribution:</b> Customer touched 4.2 channels on average before booking. Last-click attribution over-credits Google Ads by ~35%.</div>
    ${mCard('Attribution Model Comparison · Last 90 days', mTable(
      [{l:'Channel'},{l:'First-Touch',align:'right'},{l:'Last-Touch',align:'right'},{l:'Linear',align:'right'},{l:'Position-Based',align:'right'},{l:'Data-Driven'}],
      [
        ['<b>Meta Ads</b>','42%','22%','30%','35%','<b style="color:#0E7C7B">32%</b>'],
        ['<b>Google Ads</b>','18%','45%','28%','30%','<b style="color:#0E7C7B">29%</b>'],
        ['<b>SEO Organic</b>','22%','18%','22%','18%','<b style="color:#0E7C7B">20%</b>'],
        ['<b>Email</b>','4%','12%','10%','8%','<b style="color:#0E7C7B">11%</b>'],
        ['<b>Direct</b>','8%','3%','6%','5%','<b style="color:#0E7C7B">5%</b>'],
        ['<b>Other</b>','6%','—','4%','4%','<b style="color:#0E7C7B">3%</b>']
      ]
    ))}
    <div style="margin-top:14px">${mCard('Path-to-Conversion Insights', `<div style="font-size:13px;color:#475569;line-height:1.7">
      <b style="color:#0F172A">Avg touchpoints to convert:</b> 4.2 channels · 12 days lead time<br>
      <b style="color:#0F172A">Most common path:</b> Meta Ad → SEO visit → Email → Google search → Book<br>
      <b style="color:#0F172A">Recommendation:</b> Stop killing Meta Ads · they're the #1 first-touch source. Reallocate 12% of Google spend to Meta retargeting.
    </div>`)}</div>`;
  } else if (tab === 'nps') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('⭐','NPS Score','+72','+8','industry avg: +40')}
      ${mKpi('😊','CSAT','94%','+2%','very satisfied')}
      ${mKpi('🎯','Response Rate','38%','','of surveys sent')}
      ${mKpi('📨','Surveys Sent','1,840','','last 90 days')}
    </div>
    ${mCard('NPS Distribution', `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      <div style="background:#ECFDF5;border-radius:10px;padding:16px;text-align:center"><div style="font-size:11px;font-weight:700;color:#065F46;text-transform:uppercase">PROMOTERS (9-10)</div><div style="font-size:36px;font-weight:700;color:#065F46;letter-spacing:-.02em">78%</div></div>
      <div style="background:#FEF3C7;border-radius:10px;padding:16px;text-align:center"><div style="font-size:11px;font-weight:700;color:#92400E;text-transform:uppercase">PASSIVES (7-8)</div><div style="font-size:36px;font-weight:700;color:#92400E;letter-spacing:-.02em">16%</div></div>
      <div style="background:#FEE2E2;border-radius:10px;padding:16px;text-align:center"><div style="font-size:11px;font-weight:700;color:#991B1B;text-transform:uppercase">DETRACTORS (0-6)</div><div style="font-size:36px;font-weight:700;color:#991B1B;letter-spacing:-.02em">6%</div></div>
    </div>`)}
    <div style="margin-top:14px">${mCard('Top Mentions · AI-tagged from comments', mTable(
      [{l:'Theme'},{l:'Mentions',align:'right'},{l:'Sentiment'},{l:'Action'}],
      [
        ['Staff friendliness','428','<b style="color:#10B981">+92%</b>','Maintain'],
        ['Wait time','82','<b style="color:#F59E0B">+45%</b>','Reduce 5-min variance'],
        ['Treatment explanation','318','<b style="color:#10B981">+88%</b>','Train new staff to same standard'],
        ['Pricing transparency','62','<b style="color:#F59E0B">+38%</b>','Add upfront cost calculator'],
        ['Parking','24','<b style="color:#EF4444">+12%</b>','Explore partnership']
      ]
    ))}</div>`;
  } else if (tab === 'abtest') {
    panel = `${mCard('Active & Recent A/B Tests', mTable(
      [{l:'Test'},{l:'Variant A'},{l:'Variant B'},{l:'Lift',align:'right'},{l:'Confidence',align:'right'},{l:'Status'}],
      [
        ['Landing page hero CTA','Book Free Consult','Get My Smile Plan','<b style="color:#10B981">+18.4%</b>','98%',mBadge('Winner: B','success')],
        ['Email subject line','Your appointment','Smile in 6 weeks 💎','<b style="color:#10B981">+24%</b>','94%',mBadge('Winner: B','success')],
        ['Pricing display','Hidden until consult','From £2,400','<b style="color:#10B981">+12%</b>','89%',mBadge('Need more data','warn')],
        ['Ad creative · Meta','Before/After photo','Patient video testimonial','<b style="color:#10B981">+8%</b>','72%',mBadge('Running','info')],
        ['Booking flow steps','3 steps','2 steps','<b style="color:#EF4444">-3%</b>','45%',mBadge('No winner','neutral')]
      ]
    ))}`;
  } else if (tab === 'winloss') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('✅','Win Rate','62%','+5%','treatment plans accepted')}
      ${mKpi('❌','Loss Rate','38%','','need to understand why')}
      ${mKpi('💷','Avg Won £','£3,840','','accepted plan value')}
      ${mKpi('💸','Avg Lost £','£4,920','','higher than won')}
    </div>
    ${mCard('Why patients said No · Last 90 days', mTable(
      [{l:'Reason'},{l:'Count',align:'right'},{l:'% of Losses',align:'right'},{l:'Avg £',align:'right'},{l:'Fix'}],
      [
        ['Price too high','142','42%','£5,820','Offer financing · payment plans'],
        ['Need time to think','82','24%','£3,200','7-day follow-up call · case fee'],
        ['Going elsewhere','48','14%','£4,400','Match-or-beat-quote policy'],
        ['Will use insurance','28','8%','£2,400','Pre-auth check before consult'],
        ['Personal/health reasons','22','6%','£3,800','Re-engage in 6mo'],
        ['Other','20','6%','£3,400','Survey & investigate']
      ]
    ))}`;
  } else if (tab === 'localseo') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('🔍','GBP Impressions (90d)','42,400','+18%','Google Business Profile')}
      ${mKpi('📞','Calls from GBP','382','+12%','direct call clicks')}
      ${mKpi('🗺','Direction Requests','248','+24%','people coming to you')}
      ${mKpi('📸','Photo Views','18,400','+8%','GBP photos')}
    </div>
    ${mCard('Local Pack Rankings · Per Site', mTable(
      [{l:'Site'},{l:'Local Pack Position',align:'right'},{l:'Reviews',align:'right'},{l:'Rating',align:'right'},{l:'GBP Posts (mo)',align:'right'},{l:'Status'}],
      [
        ['Beechcroft Dental','#1','412','4.9','12',mBadge('Strong','success')],
        ['Edenford Practice','#2','286','4.8','8',mBadge('Strong','success')],
        ['Belmont Smile Centre','#1','198','4.9','10',mBadge('Strong','success')],
        ['Westfield Dental Studio','#3','124','4.7','6',mBadge('Improve','warn')],
        ['Hartwell Implant Clinic','#1','92','5.0','4',mBadge('Strong','success')]
      ]
    ))}`;
  } else if (tab === 'response') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('⚡','Avg Response Time','3h 14m','-2h','target: <4h')}
      ${mKpi('💬','Response Rate','98%','+2%','of reviews answered')}
      ${mKpi('⚠','Unanswered >24h','2','','action needed')}
      ${mKpi('⭐','Avg Rating','4.85','+0.1','across all platforms')}
    </div>
    ${mCard('Outstanding Reviews · Action Required', mTable(
      [{l:'Platform'},{l:'Site'},{l:'Rating',align:'right'},{l:'Age'},{l:'Action'}],
      [
        ['Google','Beechcroft','⭐ 5','2h ago',mBadge('Acknowledge','info')],
        ['Google','Westfield','⭐⭐ 2','18h ago','<b style="color:#EF4444">Urgent reply needed</b>'],
        ['Facebook','Edenford','⭐⭐⭐ 3','4h ago',mBadge('Investigate','warn')],
        ['Google','Belmont','⭐ 5','1h ago',mBadge('Thank you','info')],
        ['Doctify','Hartwell','⭐ 5','30m ago',mBadge('Thank you','info')]
      ]
    ))}`;
  } else if (tab === 'journey') {
    const stages = [
      {n:'Awareness', touches:'Meta Ad · Friend mention · Google Maps', avgDays:42, dropoff:0},
      {n:'Research', touches:'Website visit · Review platforms · Compare 2-3 practices', avgDays:18, dropoff:38},
      {n:'Consideration', touches:'Email opt-in · Pricing page · Treatment guides', avgDays:9, dropoff:24},
      {n:'Decision', touches:'Call · WhatsApp · Book consult', avgDays:3, dropoff:18},
      {n:'Consultation', touches:'In-person visit · Treatment plan', avgDays:0, dropoff:12},
      {n:'Treatment Start', touches:'Deposit · First treatment session', avgDays:14, dropoff:22},
      {n:'Loyalty', touches:'Hygiene recall · Referral · Reviews', avgDays:182, dropoff:8}
    ];
    panel = `${mCard('Customer Journey Map · Awareness → Loyalty', mTable(
      [{l:'Stage'},{l:'Touchpoints'},{l:'Avg Days',align:'right'},{l:'Dropoff %',align:'right'},{l:'Action'}],
      stages.map(s => [
        '<b>'+s.n+'</b>',
        '<span style="font-size:12px;color:#475569">'+s.touches+'</span>',
        s.avgDays.toString(),
        s.dropoff>0?'<b style="color:'+(s.dropoff>25?'#EF4444':'#F59E0B')+'">'+s.dropoff+'%</b>':'—',
        s.dropoff>25?'Investigate':'Maintain'
      ])
    ))}`;
  } else if (tab === 'velocity') {
    panel = `${mCard('Funnel Velocity · Avg time per stage', mTable(
      [{l:'Stage'},{l:'Current Avg',align:'right'},{l:'Target',align:'right'},{l:'Bottleneck?'},{l:'Fix'}],
      [
        ['Lead → Contacted', '14 min', '<5 min', '<b style="color:#EF4444">Yes</b>', 'Auto-call within 2 min'],
        ['Contacted → Consult Booked', '2.4 h', '<1 h', '<b style="color:#F59E0B">Yes</b>', 'Live calendar at first call'],
        ['Booked → Consult Attended', '7 days', '<5 days', 'Slight', 'Earlier slots · sms reminders'],
        ['Consult → Plan Sent', '36 h', '<24 h', '<b style="color:#EF4444">Yes</b>', 'Plan template + same-day send'],
        ['Plan → Treatment Start', '8 days', '<7 days', 'OK', 'Maintain'],
        ['Treatment → Review', '14 days post-tx', '7 days', '<b style="color:#F59E0B">Yes</b>', 'Auto-trigger at 7 days']
      ]
    ))}`;
  } else if (tab === 'retention') {
    panel = `${mCard('Cohort Retention · % returning vs Month 0', mTable(
      [{l:'Cohort'},{l:'M1',align:'right'},{l:'M3',align:'right'},{l:'M6',align:'right'},{l:'M12',align:'right'},{l:'M24',align:'right'}],
      [
        ['Q1 2024 (n=124)', '92%', '78%', '68%', '62%', '54%'],
        ['Q2 2024 (n=142)', '94%', '81%', '72%', '64%', '—'],
        ['Q3 2024 (n=158)', '95%', '83%', '74%', '66%', '—'],
        ['Q4 2024 (n=148)', '93%', '80%', '71%', '63%', '—'],
        ['Q1 2025 (n=184)', '96%', '84%', '76%', '—', '—'],
        ['Q2 2025 (n=198)', '97%', '85%', '—', '—', '—']
      ]
    ))}
    <div style="margin-top:14px;background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;font-size:13px;color:#0F172A"><b>📈 Trend:</b> Retention curves improving · 6-month retention up from 68% (Q1'24) to 76% (Q1'25) — recall workflow is working.</div>`;
  } else if (tab === 'voc') {
    panel = `${mCard('Voice of Customer · AI-tagged themes from feedback', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div>
        <h4 style="font-size:13px;font-weight:700;color:#065F46;margin:0 0 10px">💚 What patients love</h4>
        ${[
          ['"Best dentist I\'ve ever been to"', 142],
          ['Staff warmth and welcome', 128],
          ['Clear explanation of treatment', 98],
          ['Modern, clean facilities', 82],
          ['Pain-free experience', 64]
        ].map(([q,c])=>`<div style="padding:10px;background:#ECFDF5;border-radius:7px;margin-bottom:6px;font-size:12.5px"><b>${c}×</b> ${q}</div>`).join('')}
      </div>
      <div>
        <h4 style="font-size:13px;font-weight:700;color:#991B1B;margin:0 0 10px">⚠ Areas to improve</h4>
        ${[
          ['"Hard to get appointment quickly"', 38],
          ['Phone wait times', 24],
          ['Cost not clear upfront', 22],
          ['Parking difficult', 18],
          ['Reception not always picking up', 12]
        ].map(([q,c])=>`<div style="padding:10px;background:#FEE2E2;border-radius:7px;margin-bottom:6px;font-size:12.5px"><b>${c}×</b> ${q}</div>`).join('')}
      </div>
    </div>`)}`;
  } else {
    panel = `${mCard('Competitive Positioning Grid · Local Market', mTable(
      [{l:'Practice'},{l:'Price',align:'right'},{l:'Tech',align:'right'},{l:'Brand',align:'right'},{l:'Speed',align:'right'},{l:'Reviews',align:'right'},{l:'Overall'}],
      [
        ['<b>You</b>','£££','5/5','4/5','4/5','4.85','<b style="color:#0E7C7B">Premium · Tech-led</b>'],
        ['Competitor A','£££','4/5','4/5','3/5','4.6','Premium · Established'],
        ['Competitor B','££','3/5','3/5','4/5','4.4','Mid-market'],
        ['Competitor C','££','3/5','5/5','3/5','4.7','Brand-led'],
        ['Bupa Local','£££','4/5','5/5','4/5','4.5','Corporate'],
        ['{Independent}','£','2/5','2/5','5/5','4.2','Budget · Fast']
      ]
    ))}
    <div style="margin-top:14px;background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;font-size:13px;color:#0F172A"><b>🎯 Positioning:</b> You lead on tech (CBCT, intra-oral scanners, same-day crowns). Defend premium pricing with this. Reviews above competitive average. Speed (call-back, booking) is the gap to close.</div>`;
  }

  return mPage('Marketing Pro · LTV:CAC, Attribution, NPS, A/B','Channel ROI · multi-touch · NPS/CSAT · A/B tests · win-loss · local SEO · response · journey · velocity · retention · VoC · competition', `${mBtn('⬇ Export','secondary')}${mBtn('🤖 AI insights','primary')}`) + mTabs(tab, tabs, 'mpSetTab') + panel + `</div>`;
};


// ========== COMPLIANCE PRO ==========
window.cpSetTab = function(t) { localStorage.setItem('cp-tab', t); navigate('compliance-pro'); };
PAGES['compliance-pro'] = () => {
  const tab = localStorage.getItem('cp-tab') || 'cqc';
  const tabs = [
    {k:'cqc', l:'CQC KLOEs', i:'🏛'},
    {k:'incidents', l:'Adverse Incidents', i:'⚠'},
    {k:'complaints', l:'Complaints Register', i:'📋'},
    {k:'irmer', l:'IRMER Radiation', i:'☢'},
    {k:'htm', l:'HTM 01-05 Decon', i:'🧼'},
    {k:'ig', l:'IG / DSP Toolkit', i:'🔒'},
    {k:'equipment', l:'Equipment Log', i:'⚙'},
    {k:'safeguarding', l:'Safeguarding', i:'🛡'},
    {k:'policies', l:'Policy Register', i:'📜'},
    {k:'whistleblowing', l:'Whistleblowing', i:'🔔'},
    {k:'waste', l:'Waste Management', i:'🗑'},
    {k:'fire', l:'Fire Safety', i:'🔥'},
    {k:'coshh', l:'COSHH Register', i:'⚗'}
  ];
  let panel = '';

  if (tab === 'cqc') {
    const kloes = [
      {k:'Safe', score:88, items:['Infection control audit Q3 ✓','Medicines management ✓','Safeguarding L3 training: 14/18 done','Equipment service logs ⚠ 1 overdue'], status:'Good'},
      {k:'Effective', score:92, items:['Treatment outcomes tracked ✓','Clinician CPD on track ✓','Evidence-based protocols ✓','Patient consent SOPs ✓'], status:'Good'},
      {k:'Caring', score:96, items:['Patient surveys: 96% positive','Privacy & dignity audits ✓','Patient advocate available','Family involvement protocols ✓'], status:'Outstanding'},
      {k:'Responsive', score:84, items:['Complaints resolution avg 7 days ✓','Access for vulnerable patients ✓','Waiting times monitored','⚠ Emergency capacity tight some weeks'], status:'Good'},
      {k:'Well-led', score:90, items:['Leadership accountability ✓','Staff engagement surveys: 84% positive','Risk register updated quarterly ✓','Quality improvement program ✓'], status:'Good'}
    ];
    panel = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px">
      ${kloes.map(k=>`<div style="background:#fff;border:1px solid #E5E7EB;border-top:4px solid ${k.score>=90?'#10B981':'#F59E0B'};border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">${k.k}</div>
        <div style="font-size:32px;font-weight:700;color:#0F172A;letter-spacing:-.02em;margin:6px 0">${k.score}</div>
        <div style="font-size:11px;font-weight:700;color:${k.status==='Outstanding'?'#10B981':'#0E7C7B'}">${k.status}</div>
      </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${kloes.map(k=>mCard(k.k+' · Evidence', `<ul style="margin:0;padding-left:18px;font-size:12.5px;color:#475569;line-height:1.7">${k.items.map(i=>`<li style="margin-bottom:3px">${i}</li>`).join('')}</ul>`)).join('')}
    </div>`;
  } else if (tab === 'incidents') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('⚠','Open Incidents','2','','RCA in progress')}
      ${mKpi('✅','Closed (90d)','12','','all CAPA completed')}
      ${mKpi('🚨','Near Misses','4','+1','this quarter')}
      ${mKpi('📊','Trend','↘','-25%','vs last year')}
    </div>
    ${mCard('Incident Register', mTable(
      [{l:'ID'},{l:'Date'},{l:'Severity'},{l:'Type'},{l:'Root Cause'},{l:'CAPA'},{l:'Status'}],
      [
        ['INC-2026-08','12 May','Low','Wrong appointment booked','Reception error','Training refresh',mBadge('Closed','success')],
        ['INC-2026-09','14 May','Med','LA dose miscalculation (no harm)','Junior clinician unfamiliar','Updated protocol + supervision',mBadge('Closed','success')],
        ['INC-2026-10','18 May','Med','Sharps injury · Nurse','Disposal lapse','New container · refresher training',mBadge('Open · RCA','warn')],
        ['INC-2026-11','22 May','Low','Patient slip in waiting area','Wet floor sign missing','Audit cleaning schedule',mBadge('Open · RCA','warn')]
      ]
    ))}`;
  } else if (tab === 'complaints') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('📋','Open Complaints','3','','within SLA')}
      ${mKpi('⏱','Avg Resolution','7 days','-2','target: 10 days')}
      ${mKpi('💬','Resolved (90d)','18','','98% satisfaction')}
      ${mKpi('📈','vs Prior Year','↘ -15%','','improving trend')}
    </div>
    ${mCard('Complaints Register', mTable(
      [{l:'Ref'},{l:'Date'},{l:'Patient'},{l:'Category'},{l:'Days Open',align:'right'},{l:'Status'}],
      [
        ['COM-2026-014','18 May','Anon-A','Treatment outcome dispute','6','In review'],
        ['COM-2026-015','20 May','Anon-B','Pricing transparency','4','Practice Manager response sent'],
        ['COM-2026-016','22 May','Anon-C','Staff manner at reception','2','Investigation pending']
      ]
    ))}`;
  } else if (tab === 'irmer') {
    panel = `${mCard('IRMER Compliance · Radiation', mTable(
      [{l:'Item'},{l:'Status'},{l:'Last Done'},{l:'Next Due'},{l:'Action'}],
      [
        ['Justification framework','✓ Current','Q1 2026','Q1 2027','Annual review'],
        ['Dose audits (random sample)','✓ Done','Apr 2026','Jul 2026','Quarterly'],
        ['IRMER training · clinicians','✓ All trained','various','various','Refresher every 3yr'],
        ['Equipment QC tests','⚠ 1 overdue','Surgery 4 X-ray','Was due 15 May','Schedule this week'],
        ['Patient dose records','✓ Logged','Ongoing','—','Electronic record'],
        ['Pregnancy questionnaires','✓ In use','Ongoing','—','Pre-X-ray protocol']
      ]
    ))}`;
  } else if (tab === 'htm') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('🔬','Autoclaves','4','','all compliant')}
      ${mKpi('✓','Daily Tests','100%','','7 days logged')}
      ${mKpi('📋','Weekly Tests','100%','','Helix/Bowie-Dick')}
      ${mKpi('🔧','Quarterly Validation','Up to date','','last: Apr 2026')}
    </div>
    ${mCard('Decontamination Cycle Logs · Last 30 days', mTable(
      [{l:'Date'},{l:'Cycles Run',align:'right'},{l:'Failures',align:'right'},{l:'Daily Test'},{l:'Weekly Test'},{l:'Recorded By'}],
      [
        ['Today','12','0','✓','—','Lead Nurse'],
        ['Yesterday','14','0','✓','—','Lead Nurse'],
        ['2 days ago','11','0','✓','✓ Bowie-Dick','Lead Nurse'],
        ['3 days ago','13','0','✓','—','Nurse 2'],
        ['4 days ago','10','0','✓','—','Lead Nurse']
      ]
    ))}`;
  } else if (tab === 'ig') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('🔒','DSP Toolkit Status','Standards Met','✓','submitted Aug 2025')}
      ${mKpi('📅','Next Submission','30 Jun 2026','','annual')}
      ${mKpi('👥','Staff IG Trained','17/18','94%','1 overdue')}
      ${mKpi('🛡','Data Breaches (12mo)','0','','clean record')}
    </div>
    ${mCard('IG Toolkit · Assertions', mTable(
      [{l:'Standard'},{l:'Status'}],
      [
        ['Personal confidential data is handled in accordance with the law',mBadge('Met','success')],
        ['Staff training and awareness',mBadge('Met','success')],
        ['Cyber security measures in place',mBadge('Met','success')],
        ['Patient identifiable information access controls',mBadge('Met','success')],
        ['Records retention and disposal',mBadge('Met','success')],
        ['Incident reporting mechanism',mBadge('Met','success')]
      ]
    ))}`;
  } else if (tab === 'equipment') {
    panel = `${mCard('Equipment Service & Calibration', mTable(
      [{l:'Equipment'},{l:'Type'},{l:'Last Service'},{l:'Next Due'},{l:'Status'}],
      [
        ['Autoclave A1','Annual PSSR + 12-monthly validation','Apr 2026','Apr 2027',mBadge('Compliant','success')],
        ['Autoclave A2','Annual PSSR + 12-monthly validation','Apr 2026','Apr 2027',mBadge('Compliant','success')],
        ['X-Ray · Surgery 1','Critical exam + QA','Jan 2026','Jan 2028',mBadge('Compliant','success')],
        ['X-Ray · Surgery 4','Critical exam + QA','May 2024','<b style="color:#EF4444">May 2026</b>','<b style="color:#EF4444">⚠ OVERDUE</b>'],
        ['Compressor','Annual service','Jan 2026','Jan 2027',mBadge('Compliant','success')],
        ['Suction Pumps × 6','Annual service','Mar 2026','Mar 2027',mBadge('Compliant','success')],
        ['Defibrillator','Monthly check + annual battery','May 2026','Jun 2026',mBadge('Compliant','success')]
      ]
    ))}`;
  } else if (tab === 'safeguarding') {
    panel = `${mCard('Safeguarding Training Matrix', mTable(
      [{l:'Staff'},{l:'Role'},{l:'L1 (Awareness)'},{l:'L2 (Clinical)'},{l:'L3 (Leads)'},{l:'Expires'}],
      [
        ['Owner','Clinical Lead','✓','✓','✓','Mar 2027'],
        ['Clinician A','Dentist','✓','✓','—','Aug 2027'],
        ['Clinician B','Dentist','✓','✓','—','Jan 2027'],
        ['Hygienist A','Hygienist','✓','✓','—','Sep 2026'],
        ['Practice Manager','Manager','✓','✓','✓','Jun 2027'],
        ['Reception A','Reception','✓','—','—','<b style="color:#F59E0B">⚠ Due now</b>'],
        ['Nurse A','Dental Nurse','✓','✓','—','Apr 2027']
      ]
    ))}`;
  } else if (tab === 'policies') {
    panel = `${mCard('Policy Register · Version Control', mTable(
      [{l:'Policy'},{l:'Version'},{l:'Last Review'},{l:'Next Review'},{l:'Owner'},{l:'Status'}],
      [
        ['Infection Prevention & Control','v4.2','Jan 2026','Jan 2027','Lead Nurse',mBadge('Current','success')],
        ['Confidentiality & GDPR','v3.8','Sep 2025','Sep 2026','Practice Manager',mBadge('Current','success')],
        ['Safeguarding · Children','v5.1','Jan 2026','Jan 2027','Safeguarding Lead',mBadge('Current','success')],
        ['Safeguarding · Adults','v5.1','Jan 2026','Jan 2027','Safeguarding Lead',mBadge('Current','success')],
        ['Complaints Handling','v3.4','Apr 2026','Apr 2027','Practice Manager',mBadge('Current','success')],
        ['Health & Safety','v6.2','Oct 2024','<b style="color:#F59E0B">Oct 2025</b>','Practice Manager','<b style="color:#F59E0B">⚠ Review overdue</b>'],
        ['Medical Emergencies','v4.0','Feb 2026','Feb 2027','Clinical Lead',mBadge('Current','success')],
        ['Whistleblowing','v2.6','Jun 2025','Jun 2026','Practice Manager',mBadge('Current','success')],
        ['Equality & Diversity','v2.4','Nov 2025','Nov 2026','Practice Manager',mBadge('Current','success')],
        ['Social Media','v1.8','Dec 2025','Dec 2026','Practice Manager',mBadge('Current','success')]
      ]
    ))}`;
  } else if (tab === 'whistleblowing') {
    panel = `<div style="background:#F0FDFA;border-left:3px solid #0E7C7B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#0F172A"><b>🔒 Confidential:</b> Whistleblowing log accessible only to Practice Manager + Owner. All reports treated anonymously. External hotline available 24/7.</div>
    ${mCard('Whistleblowing Reports · Last 12 months', mTable(
      [{l:'Ref'},{l:'Date'},{l:'Category'},{l:'Action Taken'},{l:'Status'}],
      [
        ['WB-2026-01','Mar 2026','Patient safety concern','Investigated · clinician retrained',mBadge('Closed','success')],
        ['WB-2025-08','Nov 2025','Unfair treatment of staff','HR mediation · resolved',mBadge('Closed','success')],
        ['WB-2025-04','Aug 2025','Suspected fraud','Audit performed · no wrongdoing found',mBadge('Closed','success')]
      ]
    ))}`;
  } else if (tab === 'waste') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('🗑','Clinical Waste (mo)','148kg','','collected weekly')}
      ${mKpi('💉','Sharps (mo)','22 containers','','correct disposal')}
      ${mKpi('🦷','Amalgam Waste','Separator OK','✓','last service Apr 2026')}
      ${mKpi('📋','Consignment Notes','All filed','✓','3yr retention')}
    </div>
    ${mCard('Recent Waste Consignments', mTable(
      [{l:'Date'},{l:'Category'},{l:'Quantity'},{l:'Collected by'},{l:'Consignment Note'}],
      [
        ['Today','Clinical waste','12kg','MedWaste UK','MW-2026-05-24-001'],
        ['Yesterday','Sharps','3 containers','MedWaste UK','MW-2026-05-23-001'],
        ['3 days ago','Amalgam','Separator full','SafetyAmal','SA-2026-05-21-001'],
        ['1 week ago','Clinical waste','14kg','MedWaste UK','MW-2026-05-17-001']
      ]
    ))}`;
  } else if (tab === 'fire') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('🔥','Risk Assessment','Current','✓','last: Mar 2026')}
      ${mKpi('🧯','Extinguishers','8','','serviced annually')}
      ${mKpi('🚨','Alarm Test','Weekly','✓','last: Mon 9am')}
      ${mKpi('🚪','Drill','Annual','Next: Sep 2026','last: Sep 2025')}
    </div>
    ${mCard('Fire Safety Items', mTable(
      [{l:'Item'},{l:'Status'},{l:'Last Check'},{l:'Next'}],
      [
        ['Fire Risk Assessment',mBadge('Current','success'),'Mar 2026','Mar 2027'],
        ['Fire Extinguishers × 8',mBadge('Serviced','success'),'Jan 2026','Jan 2027'],
        ['Smoke Alarms',mBadge('Tested','success'),'Weekly','Ongoing'],
        ['Emergency Lighting',mBadge('Tested','success'),'Jan 2026','Jul 2026'],
        ['Fire Doors',mBadge('Inspected','success'),'Mar 2026','Mar 2027'],
        ['Fire Drill',mBadge('Annual','success'),'Sep 2025','Sep 2026']
      ]
    ))}`;
  } else {
    const chems = [
      {n:'Sodium hypochlorite (3%)','category':'Disinfectant','hazard':'Corrosive','storage':'Locked cupboard','msds':'On file','review':'Apr 2027'},
      {n:'Glutaraldehyde','category':'Cold sterilant','hazard':'Toxic','storage':'Ventilated cupboard','msds':'On file','review':'Apr 2027'},
      {n:'X-ray developer','category':'Photographic','hazard':'Irritant','storage':'Locked cupboard','msds':'On file','review':'Apr 2027'},
      {n:'Mercury (residual amalgam)','category':'Heavy metal','hazard':'Toxic','storage':'Separator only','msds':'On file','review':'Apr 2027'},
      {n:'Latex / nitrile gloves','category':'PPE','hazard':'Allergen','storage':'Standard','msds':'On file','review':'Apr 2027'},
      {n:'Bonding agents (composite)','category':'Resin','hazard':'Sensitiser','storage':'Surgery cabinet','msds':'On file','review':'Apr 2027'}
    ];
    panel = `${mCard('COSHH Register', mTable(
      [{l:'Substance'},{l:'Category'},{l:'Hazard'},{l:'Storage'},{l:'SDS'},{l:'Next Review'}],
      chems.map(c => [
        '<b>'+c.n+'</b>',
        '<span style="font-size:12px;color:#64748B">'+c.category+'</span>',
        mBadge(c.hazard, c.hazard==='Toxic'?'danger':c.hazard==='Corrosive'?'warn':'info'),
        c.storage,
        c.msds,
        c.review
      ])
    ))}`;
  }

  return mPage('Compliance Pro · Regulatory & Clinical Governance','CQC KLOEs · incidents · complaints · IRMER · HTM 01-05 · IG Toolkit · equipment · safeguarding · policies · whistleblowing · waste · fire · COSHH', `${mBtn('⬇ Export audit pack','secondary')}${mBtn('📞 Book mock inspection','primary')}`) + mTabs(tab, tabs, 'cpSetTab') + panel + `</div>`;
};


// ========== HR PRO ==========
window.hpSetTab = function(t) { localStorage.setItem('hp-tab', t); navigate('hr-pro'); };
PAGES['hr-pro'] = () => {
  const tab = localStorage.getItem('hp-tab') || 'bradford';
  const tabs = [
    {k:'bradford', l:'Bradford Factor', i:'📊'},
    {k:'leave', l:'Annual Leave', i:'🏖'},
    {k:'reviews', l:'Performance Reviews', i:'⭐'},
    {k:'discipline', l:'Disciplinary & Grievance', i:'⚖'},
    {k:'rtw', l:'Right to Work', i:'🪪'},
    {k:'recruitment', l:'Recruitment', i:'🎯'},
    {k:'pension', l:'Pension Auto-Enrol', i:'🏦'},
    {k:'salary', l:'Salary Review', i:'💷'},
    {k:'enps', l:'Employee NPS', i:'😊'},
    {k:'exit', l:'Exit Interviews', i:'👋'},
    {k:'training', l:'Training & CPD', i:'🎓'},
    {k:'career', l:'Career Pathways', i:'📈'},
    {k:'flex', l:'Flexible Working', i:'🕐'},
    {k:'parental', l:'Parental Leave', i:'👶'},
    {k:'eap', l:'EAP Usage', i:'💚'}
  ];
  let panel = '';

  if (tab === 'bradford') {
    const staff = [
      {n:'Staff A',s:3,d:8,bf:72,note:'3 short absences (8 days) — Bradford trigger'},
      {n:'Staff B',s:1,d:5,bf:5,note:'Single absence'},
      {n:'Staff C',s:5,d:11,bf:275,note:'<b style=color:#EF4444>⚠ HIGH · meeting required</b>'},
      {n:'Staff D',s:0,d:0,bf:0,note:'No absence'},
      {n:'Staff E',s:2,d:14,bf:56,note:'Short + long-term mix'},
      {n:'Staff F',s:1,d:2,bf:2,note:'Single short absence'},
      {n:'Staff G',s:4,d:6,bf:96,note:'<b style=color:#F59E0B>⚠ Multiple short absences</b>'}
    ];
    panel = `<div style="background:#FEF3C7;border-left:3px solid #F59E0B;padding:14px;border-radius:8px;margin-bottom:14px;font-size:13px;color:#92400E"><b>Bradford Factor = S² × D</b> where S = number of absences, D = total days. Higher scores indicate frequent short-term absence patterns — often more disruptive than single long absences.</div>
    ${mCard('Bradford Factor Tracker · Last 12 months', mTable(
      [{l:'Staff'},{l:'Absences',align:'right'},{l:'Days',align:'right'},{l:'Bradford Score',align:'right'},{l:'Action'}],
      staff.map(s=>[
        '<b>'+s.n+'</b>',
        s.s.toString(),
        s.d.toString(),
        `<b style="color:${s.bf>=200?'#EF4444':s.bf>=50?'#F59E0B':'#10B981'}">${s.bf}</b>`,
        '<span style="font-size:12px;color:#475569">'+s.note+'</span>'
      ])
    ), '<span style="font-size:11.5px;color:#64748B">Common thresholds: 50 = informal chat · 100 = formal review · 200 = disciplinary</span>')}`;
  } else if (tab === 'leave') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('🏖','Group Avg Allowance','28 days','+8 BH','plus bank holidays')}
      ${mKpi('📅','Days Taken YTD','312','','of 504 allowed')}
      ${mKpi('💼','Days Remaining','192','','38% of allowance')}
      ${mKpi('⚠','At Risk of Forfeit','2','','use by 31 Dec')}
    </div>
    ${mCard('Leave Balances · Per Person', mTable(
      [{l:'Staff'},{l:'Allowance',align:'right'},{l:'Taken',align:'right'},{l:'Booked',align:'right'},{l:'Remaining',align:'right'},{l:'Risk'}],
      [
        ['Staff A','28','12','5','11',mBadge('OK','success')],
        ['Staff B','28','8','3','17',mBadge('Plan more','warn')],
        ['Staff C','28','22','4','2',mBadge('Healthy','success')],
        ['Staff D','28','4','0','24','<b style="color:#EF4444">⚠ Forfeit risk</b>'],
        ['Staff E','28','15','8','5',mBadge('OK','success')],
        ['Staff F','28','3','2','23','<b style="color:#EF4444">⚠ Forfeit risk</b>'],
        ['Staff G','28','18','5','5',mBadge('OK','success')]
      ]
    ))}`;
  } else if (tab === 'reviews') {
    panel = `${mCard('Performance Review Cycle', mTable(
      [{l:'Staff'},{l:'Probation'},{l:'1:1 Last'},{l:'Mid-Year'},{l:'Annual Review'},{l:'Next Due'}],
      [
        ['Staff A','✓ Passed','2 weeks ago','Done · Jun 2026','Due Dec 2026','1:1 in 2wks'],
        ['Staff B','✓ Passed','3 weeks ago','Done · Jun 2026','Due Dec 2026','1:1 in 1wk'],
        ['Staff C','In probation · 4mo','Last week','—','—','Final probation review in 2mo'],
        ['Staff D','✓ Passed','5 weeks ago','<b style="color:#F59E0B">⚠ Overdue</b>','Due Dec 2026','Reschedule mid-year urgently'],
        ['Staff E','✓ Passed','1 week ago','Done · Jun 2026','Due Dec 2026','On track']
      ]
    ))}`;
  } else if (tab === 'discipline') {
    panel = `${mCard('Disciplinary & Grievance Log', mTable(
      [{l:'Ref'},{l:'Date'},{l:'Type'},{l:'Stage'},{l:'Outcome'},{l:'Status'}],
      [
        ['DG-2026-01','Mar 2026','Grievance · Workplace conduct','Mediation','Resolved at mediation',mBadge('Closed','success')],
        ['DG-2026-02','Apr 2026','Disciplinary · Persistent lateness','Verbal warning','Improvement plan agreed',mBadge('Monitoring','warn')],
        ['DG-2026-03','May 2026','Grievance · Workload','Stage 1 meeting','Investigation ongoing',mBadge('Open','warn')]
      ]
    ))}`;
  } else if (tab === 'rtw') {
    panel = `<div style="background:#FEE2E2;border:1px solid #EF4444;border-radius:10px;padding:14px;margin-bottom:14px;font-size:13px;color:#991B1B"><b>⚠ Legal requirement:</b> All employees must have valid right-to-work documentation. Penalties up to £20,000 per employee found without RTW.</div>
    ${mCard('Right to Work · All Staff', mTable(
      [{l:'Staff'},{l:'Status'},{l:'Document'},{l:'Expires'},{l:'Next Check'}],
      [
        ['Staff A','UK Citizen','Passport','—','—'],
        ['Staff B','UK Citizen','Passport','—','—'],
        ['Staff C','Skilled Worker Visa','BRP','Mar 2027','Sep 2026'],
        ['Staff D','Settled Status','Share Code','—','Annual'],
        ['Staff E','UK Citizen','Passport','—','—'],
        ['Staff F','Skilled Worker Visa','BRP','<b style="color:#F59E0B">Aug 2026</b>','<b style="color:#F59E0B">⚠ Renewal soon</b>'],
        ['Staff G','UK Citizen','Passport','—','—']
      ]
    ))}`;
  } else if (tab === 'recruitment') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('💼','Open Roles','2','','live recruitment')}
      ${mKpi('📥','Applications','42','','this month')}
      ${mKpi('⏱','Time to Hire','38 days','-12','target: 45')}
      ${mKpi('💷','Cost per Hire','£1,840','-£400','target: £2,500')}
    </div>
    ${mCard('Open Roles', mTable(
      [{l:'Role'},{l:'Site'},{l:'Applicants',align:'right'},{l:'Stage'},{l:'Days Open',align:'right'},{l:'Status'}],
      [
        ['Hygienist','Edenford','12','Interview round 2','21',mBadge('Progressing','info')],
        ['Dental Nurse','Westfield','18','Shortlisting','8',mBadge('Active','success')]
      ]
    ))}`;
  } else if (tab === 'pension') {
    panel = `${mCard('Auto-Enrolment Status · All Staff', mTable(
      [{l:'Staff'},{l:'Eligible'},{l:'Enrolled'},{l:'Employee %',align:'right'},{l:'Employer %',align:'right'},{l:'Provider'}],
      [
        ['Staff A','✓','✓','5%','3%','NEST'],
        ['Staff B','✓','✓','5%','3%','NEST'],
        ['Staff C','✓','✓','5%','3%','NEST'],
        ['Staff D','✓','✓','8% (additional)','3%','NEST'],
        ['Staff E','✓','✓','5%','3%','NEST'],
        ['Staff F','✓','Opt-out · re-enrol Apr 2027','—','—','—'],
        ['Staff G','✓','✓','5%','3%','NEST']
      ]
    ))}`;
  } else if (tab === 'salary') {
    panel = `${mCard('Salary Review · Annual Cycle', mTable(
      [{l:'Staff'},{l:'Role'},{l:'Current £',align:'right'},{l:'Market Median',align:'right'},{l:'Gap'},{l:'Last Review'}],
      [
        ['Staff A','Dental Nurse','£26,500','£27,000','-2%','Jan 2026'],
        ['Staff B','Hygienist','£42,000','£40,500','+4%','Jan 2026'],
        ['Staff C','Receptionist','£24,000','£23,500','+2%','Jan 2026'],
        ['Staff D','Practice Manager','£48,000','£52,000','<b style="color:#EF4444">-8%</b>','Jan 2026'],
        ['Staff E','Treatment Coord.','£32,000','£30,000','+7%','Jan 2026']
      ]
    ))}`;
  } else if (tab === 'enps') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('😊','eNPS','+42','+8','industry: +20')}
      ${mKpi('📊','Survey Response','89%','','last quarter')}
      ${mKpi('💚','Promoters','58%','','9-10 score')}
      ${mKpi('⚠','Detractors','16%','-4%','improving')}
    </div>
    ${mCard('Theme Analysis · Anonymous Comments', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div>
        <h4 style="font-size:13px;font-weight:700;color:#065F46;margin:0 0 10px">💚 What works</h4>
        <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#475569;line-height:1.7">
          <li>Team culture and support</li>
          <li>CPD and training opportunities</li>
          <li>Modern equipment</li>
          <li>Owner approachable</li>
        </ul>
      </div>
      <div>
        <h4 style="font-size:13px;font-weight:700;color:#991B1B;margin:0 0 10px">⚠ Pain points</h4>
        <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#475569;line-height:1.7">
          <li>Workload during busy periods</li>
          <li>Want clearer career paths</li>
          <li>Pay below market for 2 roles</li>
          <li>Communication between sites can lag</li>
        </ul>
      </div>
    </div>`)}`;
  } else if (tab === 'exit') {
    panel = `${mCard('Exit Interview Themes · Last 12 months · 4 leavers', `<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
      ${[
        ['Career progression elsewhere',2,'#F59E0B'],
        ['Relocation (personal)',1,'#3B82F6'],
        ['Higher salary offered',2,'#EF4444'],
        ['Better work-life balance sought',1,'#F59E0B'],
        ['Career change (out of dentistry)',1,'#94A3B8']
      ].map(([l,c,clr])=>`<div style="display:flex;justify-content:space-between;padding:10px;background:#F8FAFC;border-radius:7px"><span>${l}</span><b style="color:${clr}">${c} mentions</b></div>`).join('')}
    </div>`)}
    <div style="margin-top:14px;background:#FEF3C7;border-left:3px solid #F59E0B;padding:14px;border-radius:8px;font-size:13px;color:#92400E"><b>🎯 Action:</b> "Higher salary offered" appearing 2× this year. Cross-reference with Salary Review tab — Practice Manager is 8% below market.</div>`;
  } else if (tab === 'training') {
    panel = `${mCard('Training & CPD Records', mTable(
      [{l:'Staff'},{l:'Role'},{l:'CPD Hours YTD',align:'right'},{l:'Target',align:'right'},{l:'Mandatory Done',align:'right'},{l:'Status'}],
      [
        ['Staff A','Dental Nurse','15','15 (GDC)','12/12','<b style="color:#10B981">Up to date</b>'],
        ['Staff B','Hygienist','18','15 (GDC)','12/12','<b style="color:#10B981">Up to date</b>'],
        ['Staff C','Receptionist','8','—','10/12','<b style="color:#F59E0B">⚠ 2 mandatory pending</b>'],
        ['Staff D','Practice Manager','22','—','12/12','<b style="color:#10B981">Up to date</b>'],
        ['Staff E','TCO','12','—','11/12','<b style="color:#F59E0B">⚠ 1 mandatory pending</b>']
      ]
    ))}`;
  } else if (tab === 'career') {
    panel = `${mCard('Career Progression Pathway', `<div style="display:flex;flex-direction:column;gap:16px;font-size:13px;color:#475569;line-height:1.5">
      <div style="padding:14px;background:#F8FAFC;border-radius:10px;border-left:4px solid #3B82F6">
        <b style="color:#0F172A">Dental Nurse pathway</b><br>
        Trainee → Qualified DN → Senior DN → Treatment Coordinator → Practice Manager · est. 3-7 years
      </div>
      <div style="padding:14px;background:#F8FAFC;border-radius:10px;border-left:4px solid #10B981">
        <b style="color:#0F172A">Hygienist pathway</b><br>
        Hygienist → Senior Hygienist · Specialist Periodontal Care → Hygienist Lead → Clinical Director · est. 5-10 years
      </div>
      <div style="padding:14px;background:#F8FAFC;border-radius:10px;border-left:4px solid #8B5CF6">
        <b style="color:#0F172A">Reception → Management</b><br>
        Receptionist → Senior Receptionist → Reception Lead → Practice Manager → Operations Manager · est. 4-8 years
      </div>
      <div style="padding:14px;background:#F8FAFC;border-radius:10px;border-left:4px solid #F59E0B">
        <b style="color:#0F172A">Clinician → Equity</b><br>
        Associate → Senior Associate → Principal → Equity Partner / Acquisition · est. 7-15 years
      </div>
    </div>`)}`;
  } else if (tab === 'flex') {
    panel = `${mCard('Flexible Working Requests', mTable(
      [{l:'Date Requested'},{l:'Staff'},{l:'Type'},{l:'Outcome'},{l:'Status'}],
      [
        ['Jan 2026','Staff B','Compressed hours (4×10)','Approved · trial 3mo',mBadge('Implemented','success')],
        ['Mar 2026','Staff E','Term-time only','Approved with conditions',mBadge('Implemented','success')],
        ['Apr 2026','Staff D','Part-time return (postnatal)','Approved',mBadge('Implemented','success')],
        ['May 2026','Staff G','Remote 1 day/wk','Declined · client-facing role',mBadge('Closed','neutral')]
      ]
    ))}`;
  } else if (tab === 'parental') {
    panel = `${mCard('Active Parental Leave', mTable(
      [{l:'Staff'},{l:'Type'},{l:'Start Date'},{l:'Return Date'},{l:'Cover'},{l:'KIT Days Used',align:'right'}],
      [
        ['Staff D','Maternity','Sep 2025','Sep 2026 (planned)','Locum hygienist','3 / 10'],
        ['Staff H','Paternity (2wk)','Mar 2026','Apr 2026 ✓','None needed','—']
      ]
    ))}`;
  } else {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${mKpi('💚','EAP Provider','Lifeworks','','24/7 helpline')}
      ${mKpi('📞','Usage (12mo)','12','','anonymous aggregate')}
      ${mKpi('💷','Cost / Staff','£28/yr','','well-being investment')}
      ${mKpi('📊','Themes','Stress & finance','','top categories')}
    </div>
    ${mCard('EAP Anonymous Usage Themes', `<div style="font-size:13px;color:#475569;line-height:1.7">
      <b>Categories accessed (anonymised aggregate):</b><br>
      • Stress / workload — 4 sessions<br>
      • Financial wellbeing advice — 3 sessions<br>
      • Family / relationship — 2 sessions<br>
      • Mental health support — 2 sessions<br>
      • Legal advice — 1 session<br><br>
      <b style="color:#0F172A">Action:</b> Promote EAP more widely · current awareness ~60% per eNPS survey. Add reminder to monthly all-hands.
    </div>`)}`;
  }

  return mPage('HR Pro · People Management','Bradford Factor · leave · reviews · disciplinary · RTW · recruitment · pension · salary · eNPS · exit · training · career · flex · parental · EAP', `${mBtn('⬇ Export HR pack','secondary')}${mBtn('+ Add staff','primary')}`) + mTabs(tab, tabs, 'hpSetTab') + panel + `</div>`;
};
