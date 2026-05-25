
// ============================================================================
// CHUNK 4 — DATA HUB (manual upload + automated sync, practice-manager friendly)
// ============================================================================

window.dhSetTab = function(t) { localStorage.setItem('dh-tab', t); navigate('data-hub'); };
window.dhSimUpload = function(type) {
  const log = JSON.parse(localStorage.getItem('dh-uploads') || '[]');
  log.unshift({
    id: 'u'+Date.now(),
    type,
    status: 'processed',
    timestamp: new Date().toISOString(),
    rows: Math.floor(Math.random()*400)+50,
    uploadedBy: 'Practice Manager'
  });
  localStorage.setItem('dh-uploads', JSON.stringify(log.slice(0,20)));
  alert(`✓ ${type} uploaded successfully\n\nAI processed ${log[0].rows} rows.\nMatched to your business categories.\nReady in your dashboards within 60 seconds.`);
  navigate('data-hub');
};
window.dhToggleSource = function(id) {
  const sources = JSON.parse(localStorage.getItem('dh-sources') || 'null') || DH_DEFAULT_SOURCES();
  const s = sources.find(x => x.id === id);
  if (s) { s.connected = !s.connected; localStorage.setItem('dh-sources', JSON.stringify(sources)); navigate('data-hub'); }
};

function DH_DEFAULT_SOURCES() {
  return [
    {id:'xero', name:'Xero', cat:'Accounting', desc:'P&L · Expenses · Bank reconciliation', icon:'💷', connected:true, lastSync:'2h ago', frequency:'Nightly'},
    {id:'dentally', name:'Dentally PMS', cat:'Practice Mgmt', desc:'Patient bookings · Revenue per clinician · Treatment plans', icon:'🦷', connected:true, lastSync:'15m ago', frequency:'Real-time'},
    {id:'ghl', name:'GoHighLevel CRM', cat:'CRM', desc:'Leads · Pipelines · SMS · Email automations', icon:'🎯', connected:true, lastSync:'4m ago', frequency:'Real-time'},
    {id:'stripe', name:'Stripe', cat:'Payments', desc:'Patient payments · Subscriptions · Refunds', icon:'💳', connected:true, lastSync:'1h ago', frequency:'Real-time'},
    {id:'gocardless', name:'GoCardless', cat:'Payments', desc:'Direct Debit · Recurring plans', icon:'🔁', connected:true, lastSync:'3h ago', frequency:'Daily'},
    {id:'meta', name:'Meta Business', cat:'Marketing', desc:'Facebook + Instagram ad spend · ROAS · CPL', icon:'📱', connected:true, lastSync:'30m ago', frequency:'Hourly'},
    {id:'gads', name:'Google Ads', cat:'Marketing', desc:'Paid search · Display · YouTube spend', icon:'🔍', connected:true, lastSync:'30m ago', frequency:'Hourly'},
    {id:'gsc', name:'Google Search Console', cat:'Marketing', desc:'SEO performance · Impressions · CTR', icon:'📊', connected:true, lastSync:'6h ago', frequency:'Daily'},
    {id:'bank', name:'Open Banking · HSBC', cat:'Banking', desc:'Live bank feed · Transactions · Balances', icon:'🏦', connected:false, lastSync:'—', frequency:'—'},
    {id:'paye', name:'HMRC PAYE / RTI', cat:'Payroll', desc:'Staff payroll · NI · Tax submissions', icon:'📋', connected:false, lastSync:'—', frequency:'—'},
    {id:'sage', name:'Sage Payroll', cat:'Payroll', desc:'Salaries · Pensions · Statutory pay', icon:'📋', connected:false, lastSync:'—', frequency:'—'},
    {id:'aws', name:'AWS S3', cat:'Storage', desc:'Document storage · Compliance archive', icon:'☁', connected:true, lastSync:'12h ago', frequency:'Nightly'}
  ];
}

PAGES['data-hub'] = () => {
  const tab = localStorage.getItem('dh-tab') || 'upload';
  const tabs = [
    {k:'upload', l:'Manual Upload', i:'⬆'},
    {k:'sources', l:'Automated Sources', i:'🔌'},
    {k:'schedule', l:'Monthly Schedule', i:'📅'},
    {k:'history', l:'Upload History', i:'📜'},
    {k:'help', l:'Practice Manager Guide', i:'📖'}
  ];

  const sources = JSON.parse(localStorage.getItem('dh-sources') || 'null') || DH_DEFAULT_SOURCES();
  const uploads = JSON.parse(localStorage.getItem('dh-uploads') || '[]');
  const connectedCount = sources.filter(s => s.connected).length;
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
  const daysToMonthEnd = Math.ceil((monthEnd - new Date()) / 86400000);

  const kpis = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
    ${mKpi('🔌','Connected Sources', connectedCount.toString(), '', 'auto-syncing data')}
    ${mKpi('⬆','Manual Uploads', uploads.length.toString(), '', 'this month')}
    ${mKpi('📅','Days to Month-End', daysToMonthEnd.toString(), '', 'auto-reports fire')}
    ${mKpi('⚡','Data Freshness', '<1h', '', 'average across sources')}
  </div>`;

  let panel = '';

  // ============ MANUAL UPLOAD (the main "one screen" the user asked for) ============
  if (tab === 'upload') {
    panel = `<div style="background:linear-gradient(135deg,#0E7C7B,#0F766E);color:#fff;border-radius:14px;padding:24px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="font-size:22px">📥</span><h3 style="font-size:18px;font-weight:700;margin:0;letter-spacing:-.01em">Monthly Data Upload</h3></div>
          <p style="font-size:13.5px;opacity:.92;margin:0;line-height:1.55;max-width:680px">Drop any file from your practice management or accounting system. AI auto-detects the type (P&L, payroll, bookings, expenses) and matches to your dashboards. Designed so a practice manager or bookkeeper can do it without training — usually 5 minutes a month.</p>
        </div>
        <span style="background:rgba(255,255,255,.2);padding:5px 11px;border-radius:6px;font-size:11px;font-weight:600;white-space:nowrap">AI-Powered Parser</span>
      </div>
    </div>

    <div style="background:#fff;border:2px dashed #0E7C7B;border-radius:14px;padding:36px;text-align:center;margin-bottom:18px;cursor:pointer" onclick="document.getElementById('dh-file-input').click()">
      <div style="font-size:48px;margin-bottom:10px">⬆️</div>
      <div style="font-size:18px;font-weight:700;color:#0F172A;margin-bottom:6px;letter-spacing:-.01em">Drop your monthly files here</div>
      <div style="font-size:13px;color:#64748B;margin-bottom:14px">CSV, Excel (.xlsx), PDF reports, or text files. AI handles the rest.</div>
      <input id="dh-file-input" type="file" multiple style="display:none" onchange="dhSimUpload('Mixed Files ('+this.files.length+')')">
      <button style="background:#0E7C7B;color:#fff;border:none;padding:11px 22px;border-radius:8px;font-size:13.5px;font-weight:700;cursor:pointer">📂 Browse Files</button>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <h3 style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 12px;letter-spacing:-.01em">Quick Upload Templates · One-click for common monthly reports</h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        ${[
          {n:'Monthly P&L',d:'Profit & Loss from Xero/Sage',i:'💷',c:'#10B981'},
          {n:'Practice Revenue',d:'Per-clinician revenue from Dentally',i:'🦷',c:'#3B82F6'},
          {n:'Payroll Summary',d:'Salaries · NI · Pensions',i:'📋',c:'#8B5CF6'},
          {n:'Bank Statement',d:'Transactions from any UK bank',i:'🏦',c:'#F59E0B'},
          {n:'Treatment Mix',d:'Treatments delivered · revenue',i:'🦷',c:'#06B6D4'},
          {n:'Marketing Spend',d:'Meta + Google + offline costs',i:'📱',c:'#EC4899'},
          {n:'Stock & Materials',d:'Lab fees · consumables · stock',i:'📦',c:'#EF4444'},
          {n:'Custom CSV',d:'Anything else — AI will parse',i:'📄',c:'#64748B'}
        ].map(t => `<button onclick="dhSimUpload('${t.n}')" style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;text-align:left;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${t.c}';this.style.boxShadow='0 2px 8px ${t.c}33'" onmouseout="this.style.borderColor='#E5E7EB';this.style.boxShadow='none'">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:18px">${t.i}</span><b style="font-size:13px;color:#0F172A">${t.n}</b></div>
          <div style="font-size:11.5px;color:#64748B;line-height:1.4">${t.d}</div>
        </button>`).join('')}
      </div>
    </div>

    <div style="background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:8px;padding:14px 16px;margin-bottom:14px">
      <div style="font-weight:700;font-size:13px;color:#92400E;margin-bottom:4px">💡 What happens after upload?</div>
      <div style="font-size:12.5px;color:#92400E;line-height:1.55">1. AI reads the file and identifies what it is · 2. Numbers map to your business dashboards (P&L, KPI scorecard, marketing ROI, etc.) · 3. The owner gets an email summary · 4. Anomalies (sudden cost spikes, missing data) are flagged automatically. No spreadsheet knowledge needed.</div>
    </div>`;
  }

  // ============ AUTOMATED SOURCES ============
  else if (tab === 'sources') {
    const groups = {};
    sources.forEach(s => { (groups[s.cat] = groups[s.cat] || []).push(s); });
    panel = `<div style="background:#F0FDFA;border:1px solid #0E7C7B;border-radius:12px;padding:16px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-weight:700;font-size:14px;color:#0F172A">${connectedCount} of ${sources.length} sources connected</div>
        <div style="font-size:12.5px;color:#475569;margin-top:2px">Connected systems sync automatically — no manual work needed. Disconnected sources can be enabled here.</div>
      </div>
      <div style="display:flex;gap:8px">${mBtn('🔄 Sync All Now', 'primary')}</div>
    </div>
    ${Object.entries(groups).map(([cat, list]) => `<div style="margin-bottom:18px">
      <h3 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748B;margin:0 0 10px;padding-left:4px">${cat}</h3>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
        ${list.map(s => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;display:flex;align-items:center;gap:14px">
          <div style="width:42px;height:42px;background:${s.connected?'#F0FDFA':'#F8FAFC'};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${s.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13.5px;color:#0F172A">${s.name}</div>
            <div style="font-size:11.5px;color:#64748B;margin-top:1px">${s.desc}</div>
            ${s.connected ? `<div style="font-size:11px;color:#10B981;margin-top:4px;font-weight:600">✓ Last sync ${s.lastSync} · ${s.frequency}</div>` : `<div style="font-size:11px;color:#94A3B8;margin-top:4px;font-weight:500">Not connected</div>`}
          </div>
          <button onclick="dhToggleSource('${s.id}')" style="background:${s.connected?'#fff':'#0E7C7B'};border:1px solid ${s.connected?'#E5E7EB':'#0E7C7B'};color:${s.connected?'#475569':'#fff'};padding:7px 14px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0">${s.connected?'Manage':'Connect'}</button>
        </div>`).join('')}
      </div>
    </div>`).join('')}`;
  }

  // ============ MONTHLY SCHEDULE ============
  else if (tab === 'schedule') {
    const schedule = [
      {day:'Day 1', label:'Last day of month', tasks:[
        {who:'🤖 System', what:'Automated month-end snapshot of all connected sources', when:'Auto · 11:59pm'}
      ]},
      {day:'Day 2', label:'1st of new month', tasks:[
        {who:'🤖 System', what:'Pull final P&L from Xero · Pull treatment data from Dentally · Pull marketing spend from Meta/Google', when:'Auto · 6am'},
        {who:'🤖 System', what:'AI generates first draft of monthly report', when:'Auto · 8am'}
      ]},
      {day:'Day 3', label:'2nd', tasks:[
        {who:'👤 Practice Manager', what:'Upload anything that didn\'t auto-sync (e.g. cash handlings, stock count, lab invoices)', when:'Drop into Data Hub'},
        {who:'👤 Practice Manager', what:'Review the auto-generated month summary and add any context notes', when:'~10 minutes'}
      ]},
      {day:'Day 4', label:'3rd', tasks:[
        {who:'👤 Bookkeeper', what:'Validate the numbers — confirm reconciliation against bank statement', when:'~20 minutes'},
        {who:'👤 Bookkeeper', what:'Flag any anomalies (unusual costs, missing income, suspicious transactions)', when:''}
      ]},
      {day:'Day 5', label:'4th', tasks:[
        {who:'🤖 System', what:'Generate Owner Monthly Pack: P&L · KPIs · marketing ROI · cashflow · variance vs target · AI commentary', when:'Auto · 7am'},
        {who:'📧 Email', what:'Send to Owner + Co-founder', when:'Auto · 8am'}
      ]},
      {day:'Day 6+', label:'5th onwards', tasks:[
        {who:'👤 Owner', what:'Reviews the pack · makes decisions · pings team via Task Manager', when:'~15 minutes'}
      ]}
    ];
    panel = `<div style="background:#F0FDFA;border:1px solid #0E7C7B;border-radius:12px;padding:16px;margin-bottom:18px">
      <div style="font-weight:700;font-size:14px;color:#0F172A;margin-bottom:4px">🗓 Month-End Workflow · Hands-off after Day 3</div>
      <div style="font-size:12.5px;color:#475569;line-height:1.55">From the 1st of every month, the system runs this sequence automatically. Practice manager spends about 10 minutes, bookkeeper 20 minutes. Owner gets the finished pack on the 5th — no chasing, no spreadsheets.</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${schedule.map((s,i)=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px;display:flex;gap:18px">
        <div style="min-width:80px;text-align:center;padding:10px;background:#F8FAFC;border-radius:8px;flex-shrink:0">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">${s.day}</div>
          <div style="font-size:11.5px;color:#0F172A;margin-top:3px;font-weight:600">${s.label}</div>
        </div>
        <div style="flex:1">
          ${s.tasks.map(t => `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:8px 0;border-bottom:1px solid #F1F5F9">
            <div style="flex:1">
              <div style="font-size:12px;font-weight:600;color:#0E7C7B;margin-bottom:2px">${t.who}</div>
              <div style="font-size:13px;color:#0F172A;line-height:1.5">${t.what}</div>
            </div>
            <div style="font-size:11.5px;color:#64748B;text-align:right;white-space:nowrap">${t.when}</div>
          </div>`).join('')}
        </div>
      </div>`).join('')}
    </div>`;
  }

  // ============ UPLOAD HISTORY ============
  else if (tab === 'history') {
    panel = uploads.length === 0 ? `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:48px;text-align:center">
      <div style="font-size:42px;margin-bottom:14px">📭</div>
      <div style="font-size:15px;font-weight:600;color:#0F172A;margin-bottom:6px">No uploads yet</div>
      <div style="font-size:13px;color:#64748B">Manual uploads appear here. Go to the Manual Upload tab to start.</div>
    </div>` : mCard('Recent Uploads', mTable(
      [{l:'File Type'},{l:'Uploaded By'},{l:'When'},{l:'Rows',align:'right'},{l:'Status'},{l:''}],
      uploads.map(u => {
        const when = new Date(u.timestamp).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
        return [
          '<b>'+u.type+'</b>',
          u.uploadedBy,
          when,
          u.rows.toString(),
          mBadge(u.status, 'success'),
          '<button style="background:none;border:1px solid #E5E7EB;color:#475569;padding:4px 10px;border-radius:5px;font-size:11.5px;font-weight:600;cursor:pointer">View</button>'
        ];
      })
    ));
  }

  // ============ HELP / PRACTICE MANAGER GUIDE ============
  else {
    panel = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px;margin-bottom:14px">
      <h2 style="font-size:20px;font-weight:700;color:#0F172A;margin:0 0 8px;letter-spacing:-.015em">Practice Manager / Bookkeeper Guide</h2>
      <p style="font-size:13.5px;color:#64748B;margin:0 0 20px;line-height:1.55">Everything you need to know to keep the owner's dashboards accurate · about 30 minutes of work per month total.</p>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${[
          {n:1,t:'On the 1st of each month, log in and check the Data Hub',d:'Most data syncs automatically overnight. You only need to handle anything that hasn\'t synced — usually cash receipts, lab invoices, or stock counts.'},
          {n:2,t:'Drop files into the Manual Upload screen',d:'Drag and drop. The AI figures out what type of file it is. Don\'t worry about formatting — it handles CSV, Excel, PDF, or scanned receipts. If something can\'t be read, you\'ll get a friendly message asking what it is.'},
          {n:3,t:'Use the Quick Upload Templates for common reports',d:'Eight pre-built shortcuts (Monthly P&L, Practice Revenue, Payroll, etc.) make standard monthly uploads one-click. Click the template, drop the file, done.'},
          {n:4,t:'Review the auto-generated month summary',d:'On the 2nd of each month, the system shows you a draft summary. You can add a one-line note about anything unusual (e.g. \"Sept was quiet because of the bank holiday\"). 10 minutes max.'},
          {n:5,t:'If you\'re a bookkeeper, validate on the 3rd',d:'Compare the auto-pulled bank feed against the actual statement. Flag anything that looks wrong. The owner sees your flag immediately. 20 minutes max.'},
          {n:6,t:'You\'re done. The owner gets the pack on the 5th',d:'No need to email anything. The owner reviews on the 5th and pings you back via Task Manager if they have questions. You\'ll see those tasks in your assigned list.'}
        ].map(s => `<div style="display:flex;gap:16px">
          <div style="width:36px;height:36px;background:#0E7C7B;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0">${s.n}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px;color:#0F172A;margin-bottom:3px">${s.t}</div>
            <div style="font-size:13px;color:#475569;line-height:1.6">${s.d}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>
    <div style="background:#F0FDFA;border:1px solid #0E7C7B;border-radius:10px;padding:16px;display:flex;align-items:center;gap:14px">
      <div style="font-size:28px">💬</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:13.5px;color:#0F172A">Need help?</div>
        <div style="font-size:12.5px;color:#475569;margin-top:2px">In-app chat with support team · weekday business hours · usually under 5 minutes to first response</div>
      </div>
      ${mBtn('💬 Chat with support','primary')}
    </div>`;
  }

  return mPage('Data Hub','One screen for all incoming data · auto-sync where possible · simple upload for the rest · designed so a practice manager or bookkeeper can run month-end in 30 minutes', `${mBtn('⬇ Export setup','secondary')}${mBtn('📧 Email owner','secondary')}`) + kpis + mTabs(tab, tabs, 'dhSetTab') + panel + `</div>`;
};
