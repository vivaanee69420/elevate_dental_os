
/* REVIEWS & REPUTATION overview */
PAGES['reviews-overview']=()=>`
<div class="topbar"><div class="page-title-row"><h1>Reviews & Reputation</h1><p>Multi-location review reputation overview. Google · Trustpilot · Facebook · NHS Choices · internal feedback aggregated.</p></div></div>
<div class="grid g4" style="margin-bottom:14px">${kpi('Group average rating','4.86 ★',{txt:'+0.04 MoM',dir:'up'},'good')}${kpi('Total reviews · all platforms',3128,{txt:'+218 last 90d',dir:'up'},'good')}${kpi('Response rate','94%',{txt:'target 90%+',dir:'up'},'good')}${kpi('5-star reviews %','88.2%',{txt:'+1.4pp MoM',dir:'up'},'good')}</div>
<div class="card"><h3>Rating by location</h3>
<table class="mt12"><thead><tr><th>Location</th><th class="num">Google</th><th class="num">Trustpilot</th><th class="num">Facebook</th><th class="num">NHS Choices</th><th class="num">Total</th><th class="num">Blended ★</th></tr></thead><tbody>
<tr><td>Warwick Lodge · Herne Bay</td><td class="num">4.92 ★ (642)</td><td class="num">4.88 ★ (184)</td><td class="num">4.94 ★ (118)</td><td class="num">4.85 ★ (42)</td><td class="num">986</td><td class="num pos"><b>4.91 ★</b></td></tr>
<tr><td>Ashford Dental</td><td class="num">4.86 ★ (528)</td><td class="num">4.82 ★ (142)</td><td class="num">4.90 ★ (96)</td><td class="num">4.78 ★ (38)</td><td class="num">804</td><td class="num pos"><b>4.86 ★</b></td></tr>
<tr><td>Rochester Dental</td><td class="num">4.84 ★ (412)</td><td class="num">4.86 ★ (98)</td><td class="num">4.88 ★ (62)</td><td class="num">4.80 ★ (28)</td><td class="num">600</td><td class="num pos"><b>4.85 ★</b></td></tr>
<tr><td>Barnet Dental</td><td class="num">4.82 ★ (286)</td><td class="num">4.80 ★ (64)</td><td class="num">4.86 ★ (42)</td><td class="num">4.74 ★ (22)</td><td class="num">414</td><td class="num pos"><b>4.82 ★</b></td></tr>
<tr><td>Fixed Teeth Solutions · Bexleyheath</td><td class="num">4.84 ★ (218)</td><td class="num">4.78 ★ (52)</td><td class="num">4.82 ★ (38)</td><td class="num">4.72 ★ (18)</td><td class="num">324</td><td class="num pos"><b>4.81 ★</b></td></tr>
<tr style="font-weight:600;border-top:1px solid var(--line)"><td>Group blended</td><td class="num">4.86 ★ (2,086)</td><td class="num">4.84 ★ (540)</td><td class="num">4.89 ★ (356)</td><td class="num">4.79 ★ (148)</td><td class="num">3,128</td><td class="num pos"><b>4.86 ★</b></td></tr>
</tbody></table></div>
<div class="grid g2 mt16"><div class="card"><h3>Rating trend · last 12 months</h3>
<table class="mt12"><tr><td>Jun 2025</td><td class="num">4.72 ★</td></tr>
<tr><td>Sep 2025</td><td class="num">4.78 ★</td></tr>
<tr><td>Dec 2025</td><td class="num">4.82 ★</td></tr>
<tr><td>Mar 2026</td><td class="num">4.84 ★</td></tr>
<tr style="font-weight:600;border-top:1px solid var(--line)"><td><b>May 2026</b></td><td class="num pos"><b>4.86 ★</b></td></tr></table>
<div class="hint info mt8 small">+0.14 ★ over 12 months. Review Gate suppressing ~12 negative reviews / month — gating is the single biggest contributor to the climb.</div></div>
<div class="card"><h3>Recent attention items</h3>
<table class="mt12"><tr><td>Unresponded reviews</td><td class="num">4</td><td><span class="pill warn">Action · Sona</span></td></tr>
<tr><td>1-2 star reviews this month</td><td class="num">3</td><td><span class="pill neg">Escalated</span></td></tr>
<tr><td>Reviews waiting Sona's response</td><td class="num">18</td><td><span class="pill warn">Within 48h</span></td></tr>
<tr><td>Patients targeted for review request</td><td class="num">142</td><td><span class="pill info">Auto-send Mon AM</span></td></tr></table></div></div>
<div class="card mt16"><h3>Quick links</h3>
<div class="grid g4">
<button class="btn" onclick="navigate('reviews')">→ Review Management</button>
<button class="btn" onclick="navigate('review-inbox')">→ Review Inbox</button>
<button class="btn" onclick="navigate('review-gate')">→ Review Gate</button>
<button class="btn" onclick="navigate('reviews-gate-settings')">→ Gate Settings</button>
<button class="btn" onclick="navigate('reviews-settings')">→ Review Settings</button>
<button class="btn" onclick="navigate('review-out')">→ Outbound Requests</button>
<button class="btn" onclick="navigate('reviews-widget')">→ Reviews Widget</button>
<button class="btn" onclick="navigate('private-feedback')">→ Private Feedback</button>
</div></div>`;

/* GATE SETTINGS sub-page */
PAGES['reviews-gate-settings']=()=>`
<div class="topbar"><div class="page-title-row"><h1>Gate Settings</h1><p>How the review gate decides who sees the public review link vs the private feedback form.</p></div></div>
<div class="card"><h3>Gate logic</h3>
<table class="mt12"><tr><td>Star threshold for public route</td><td><select style="padding:6px"><option>4 stars and above</option><option>5 stars only</option></select></td></tr>
<tr><td>Star threshold for private route</td><td><select style="padding:6px"><option>1-3 stars</option></select></td></tr>
<tr><td>Pre-screening question</td><td>"How likely are you to recommend us?" (1-10 NPS)</td></tr>
<tr><td>NPS threshold for public route</td><td>9 or 10 (promoters)</td></tr>
<tr><td>NPS threshold for private feedback</td><td>0-8 (detractors + passives)</td></tr>
<tr><td>Show platform choice (Google / Trustpilot / FB)?</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr>
<tr><td>Default platform when none selected</td><td><select style="padding:6px"><option>Google (highest impact)</option></select></td></tr>
<tr><td>Auto-thank when 5★ public review submitted</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr></table></div>
<div class="grid g2 mt16"><div class="card"><h3>Gate performance · last 30 days</h3>
<table class="mt12"><tr><td>Total review requests sent</td><td class="num">182</td></tr>
<tr><td>Requests opened</td><td class="num">142 (78%)</td></tr>
<tr><td>Star ratings received</td><td class="num">98 (54%)</td></tr>
<tr><td>5-star → public route</td><td class="num pos">82 (84%)</td></tr>
<tr><td>4-star → public route</td><td class="num pos">8 (8%)</td></tr>
<tr><td>1-3 star → private feedback</td><td class="num warn">8 (8%)</td></tr>
<tr style="font-weight:600;border-top:1px solid var(--line)"><td>Net new public reviews</td><td class="num pos">90</td></tr>
<tr><td>Net private feedback</td><td class="num warn">8</td></tr></table></div>
<div class="card"><h3>Compliance & ethical guardrails</h3>
<table class="mt12"><tr><td>Always honest representation</td><td><span class="pill pos">✓ Configured</span></td></tr>
<tr><td>Patients can always leave a negative review</td><td><span class="pill pos">✓ Link visible</span></td></tr>
<tr><td>Private feedback responded within 24h</td><td><span class="pill pos">✓ Active alert</span></td></tr>
<tr><td>No incentivisation for positive reviews</td><td><span class="pill pos">✓ No mention of rewards</span></td></tr>
<tr><td>GDPR-compliant data capture</td><td><span class="pill pos">✓ Lawful basis: legit. interest</span></td></tr></table></div></div>`;

/* REVIEW SETTINGS — global review module config */
PAGES['reviews-settings']=()=>`
<div class="topbar"><div class="page-title-row"><h1>Review Settings</h1><p>Global review automation configuration. Triggers · timing · branding · platform priority.</p></div></div>
<div class="card"><h3>Review request triggers</h3>
<table class="mt12"><tr><td>Treatment completed</td><td>Send <b>3 days</b> after</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr>
<tr><td>Hygiene appointment</td><td>Send <b>1 day</b> after</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr>
<tr><td>Implant phase 1 (consult)</td><td>Send <b>7 days</b> after</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr>
<tr><td>Implant phase 2 (fit complete)</td><td>Send <b>14 days</b> after</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr>
<tr><td>All-on-4 / full mouth case</td><td>Send <b>21 days</b> after</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr>
<tr><td>New patient · first visit</td><td>Send <b>2 days</b> after</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr>
<tr><td>Membership signup</td><td>Send <b>30 days</b> after</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr></table></div>
<div class="grid g2 mt16"><div class="card"><h3>Channel preference</h3>
<table class="mt12"><tr><td>Primary channel</td><td><select style="padding:6px"><option>SMS (highest response)</option><option>WhatsApp</option><option>Email</option></select></td></tr>
<tr><td>Fallback channel</td><td><select style="padding:6px"><option>WhatsApp</option><option>Email</option></select></td></tr>
<tr><td>Email fallback after</td><td><select style="padding:6px"><option>48 hours of no SMS open</option></select></td></tr>
<tr><td>Maximum reminders</td><td><select style="padding:6px"><option>1 reminder</option><option>2 reminders</option><option>3 reminders</option></select></td></tr>
<tr><td>Reminder spacing</td><td><select style="padding:6px"><option>3 days apart</option></select></td></tr>
<tr><td>Daily send window</td><td>10:00 - 17:00 (avoid evenings)</td></tr></table></div>
<div class="card"><h3>Platform priority order</h3>
<p class="muted small">Order in which platforms appear when patient gives 5★</p>
<table class="mt12"><tr><td>1.</td><td>Google · highest SEO + map impact</td><td><span class="pill pos">Primary</span></td></tr>
<tr><td>2.</td><td>Trustpilot · UK trust signal</td><td><span class="pill info">Secondary</span></td></tr>
<tr><td>3.</td><td>Facebook · social proof</td><td><span class="pill info">Tertiary</span></td></tr>
<tr><td>4.</td><td>NHS Choices (NHS patients only)</td><td><span class="pill muted">Conditional</span></td></tr></table>
<div class="hint info mt12 small">Google reviews drive most map impressions and conversion. Default to Google unless patient was acquired via Facebook or NHS path.</div></div></div>
<div class="card mt16"><h3>Branding</h3>
<table class="mt12"><tr><td>Sender name</td><td><input type="text" value="GM Dental Group" style="width:240px"></td></tr>
<tr><td>SMS sender ID</td><td><input type="text" value="GM Dental" style="width:240px"></td></tr>
<tr><td>Email sender address</td><td><input type="text" value="reviews@gmdental.co.uk" style="width:240px"></td></tr>
<tr><td>Review request page logo</td><td><span class="pill pos">✓ Uploaded</span> <button class="btn btn-sm">Change</button></td></tr>
<tr><td>Brand colour (CTA buttons)</td><td><input type="color" value="#0e7c7b"></td></tr></table>
<button class="btn btn-primary mt12">Save settings</button></div>`;

/* REVIEWS WIDGET — embed for websites */
PAGES['reviews-widget']=()=>`
<div class="topbar"><div class="page-title-row"><h1>Reviews Widget</h1><p>Embed your live Google reviews on your website. Auto-updates · responsive · GDPR-compliant.</p></div></div>
<div class="grid g4" style="margin-bottom:14px">${kpi('Widget installs',6,{txt:'all 5 practices + group',dir:'flat'},'good')}${kpi('Views · last 30d','42,840',null)}${kpi('Click-throughs to Google',182,{txt:'0.4% CTR',dir:'flat'})}${kpi('Reviews displayed',12,{txt:'5★ only',dir:'flat'})}</div>
<div class="grid g2"><div class="card"><h3>Widget configuration</h3>
<table class="mt12"><tr><td>Display mode</td><td><select style="padding:6px"><option>Carousel (rotating)</option><option>Grid</option><option>List</option></select></td></tr>
<tr><td>Reviews shown</td><td><select style="padding:6px"><option>12 (recommended)</option><option>6</option><option>24</option></select></td></tr>
<tr><td>Star filter</td><td><select style="padding:6px"><option>5 stars only</option><option>4 stars and above</option><option>All</option></select></td></tr>
<tr><td>Sort order</td><td><select style="padding:6px"><option>Most recent</option><option>Highest rated</option><option>Random</option></select></td></tr>
<tr><td>Show reviewer name</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr>
<tr><td>Show review date</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr>
<tr><td>Show "Verified Google review" badge</td><td><label class="switch"><input type="checkbox" checked><span></span></label></td></tr>
<tr><td>Theme</td><td><select style="padding:6px"><option>Light</option><option>Dark</option><option>Match site CSS</option></select></td></tr></table>
<button class="btn btn-primary mt12">Generate embed code</button></div>
<div class="card"><h3>Embed code</h3>
<pre style="background:#0f1419;color:#a3e6c8;padding:16px;border-radius:8px;font-size:11px;overflow:auto"><code>&lt;!-- Elevate Reviews Widget --&gt;
&lt;div id="elevate-reviews"
     data-location="warwick-lodge"
     data-mode="carousel"
     data-count="12"
     data-stars="5"&gt;&lt;/div&gt;
&lt;script src="https://reviews.elevateos.co.uk
  /widget.js" async&gt;&lt;/script&gt;</code></pre>
<div class="hint info mt12 small">Paste anywhere on your website. The widget pulls live from Google Business Profile · auto-refreshes every 6 hours · zero impact on Lighthouse score.</div></div></div>
<div class="card mt16"><h3>Installed locations</h3>
<table class="mt12"><thead><tr><th>Website</th><th>Path</th><th class="num">Last seen</th><th class="num">Views (30d)</th><th>Status</th></tr></thead><tbody>
<tr><td>gmdental.co.uk</td><td>/ · /reviews · /testimonials</td><td class="num">Live</td><td class="num">14,820</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>warwicklodgedental.co.uk</td><td>/ · /implants</td><td class="num">Live</td><td class="num">8,420</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>ashforddental.co.uk</td><td>/ · /about</td><td class="num">Live</td><td class="num">6,280</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>rochesterdental.co.uk</td><td>/</td><td class="num">Live</td><td class="num">5,140</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>barnetdental.co.uk</td><td>/ · /reviews</td><td class="num">Live</td><td class="num">4,820</td><td><span class="pill pos">Active</span></td></tr>
<tr><td>fixedteethsolutions.co.uk</td><td>/ · /all-on-4</td><td class="num">Live</td><td class="num">3,360</td><td><span class="pill pos">Active</span></td></tr>
</tbody></table></div>`;
