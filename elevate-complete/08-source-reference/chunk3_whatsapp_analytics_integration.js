
/* WHATSAPP BUSINESS */
PAGES['crm-whatsapp']=()=>`
<div class="topbar"><div class="page-title-row"><h1>WhatsApp Business</h1><p>WhatsApp Business API hub. Conversation inbox · template library · broadcast lists · automation triggers.</p></div></div>
<div class="grid g4" style="margin-bottom:14px">${kpi('Active conversations',142,{txt:'+24 today',dir:'up'},'good')}${kpi('Avg response time','8 min',{txt:'target <15 min',dir:'down'},'good')}${kpi('Templates approved',24,null)}${kpi('Opt-in patients',4820,{txt:'+182 MoM',dir:'up'},'good')}</div>
<div class="grid g2"><div class="card"><h3>Connection status</h3>
<table class="mt12"><tr><td>Business account</td><td>GM Dental Group Ltd</td></tr>
<tr><td>Display name</td><td>GM Dental Group</td></tr>
<tr><td>Phone number</td><td>+44 1843 555 0142 (verified)</td></tr>
<tr><td>WABA quality rating</td><td><span class="pill pos">High</span></td></tr>
<tr><td>Messaging tier</td><td>Tier 2 (10,000 unique recipients / 24h)</td></tr>
<tr><td>API provider</td><td>360dialog (via GoHighLevel)</td></tr>
<tr><td>Daily usage</td><td>482 / 10,000 messages</td></tr>
<tr><td>Profile photo + about</td><td><span class="pill pos">Set</span></td></tr></table></div>
<div class="card"><h3>Template categories</h3>
<table class="mt12"><tr><td>Marketing</td><td class="num">8</td><td><span class="pill pos">Approved</span></td></tr>
<tr><td>Utility (appointments, reminders, OTP)</td><td class="num">12</td><td><span class="pill pos">Approved</span></td></tr>
<tr><td>Authentication</td><td class="num">2</td><td><span class="pill pos">Approved</span></td></tr>
<tr><td>Pending Meta approval</td><td class="num">3</td><td><span class="pill warn">Review</span></td></tr>
<tr><td>Rejected (rework needed)</td><td class="num">1</td><td><span class="pill neg">Action</span></td></tr></table>
<button class="btn btn-primary mt12">+ Submit new template</button></div></div>
<div class="card mt16"><h3>Recent conversations</h3>
<table class="mt12"><thead><tr><th>Patient</th><th>Last message</th><th>Status</th><th class="num">Unread</th><th>Practice</th><th>Action</th></tr></thead><tbody>
<tr><td>Maria K. · +44 7842 *** 218</td><td>"Can I move my appointment to next Thursday?"</td><td><span class="pill warn">Awaiting reply</span></td><td class="num">2</td><td>Warwick</td><td><button class="btn btn-sm">Reply</button></td></tr>
<tr><td>James W. · +44 7912 *** 042</td><td>"Yes please book me in for the consultation"</td><td><span class="pill pos">Booked</span></td><td class="num">0</td><td>Ashford</td><td><button class="btn btn-sm">View</button></td></tr>
<tr><td>Sarah L. · +44 7714 *** 821</td><td>"Thank you, see you tomorrow!"</td><td><span class="pill pos">Closed</span></td><td class="num">0</td><td>Rochester</td><td><button class="btn btn-sm">View</button></td></tr>
<tr><td>Daniel R. · +44 7884 *** 415</td><td>"What time does the hygienist start tomorrow?"</td><td><span class="pill warn">Awaiting reply</span></td><td class="num">1</td><td>Barnet</td><td><button class="btn btn-sm">Reply</button></td></tr>
<tr><td>Emma T. · +44 7621 *** 387</td><td>"How much does All-on-4 cost?"</td><td><span class="pill info">Sequence active</span></td><td class="num">0</td><td>Bexleyheath</td><td><button class="btn btn-sm">View</button></td></tr>
</tbody></table></div>
<div class="grid g2 mt16"><div class="card"><h3>Broadcast lists</h3>
<table class="mt12"><thead><tr><th>List</th><th class="num">Members</th><th>Last broadcast</th></tr></thead><tbody>
<tr><td>Hygiene recall · 6 months</td><td class="num">1,240</td><td>2 days ago — 24% reply rate</td></tr>
<tr><td>Implant interest · lapsed</td><td class="num">324</td><td>1 week ago — 18% reply rate</td></tr>
<tr><td>VIP private patients</td><td class="num">182</td><td>Never broadcasted</td></tr>
<tr><td>Membership Smile Club</td><td class="num">1,820</td><td>3 weeks ago — 32% engagement</td></tr>
<tr><td>Plan4Growth Academy waitlist</td><td class="num">428</td><td>5 days ago — 28% CTR</td></tr>
</tbody></table>
<button class="btn btn-primary mt12">+ New broadcast</button></div>
<div class="card"><h3>Automation triggers</h3>
<table class="mt12"><tr><td>New lead → Welcome WA</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>Booking confirmed → Reminder 24h before</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>Treatment plan presented → Follow-up day 2</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>No-show → "Sorry we missed you"</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>Recall due → Hygiene rebook</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>Treatment complete → Review request</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>Membership signup → Welcome pack</td><td><span class="pill pos">Active</span></td></tr></table></div></div>`;

/* EXECUTIVE ANALYTICS · CRM */
PAGES['crm-analytics']=()=>`
<div class="topbar"><div class="page-title-row"><h1>Executive Analytics</h1><p>Top-level CRM analytics. Lead source ROI · cohort conversion · funnel metrics · revenue attribution across all four entities.</p></div></div>
<div class="grid g4" style="margin-bottom:14px">${kpi('Leads · YTD',2148,{txt:'+18% YoY',dir:'up'},'good')}${kpi('Consult bookings',1124,{txt:'52% lead-to-consult',dir:'up'},'good')}${kpi('Treatment accepted',584,{txt:'52% close rate',dir:'up'},'good')}${kpi('Marketing-driven revenue','£1.42M',{txt:'46% of YTD',dir:'up'},'good')}</div>
<div class="card"><h3>Lead source performance · YTD</h3>
<table class="mt12"><thead><tr><th>Source</th><th class="num">Leads</th><th class="num">% total</th><th class="num">Cost</th><th class="num">CPL</th><th class="num">Bookings</th><th class="num">Conv.</th><th class="num">Revenue</th><th class="num">ROAS</th></tr></thead><tbody>
<tr><td><b>Meta Ads</b></td><td class="num">684</td><td class="num">32%</td><td class="num">£48,200</td><td class="num">£70</td><td class="num">242</td><td class="num">35%</td><td class="num pos">£312,400</td><td class="num pos">6.5×</td></tr>
<tr><td><b>Google Search</b></td><td class="num">428</td><td class="num">20%</td><td class="num">£28,400</td><td class="num">£66</td><td class="num">198</td><td class="num">46%</td><td class="num pos">£284,200</td><td class="num pos">10.0×</td></tr>
<tr><td><b>Word of mouth / referral</b></td><td class="num">382</td><td class="num">18%</td><td class="num">£0</td><td class="num pos">£0</td><td class="num">242</td><td class="num pos">63%</td><td class="num pos">£412,800</td><td class="num pos">∞</td></tr>
<tr><td><b>Google Maps / GMB</b></td><td class="num">298</td><td class="num">14%</td><td class="num">£0</td><td class="num pos">£0</td><td class="num">168</td><td class="num">56%</td><td class="num pos">£186,400</td><td class="num pos">∞</td></tr>
<tr><td><b>Instagram organic</b></td><td class="num">142</td><td class="num">7%</td><td class="num">£0</td><td class="num pos">£0</td><td class="num">52</td><td class="num">37%</td><td class="num pos">£62,400</td><td class="num pos">∞</td></tr>
<tr><td><b>Direct / website</b></td><td class="num">128</td><td class="num">6%</td><td class="num">£0</td><td class="num pos">£0</td><td class="num">68</td><td class="num">53%</td><td class="num pos">£84,200</td><td class="num pos">∞</td></tr>
<tr><td><b>Internal referral</b></td><td class="num">86</td><td class="num">4%</td><td class="num">£0</td><td class="num pos">£0</td><td class="num">62</td><td class="num pos">72%</td><td class="num pos">£82,400</td><td class="num pos">∞</td></tr>
</tbody></table>
<div class="hint info mt12"><b>Insight:</b> Word of mouth + GMB + internal referral = 36% of leads at zero cost, converting at 56-72%. Cheapest leads are also best leads. Invest in reviews, satisfaction, internal referral programme.</div></div>
<div class="grid g2 mt16"><div class="card"><h3>Cohort conversion · last 6 months</h3>
<table class="mt12"><thead><tr><th>Month</th><th class="num">Leads</th><th class="num">Consult</th><th class="num">TP accepted</th><th class="num">Revenue</th></tr></thead><tbody>
<tr><td>Dec 2025</td><td class="num">324</td><td class="num">168 (52%)</td><td class="num">82 (24%)</td><td class="num">£198,400</td></tr>
<tr><td>Jan 2026</td><td class="num">298</td><td class="num">162 (54%)</td><td class="num">88 (28%)</td><td class="num">£212,800</td></tr>
<tr><td>Feb 2026</td><td class="num">342</td><td class="num">182 (53%)</td><td class="num">94 (27%)</td><td class="num">£228,400</td></tr>
<tr><td>Mar 2026</td><td class="num">386</td><td class="num">204 (53%)</td><td class="num">108 (28%)</td><td class="num">£256,200</td></tr>
<tr><td>Apr 2026</td><td class="num">412</td><td class="num">218 (53%)</td><td class="num">116 (28%)</td><td class="num">£272,400</td></tr>
<tr><td>May 2026 (MTD)</td><td class="num">186</td><td class="num">98 (53%)</td><td class="num">48 (26%)</td><td class="num">£118,400</td></tr>
</tbody></table></div>
<div class="card"><h3>Funnel performance · YTD</h3>
<table class="mt12"><tr><td>1. Lead captured</td><td class="num">2,148</td><td class="muted">100%</td></tr>
<tr><td>2. Contacted within 5 min</td><td class="num">1,624</td><td class="muted">76%</td></tr>
<tr><td>3. Consult booked</td><td class="num">1,124</td><td class="muted">52%</td></tr>
<tr><td>4. Consult attended</td><td class="num">810</td><td class="muted">72% show</td></tr>
<tr><td>5. TP presented</td><td class="num">748</td><td class="muted">92%</td></tr>
<tr><td>6. TP accepted</td><td class="num">584</td><td class="muted">78% close</td></tr>
<tr><td>7. Deposit paid</td><td class="num">512</td><td class="muted">88%</td></tr>
<tr style="font-weight:600;border-top:1px solid var(--line)"><td>8. Treatment delivered</td><td class="num">486</td><td class="muted pos">£2,920 avg</td></tr></table>
<div class="hint warn mt12 small"><b>Biggest leak:</b> 28% of consult attendees don't proceed to TP acceptance (164 lost / yr × £2,920 = £478k gap). TCO coaching is highest-ROI fix.</div></div></div>
<div class="card mt16"><h3>Performance by entity</h3>
<table class="mt12"><thead><tr><th>Entity</th><th class="num">Leads YTD</th><th class="num">Cost</th><th class="num">CPL</th><th class="num">Bookings</th><th class="num">Revenue</th><th class="num">ROAS</th><th>Pacing</th></tr></thead><tbody>
<tr><td>GM Dental Group (5 practices)</td><td class="num">1,642</td><td class="num">£58,200</td><td class="num">£35</td><td class="num">912</td><td class="num pos">£1,124,200</td><td class="num pos">19.3×</td><td><span class="pill pos">On track</span></td></tr>
<tr><td>Plan4Growth Academy</td><td class="num">342</td><td class="num">£12,400</td><td class="num">£36</td><td class="num">142</td><td class="num pos">£198,400</td><td class="num pos">16.0×</td><td><span class="pill pos">On track</span></td></tr>
<tr><td>Biological Clinician</td><td class="num">124</td><td class="num">£4,800</td><td class="num">£39</td><td class="num">52</td><td class="num pos">£82,400</td><td class="num pos">17.2×</td><td><span class="pill warn">Pre-launch</span></td></tr>
<tr><td>Elevate Accounts</td><td class="num">40</td><td class="num">£1,200</td><td class="num">£30</td><td class="num">18</td><td class="num pos">£18,400</td><td class="num warn">15.3×</td><td><span class="pill warn">Pre-launch</span></td></tr>
</tbody></table></div>`;

/* CRM INTEGRATION sub-page */
PAGES['crm-integration']=()=>`
<div class="topbar"><div class="page-title-row"><h1>CRM Integration</h1><p>GoHighLevel sub-account · all API keys, webhook URLs, integration health in one place.</p></div></div>
<div class="grid g4" style="margin-bottom:14px">${kpi('Active integrations',12,{txt:'all healthy',dir:'flat'},'good')}${kpi('Webhooks · 24h','2,184',{txt:'99.4% success',dir:'up'},'good')}${kpi('API calls · today','12,820',{txt:'on plan',dir:'flat'})}${kpi('Sync errors · 7d',3,{txt:'all resolved',dir:'flat'},'good')}</div>
<div class="card"><h3>GoHighLevel sub-account</h3>
<table class="mt12"><tr><td>Location ID</td><td><code>loc_x9k2m4n8p1q5</code></td></tr>
<tr><td>Account tier</td><td>Agency Pro · unlimited contacts</td></tr>
<tr><td>Active pipelines</td><td>3 (Inbound · Recall · Treatment Plan F/u)</td></tr>
<tr><td>Custom fields configured</td><td>42</td></tr>
<tr><td>Calendars connected</td><td>5 (one per practice + group consult)</td></tr>
<tr><td>SMS sender</td><td>+44 1843 555 0162 (verified UK shortcode)</td></tr>
<tr><td>Email sender</td><td>hello@gmdental.co.uk (DKIM + SPF verified)</td></tr>
<tr><td>Webhook URL</td><td><code>https://api.elevateos.co.uk/v1/ghl/webhook</code></td></tr></table></div>
<div class="card mt16"><h3>External integrations</h3>
<table class="mt12"><thead><tr><th>Service</th><th>Purpose</th><th>Status</th><th>Last sync</th><th>Auth</th></tr></thead><tbody>
<tr><td><b>Dentally</b></td><td>Patient + appointment + treatment data</td><td><span class="pill pos">Connected</span></td><td>2 min ago</td><td>OAuth 2.0 (Claude Ext)</td></tr>
<tr><td><b>Xero</b></td><td>Invoices, payments, payroll, P&L</td><td><span class="pill pos">Connected</span></td><td>4 min ago</td><td>OAuth 2.0</td></tr>
<tr><td><b>QuickBooks (Elevate SaaS)</b></td><td>Customer billing for Elevate subs</td><td><span class="pill pos">Connected</span></td><td>12 min ago</td><td>OAuth 2.0</td></tr>
<tr><td><b>Meta Business</b></td><td>Lead capture · ad reporting · WA</td><td><span class="pill pos">Connected</span></td><td>1 min ago</td><td>System User token</td></tr>
<tr><td><b>Google Ads</b></td><td>Search + display + reporting</td><td><span class="pill pos">Connected</span></td><td>6 min ago</td><td>OAuth 2.0</td></tr>
<tr><td><b>Google My Business · 5 locations</b></td><td>Reviews · posts · insights</td><td><span class="pill pos">Connected</span></td><td>22 min ago</td><td>OAuth 2.0</td></tr>
<tr><td><b>Vapi (Voice AI)</b></td><td>Inbound + outbound call agent</td><td><span class="pill pos">Connected</span></td><td>Just now</td><td>API key (rotated quarterly)</td></tr>
<tr><td><b>11Labs</b></td><td>Voice AI agent TTS</td><td><span class="pill pos">Connected</span></td><td>Just now</td><td>API key</td></tr>
<tr><td><b>Stripe</b></td><td>Card payments · membership DD</td><td><span class="pill pos">Connected</span></td><td>3 min ago</td><td>Restricted key</td></tr>
<tr><td><b>GoCardless</b></td><td>DD · membership recurring</td><td><span class="pill pos">Connected</span></td><td>8 min ago</td><td>OAuth 2.0</td></tr>
<tr><td><b>Mailchimp (legacy)</b></td><td>Newsletter list (read-only)</td><td><span class="pill warn">Read only</span></td><td>2 days ago</td><td>API key</td></tr>
<tr><td><b>Slack (internal alerts)</b></td><td>Lead alerts · pipeline movements</td><td><span class="pill pos">Connected</span></td><td>Live</td><td>OAuth bot</td></tr>
</tbody></table></div>
<div class="card mt16"><h3>Webhook health · last 24h</h3>
<table class="mt12"><thead><tr><th>Event</th><th class="num">Fired</th><th class="num">Success</th><th class="num">Failed</th><th>Status</th></tr></thead><tbody>
<tr><td>Lead created (any source)</td><td class="num">412</td><td class="num pos">410</td><td class="num">2</td><td><span class="pill pos">99.5%</span></td></tr>
<tr><td>Booking confirmed</td><td class="num">182</td><td class="num pos">182</td><td class="num">0</td><td><span class="pill pos">100%</span></td></tr>
<tr><td>Treatment plan accepted</td><td class="num">28</td><td class="num pos">28</td><td class="num">0</td><td><span class="pill pos">100%</span></td></tr>
<tr><td>Payment received (Stripe)</td><td class="num">124</td><td class="num pos">123</td><td class="num">1</td><td><span class="pill pos">99.2%</span></td></tr>
<tr><td>DD setup (GoCardless)</td><td class="num">18</td><td class="num pos">18</td><td class="num">0</td><td><span class="pill pos">100%</span></td></tr>
<tr><td>Review received</td><td class="num">42</td><td class="num pos">42</td><td class="num">0</td><td><span class="pill pos">100%</span></td></tr>
<tr><td>WA message received</td><td class="num">1,382</td><td class="num pos">1,378</td><td class="num">4</td><td><span class="pill pos">99.7%</span></td></tr>
<tr style="font-weight:600;border-top:2px solid var(--ink)"><td>Total</td><td class="num">2,188</td><td class="num pos">2,181</td><td class="num">7</td><td><span class="pill pos">99.7%</span></td></tr>
</tbody></table></div>`;
