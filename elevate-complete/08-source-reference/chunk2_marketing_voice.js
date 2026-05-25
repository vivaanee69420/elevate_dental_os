
/* MARKETING CONTROL ROOM */
PAGES['marketing-control']=()=>`
<div class="topbar"><div class="page-title-row"><h1>Marketing Control Room</h1><p>Multi-channel command for all 4 entities. Live spend, ROAS, lead-to-booking by source. Run rate · forecast · pacing alerts.</p></div></div>
<div class="grid g4" style="margin-bottom:14px">${kpi('Spend MTD','£14,820',{txt:'pacing -8% on £18k budget',dir:'down'},'warn')}${kpi('Leads MTD','187',{txt:'+12% MoM',dir:'up'},'good')}${kpi('CPL blended','£79.25',{txt:'-£12 MoM',dir:'down'},'good')}${kpi('Marketing-driven revenue','£82,400',{txt:'5.6× ROAS',dir:'up'},'good')}</div>
<div class="card"><h3>Channel performance · MTD</h3>
<table class="mt12"><thead><tr><th>Channel</th><th class="num">Spend</th><th class="num">Impr.</th><th class="num">Clicks</th><th class="num">CTR</th><th class="num">Leads</th><th class="num">CPL</th><th class="num">Bookings</th><th class="num">£/booking</th><th class="num">Revenue</th><th class="num">ROAS</th></tr></thead><tbody>
<tr><td><b>Meta · GM Group</b></td><td class="num">£4,820</td><td class="num">284,200</td><td class="num">3,140</td><td class="num">1.10%</td><td class="num">68</td><td class="num">£70.88</td><td class="num">22</td><td class="num">£219</td><td class="num pos">£32,400</td><td class="num pos">6.7×</td></tr>
<tr><td><b>Meta · Plan4Growth</b></td><td class="num">£3,200</td><td class="num">142,800</td><td class="num">1,820</td><td class="num">1.27%</td><td class="num">42</td><td class="num">£76.19</td><td class="num">14</td><td class="num">£229</td><td class="num pos">£18,200</td><td class="num pos">5.7×</td></tr>
<tr><td><b>Google Search · GM</b></td><td class="num">£2,400</td><td class="num">42,800</td><td class="num">1,420</td><td class="num">3.32%</td><td class="num">34</td><td class="num">£70.59</td><td class="num">18</td><td class="num">£133</td><td class="num pos">£14,800</td><td class="num pos">6.2×</td></tr>
<tr><td><b>Google · Biological</b></td><td class="num">£1,800</td><td class="num">28,400</td><td class="num">820</td><td class="num">2.89%</td><td class="num">18</td><td class="num">£100</td><td class="num">6</td><td class="num">£300</td><td class="num pos">£8,400</td><td class="num pos">4.7×</td></tr>
<tr><td><b>Google · Elevate Accts</b></td><td class="num">£1,200</td><td class="num">12,800</td><td class="num">340</td><td class="num">2.66%</td><td class="num">11</td><td class="num">£109</td><td class="num">4</td><td class="num">£300</td><td class="num pos">£3,200</td><td class="num warn">2.7×</td></tr>
<tr><td><b>Instagram organic (Sona)</b></td><td class="num">£0</td><td class="num">98,200</td><td class="num">2,840</td><td class="num">2.89%</td><td class="num">14</td><td class="num">£0</td><td class="num">5</td><td class="num">£0</td><td class="num pos">£5,400</td><td class="num pos">∞</td></tr>
</tbody></table></div>
<div class="grid g2 mt16"><div class="card"><h3>Top performing ads · MTD</h3>
<table class="mt12"><thead><tr><th>Ad</th><th class="num">Spend</th><th class="num">Leads</th><th class="num">CPL</th></tr></thead><tbody>
<tr><td>Implant transformation · Carousel V3</td><td class="num">£1,420</td><td class="num">24</td><td class="num pos">£59</td></tr>
<tr><td>P4G Academy · Free Masterclass</td><td class="num">£1,820</td><td class="num">28</td><td class="num pos">£65</td></tr>
<tr><td>Bonding before/after · UGC v2</td><td class="num">£980</td><td class="num">14</td><td class="num pos">£70</td></tr>
<tr><td>All-on-4 testimonial reel</td><td class="num">£1,200</td><td class="num">16</td><td class="num">£75</td></tr></tbody></table></div>
<div class="card"><h3>Lead-to-revenue funnel · MTD</h3>
<table class="mt12"><tr><td>Total leads</td><td class="num">187</td><td class="muted">100%</td></tr>
<tr><td>Contacted within 5 min</td><td class="num">142</td><td class="muted">76%</td></tr>
<tr><td>Consult booked</td><td class="num">94</td><td class="muted pos">50%</td></tr>
<tr><td>Consult attended</td><td class="num">68</td><td class="muted">72% show</td></tr>
<tr><td>Treatment plan accepted</td><td class="num">42</td><td class="muted pos">62% conv.</td></tr>
<tr style="font-weight:600;border-top:1px solid var(--line)"><td>Revenue booked</td><td class="num">£82,400</td><td class="muted">£1,962/sale</td></tr></table></div></div>
<div class="card mt16"><h3>Pacing alerts</h3>
<table class="mt12"><thead><tr><th>Alert</th><th>Channel</th><th>Threshold</th><th>Status</th><th>Action</th></tr></thead><tbody>
<tr><td>Spend pacing 8% behind budget</td><td>Meta · GM Group</td><td>±10%</td><td><span class="pill warn">Within tolerance</span></td><td>Monitor</td></tr>
<tr><td>CPL above target</td><td>Google · Biological</td><td>£100</td><td><span class="pill warn">At target</span></td><td>Negative keyword sweep · Nikhil</td></tr>
<tr><td>ROAS below 4×</td><td>Google · Elevate Accts</td><td>4× min</td><td><span class="pill neg">2.7× — below</span></td><td>Pause, rebuild creative</td></tr>
<tr><td>Lead response time &gt;5min</td><td>All channels</td><td>5 min</td><td><span class="pill warn">7.2 min avg</span></td><td>Voice AI deflection 6-8pm gap</td></tr>
</tbody></table></div>`;

/* VOICE AI · CRM */
PAGES['crm-calls']=()=>`
<div class="topbar"><div class="page-title-row"><h1>Voice AI · Call Centre</h1><p>Vapi-powered AI agent handles after-hours lead qualification, missed call follow-up, recall reactivation. Transcripts · sentiment · handoff routing.</p></div></div>
<div class="grid g4" style="margin-bottom:14px">${kpi('AI calls handled · MTD',428,{txt:'+18% vs Apr',dir:'up'},'good')}${kpi('Avg duration','3m 24s',null)}${kpi('Booking conversion','22.4%',{txt:'human baseline 28%',dir:'flat'},'warn')}${kpi('Cost / call','£0.42',{txt:'vs £4.20 human',dir:'down'},'good')}</div>
<div class="grid g2"><div class="card"><h3>AI agent configuration</h3>
<table class="mt12"><tr><td>Voice model</td><td>11Labs · Sarah (warm professional female)</td></tr>
<tr><td>LLM backend</td><td>GPT-4o (low temp, scripted handoff)</td></tr>
<tr><td>Inbound number</td><td>+44 1843 555 0188 (Vapi routed)</td></tr>
<tr><td>Active hours</td><td>24/7 (primary 6pm-9am + lunch)</td></tr>
<tr><td>Handoff trigger</td><td>"Speak to human", complaint keywords, complex clinical Qs</td></tr>
<tr><td>Booking integration</td><td>GHL calendar API · checks availability live</td></tr>
<tr><td>Recording + transcript</td><td>Stored 90 days, sent to Sona for QA</td></tr>
<tr><td>Languages</td><td>English (UK), Polish, Romanian</td></tr></table>
<button class="btn btn-primary mt12">Edit script prompts →</button></div>
<div class="card"><h3>Use cases enabled</h3>
<table class="mt12"><tr><td>✓ After-hours inbound enquiry</td><td><span class="pill pos">Live</span></td></tr>
<tr><td>✓ Missed call callback (within 90 sec)</td><td><span class="pill pos">Live</span></td></tr>
<tr><td>✓ Lead form follow-up (Meta / Google Ads)</td><td><span class="pill pos">Live</span></td></tr>
<tr><td>✓ Recall reactivation (6-12mo lapsed)</td><td><span class="pill pos">Live</span></td></tr>
<tr><td>✓ Treatment plan follow-up</td><td><span class="pill warn">Testing</span></td></tr>
<tr><td>✓ Review request post-treatment</td><td><span class="pill warn">Testing</span></td></tr>
<tr><td>○ Appointment reminders (3-day, 1-day)</td><td><span class="pill muted">Q3 roadmap</span></td></tr>
<tr><td>○ Payment chasing AR &gt;30d</td><td><span class="pill muted">Q4 roadmap</span></td></tr></table></div></div>
<div class="card mt16"><h3>Recent calls · last 24h</h3>
<table class="mt12"><thead><tr><th>Time</th><th>Caller</th><th>Direction</th><th>Duration</th><th>Outcome</th><th>Sentiment</th><th>Next step</th></tr></thead><tbody>
<tr><td>06:42</td><td>+44 7842 *** 218</td><td>Inbound</td><td>4m 12s</td><td>Consult booked · Implant · Warwick · 28 May 14:00</td><td><span class="pill pos">Positive</span></td><td>Confirmation SMS sent</td></tr>
<tr><td>21:18</td><td>+44 7912 *** 042</td><td>Inbound</td><td>3m 08s</td><td>Quote request · All-on-4 · pricing emailed</td><td><span class="pill pos">Positive</span></td><td>Nadia follow-up AM</td></tr>
<tr><td>19:54</td><td>+44 7714 *** 821</td><td>Outbound (missed call f/u)</td><td>2m 45s</td><td>Booked hygiene · Rochester · 02 Jun</td><td><span class="pill pos">Positive</span></td><td>Recall added</td></tr>
<tr><td>18:32</td><td>+44 7884 *** 415</td><td>Inbound</td><td>1m 22s</td><td>Complaint escalation → handed to human</td><td><span class="pill neg">Negative</span></td><td>Sona callback 9am</td></tr>
<tr><td>13:14</td><td>+44 7621 *** 387</td><td>Outbound (lead form)</td><td>5m 41s</td><td>Composite bonding · Q3 budget · nurture seq added</td><td><span class="pill info">Neutral</span></td><td>5-day email sequence</td></tr>
</tbody></table></div>
<div class="grid g2 mt16"><div class="card"><h3>Top intents detected (30d)</h3>
<table class="mt12"><tr><td>Implant enquiry</td><td class="num">128</td><td class="num pos">30%</td></tr>
<tr><td>Hygiene / check-up booking</td><td class="num">86</td><td class="num">20%</td></tr>
<tr><td>Composite bonding</td><td class="num">62</td><td class="num">14%</td></tr>
<tr><td>Invisalign / ortho</td><td class="num">48</td><td class="num">11%</td></tr>
<tr><td>Emergency / urgent pain</td><td class="num">42</td><td class="num">10%</td></tr>
<tr><td>Pricing-only enquiry</td><td class="num">38</td><td class="num">9%</td></tr>
<tr><td>Cancellation / reschedule</td><td class="num">24</td><td class="num">6%</td></tr></table></div>
<div class="card"><h3>Sona's QA review queue</h3>
<table class="mt12"><tr><td>Calls flagged for review</td><td class="num">18</td></tr>
<tr><td>Hallucinations (AI made up info)</td><td class="num">2</td></tr>
<tr><td>Pricing errors</td><td class="num">0</td></tr>
<tr><td>Tone issues (too robotic)</td><td class="num">4</td></tr>
<tr><td>Missed booking opportunities</td><td class="num">6</td></tr>
<tr><td>Excellent calls (training examples)</td><td class="num">12</td></tr></table>
<button class="btn btn-primary mt12">Open review queue →</button></div></div>`;
