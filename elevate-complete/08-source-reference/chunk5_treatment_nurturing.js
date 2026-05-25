
/* TREATMENT ENQUIRIES — TC plan enquiries */
PAGES['treatment-enquiries']=()=>`
<div class="topbar"><div class="page-title-row"><h1>Treatment Enquiries</h1><p>TCO-managed treatment plan enquiries. Patients who have had a consultation, received a plan, and are deciding. Pending · accepted · declined.</p></div></div>
<div class="grid g4" style="margin-bottom:14px">${kpi('Open treatment enquiries',86,{txt:'£284k pipeline',dir:'flat'},'warn')}${kpi('Avg decision time','12 days',{txt:'target <14d',dir:'down'},'good')}${kpi('Plan-to-acceptance rate','62%',{txt:'+4pp QoQ',dir:'up'},'good')}${kpi('Avg case value','£3,302',null)}</div>
<div class="card"><h3>Open enquiries · awaiting decision</h3>
<table class="mt12"><thead><tr><th>Patient</th><th>Practice</th><th>Treatment plan</th><th class="num">Value</th><th>Plan presented</th><th class="num">Days waiting</th><th>Status</th><th>Next step</th></tr></thead><tbody>
<tr><td>S. Patel</td><td>Warwick Lodge</td><td>All-on-4 (upper)</td><td class="num">£14,800</td><td>22 May 2026</td><td class="num">2</td><td><span class="pill info">Considering</span></td><td>Day 4 follow-up call · Nadia</td></tr>
<tr><td>J. Wilson</td><td>Ashford</td><td>6 veneers + whitening</td><td class="num">£4,820</td><td>20 May 2026</td><td class="num">4</td><td><span class="pill info">Considering</span></td><td>Finance options email · Sona</td></tr>
<tr><td>M. Chen</td><td>Rochester</td><td>3 implants + bridge</td><td class="num">£8,400</td><td>18 May 2026</td><td class="num">6</td><td><span class="pill warn">Reminder due</span></td><td>WhatsApp check-in</td></tr>
<tr><td>L. Brown</td><td>Barnet</td><td>Invisalign + bonding</td><td class="num">£5,200</td><td>15 May 2026</td><td class="num">9</td><td><span class="pill warn">Following up</span></td><td>Phone call · Sona</td></tr>
<tr><td>A. Kumar</td><td>Bexleyheath</td><td>Full mouth rehab</td><td class="num">£28,400</td><td>14 May 2026</td><td class="num">10</td><td><span class="pill warn">High value · escalate</span></td><td>Gaurav personal call</td></tr>
<tr><td>R. Thompson</td><td>Warwick Lodge</td><td>2 implants + crowns</td><td class="num">£6,800</td><td>12 May 2026</td><td class="num">12</td><td><span class="pill neg">Stale · likely lost</span></td><td>Final WhatsApp + close out</td></tr>
</tbody></table>
<div class="hint info mt12"><b>Pipeline at risk:</b> 6 enquiries open &gt; 7 days = £67,620. TCO follow-up cadence: Day 2 SMS, Day 5 call, Day 10 finance options, Day 14 final touchpoint then close.</div></div>
<div class="grid g2 mt16"><div class="card"><h3>Conversion by treatment · YTD</h3>
<table class="mt12"><thead><tr><th>Treatment type</th><th class="num">Plans presented</th><th class="num">Accepted</th><th class="num">Rate</th><th class="num">Avg value</th></tr></thead><tbody>
<tr><td>Hygiene + check-up</td><td class="num">86</td><td class="num">82</td><td class="num pos">95%</td><td class="num">£85</td></tr>
<tr><td>Single implant</td><td class="num">218</td><td class="num">142</td><td class="num pos">65%</td><td class="num">£2,950</td></tr>
<tr><td>Composite bonding</td><td class="num">142</td><td class="num">98</td><td class="num pos">69%</td><td class="num">£2,800</td></tr>
<tr><td>Veneers (4-8 unit)</td><td class="num">98</td><td class="num">58</td><td class="num">59%</td><td class="num">£4,200</td></tr>
<tr><td>Invisalign</td><td class="num">84</td><td class="num">52</td><td class="num">62%</td><td class="num">£3,800</td></tr>
<tr><td>All-on-4</td><td class="num">42</td><td class="num">22</td><td class="num warn">52%</td><td class="num">£14,800</td></tr>
<tr><td>Full mouth rehab (£10k+)</td><td class="num">28</td><td class="num">12</td><td class="num warn">43%</td><td class="num">£18,200</td></tr>
</tbody></table>
<div class="hint warn mt8 small">High-value cases (£10k+) convert at 43-52% — biggest opportunity. TCO coaching focus on big-case objection handling.</div></div>
<div class="card"><h3>Reasons for decline · last 30 days</h3>
<table class="mt12"><tr><td>Cost / can't afford</td><td class="num">14</td><td class="num warn">42%</td></tr>
<tr><td>Wants to think about it (lost)</td><td class="num">8</td><td class="num">24%</td></tr>
<tr><td>Getting second opinion</td><td class="num">5</td><td class="num">15%</td></tr>
<tr><td>Spouse / family not on board</td><td class="num">3</td><td class="num">9%</td></tr>
<tr><td>Timing — life circumstances</td><td class="num">2</td><td class="num">6%</td></tr>
<tr><td>Not happy with consult experience</td><td class="num">1</td><td class="num neg">3%</td></tr></table>
<div class="hint info mt12 small"><b>Top fix:</b> 42% cost objection — PCP finance promotion + 0% finance highlighted at consult would recover 6-8 cases / month.</div></div></div>`;

/* NURTURING AUTOMATIONS — trigger-based, distinct from sequences */
PAGES['nurturing-auto']=()=>`
<div class="topbar"><div class="page-title-row"><h1>Nurturing Automations</h1><p>Trigger-based automations that fire when patient actions happen. Sequences are the content; automations are the rules that decide when content fires.</p></div></div>
<div class="grid g4" style="margin-bottom:14px">${kpi('Active automations',18,{txt:'all 4 entities',dir:'flat'})}${kpi('Triggers fired today',428,null)}${kpi('Active in nurture',1842,{txt:'current pipeline',dir:'flat'})}${kpi('Avg conversion uplift','+34%',{txt:'vs no nurture',dir:'up'},'good')}</div>
<div class="card"><h3>Live automations</h3>
<table class="mt12"><thead><tr><th>Automation</th><th>Trigger</th><th>Sequence</th><th class="num">Active</th><th class="num">Fired (30d)</th><th class="num">Conv.</th><th>Status</th></tr></thead><tbody>
<tr><td><b>New lead nurture</b></td><td>Lead created (any source)</td><td>5-day Welcome + Value</td><td class="num">142</td><td class="num">412</td><td class="num pos">38%</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Consult booked confirmation</b></td><td>Consult appointment created</td><td>Confirm + reminder + prep</td><td class="num">182</td><td class="num">194</td><td class="num pos">92% show</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Consult attended follow-up</b></td><td>Consult attended (no plan yet)</td><td>3-touch decision support</td><td class="num">68</td><td class="num">82</td><td class="num pos">28%</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Treatment plan presented</b></td><td>TP created in Dentally</td><td>14-day TCO cadence (Day 2, 5, 10, 14)</td><td class="num">86</td><td class="num">128</td><td class="num pos">62%</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>No-show recovery</b></td><td>Appointment missed</td><td>Sorry-we-missed + rebook</td><td class="num">14</td><td class="num">42</td><td class="num">35%</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Hygiene recall · 6-month</b></td><td>Last hygiene = 6 months</td><td>3-touch recall</td><td class="num">428</td><td class="num">182</td><td class="num pos">52%</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Hygiene recall · 12-month (lapsed)</b></td><td>Last hygiene = 12 months</td><td>Reactivation offer</td><td class="num">214</td><td class="num">86</td><td class="num">22%</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Birthday touch</b></td><td>Patient birthday</td><td>Birthday WA + Smile Club offer</td><td class="num">N/A</td><td class="num">42</td><td class="num">14% upsell</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Treatment complete · review</b></td><td>Treatment status = complete</td><td>Gated review request</td><td class="num">N/A</td><td class="num">82</td><td class="num pos">54%</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Implant phase 1 → phase 2</b></td><td>Implant placed (awaiting integration)</td><td>4-month healing journey content</td><td class="num">42</td><td class="num">12</td><td class="num pos">88% return</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Membership renewal</b></td><td>DD failed or cancellation</td><td>Win-back 3-touch</td><td class="num">8</td><td class="num">18</td><td class="num pos">62%</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Cold lead reactivation</b></td><td>No contact &gt; 90 days</td><td>Q-bump campaign</td><td class="num">412</td><td class="num">42</td><td class="num">8%</td><td><span class="pill warn">Slow</span></td></tr>
<tr><td><b>Academy enrolment nurture (P4G)</b></td><td>Masterclass attended</td><td>5-touch academy enrolment</td><td class="num">128</td><td class="num">86</td><td class="num pos">12%</td><td><span class="pill pos">Active</span></td></tr>
<tr><td><b>Elevate Accounts trial nurture</b></td><td>Free trial signup</td><td>14-day onboarding sequence</td><td class="num">42</td><td class="num">18</td><td class="num warn">22%</td><td><span class="pill warn">Pre-launch</span></td></tr>
</tbody></table></div>
<div class="card mt16"><h3>Trigger types available</h3>
<div class="grid g3">
<div><b>Patient triggers</b><br><span class="muted small">Lead created · Booking confirmed · Consult attended · TP presented · TP accepted · Treatment complete · Payment received · Cancellation · No-show · Recall due</span></div>
<div><b>Time triggers</b><br><span class="muted small">Date reached · Days since action · Birthday · Membership anniversary · Treatment anniversary · X days inactive</span></div>
<div><b>Behaviour triggers</b><br><span class="muted small">Email opened · Link clicked · Form submitted · Page visited · SMS replied · WA message · Review left · Payment failed</span></div>
</div>
<button class="btn btn-primary mt12">+ Build new automation →</button></div>`;
