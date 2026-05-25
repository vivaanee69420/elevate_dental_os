
// ============================================================================
// CHUNK 2 — Task Manager, Marketing OS Hub, Other Investments, Exit Strategy AI, Settings Hub
// ============================================================================

// ========== TEAM ROSTER (matches memory) ==========
const ELV_TEAM = [
  {id:'gaurav', name:'Gaurav Mehta', role:'CEO · Owner', avatar:'GM', color:'#0E7C7B', email:'gaurav@gmdental.co.uk'},
  {id:'nadia', name:'Nadia Reinolds', role:'Co-founder · Plan4Growth', avatar:'NR', color:'#EC4899', email:'nadia@plan4growth.co.uk'},
  {id:'nikhil', name:'Nikhil', role:'Paid Ads · Technical', avatar:'NK', color:'#3B82F6', email:'nikhil@team.com'},
  {id:'ruhith', name:'Ruhith', role:'AWS · DNS · Technical', avatar:'RU', color:'#8B5CF6', email:'ruhith@team.com'},
  {id:'abhishek', name:'Abhishek', role:'Visual Design · Canva', avatar:'AB', color:'#F59E0B', email:'abhishek@team.com'},
  {id:'sona', name:'Sona', role:'Content · Copy · Admin', avatar:'SO', color:'#06B6D4', email:'sona@team.com'},
  {id:'philippa', name:'Philippa', role:'Elevate Accounts', avatar:'PH', color:'#10B981', email:'philippa@elevateaccts.com'},
  {id:'john', name:'Dr John Roberts', role:'Clinical Director · Bio Clinician', avatar:'JR', color:'#6366F1', email:'john@bioclinician.com'}
];
const ELV_BUSINESSES = [
  {id:'gm', name:'GM Dental Group', color:'#0E7C7B'},
  {id:'lab', name:'GM Dental Lab', color:'#7C3AED'},
  {id:'p4g', name:'Plan4Growth Academy', color:'#EC4899'},
  {id:'bio', name:'Biological Clinician', color:'#10B981'},
  {id:'elevate', name:'Elevate Accounts', color:'#3B82F6'}
];

// ========== TASK MANAGER ==========
function tmLoadTasks() {
  const stored = localStorage.getItem('elv-tasks');
  if (stored) return JSON.parse(stored);
  // Seed with realistic tasks
  const today = new Date();
  const dd = (offset) => { const d = new Date(today); d.setDate(d.getDate()+offset); return d.toISOString().split('T')[0]; };
  return [
    {id:'t1', title:'Approve Q2 P&L for GM Dental Group', desc:'Review and sign off Q2 numbers for board pack', assignee:'philippa', priority:'high', status:'in-progress', dueDate:dd(2), category:'finance', business:'gm', createdBy:'gaurav', reminderSent:1, lastReminded:dd(-1)},
    {id:'t2', title:'Launch BDCDS NEC follow-up sequence', desc:'8-email Manychat automation to 247 leads from Birmingham', assignee:'sona', priority:'urgent', status:'in-progress', dueDate:dd(0), category:'marketing', business:'p4g', createdBy:'gaurav', reminderSent:0, lastReminded:null},
    {id:'t3', title:'Configure Meta Pixel for Biological Clinician', desc:'New domain bioclinician.co.uk - install pixel + CAPI', assignee:'nikhil', priority:'high', status:'not-started', dueDate:dd(-2), category:'marketing', business:'bio', createdBy:'gaurav', reminderSent:2, lastReminded:dd(-1)},
    {id:'t4', title:'Renew DBS check — Dr Sunita Patel', desc:'DBS expires 2026-08-01, start renewal now', assignee:'sona', priority:'medium', status:'not-started', dueDate:dd(5), category:'compliance', business:'gm', createdBy:'gaurav', reminderSent:0, lastReminded:null},
    {id:'t5', title:'Warwick Lodge utilisation review', desc:'Currently 68% — find 12% improvement plan', assignee:'nadia', priority:'high', status:'in-progress', dueDate:dd(3), category:'ops', business:'gm', createdBy:'gaurav', reminderSent:0, lastReminded:null},
    {id:'t6', title:'Set up MTDREADY discovery calendar', desc:'Philippa needs GHL calendar w/ 30min slots', assignee:'philippa', priority:'medium', status:'done', dueDate:dd(-3), category:'sales', business:'elevate', createdBy:'gaurav', reminderSent:0, lastReminded:null},
    {id:'t7', title:'Edit Implant Residency video — REMOVE', desc:'Italy Implant is NOT a live product, remove all assets', assignee:'abhishek', priority:'high', status:'not-started', dueDate:dd(-1), category:'marketing', business:'p4g', createdBy:'gaurav', reminderSent:1, lastReminded:dd(0)},
    {id:'t8', title:'AWS S3 backup audit', desc:'Verify nightly backups for all 5 practice databases', assignee:'ruhith', priority:'medium', status:'in-progress', dueDate:dd(7), category:'ops', business:'gm', createdBy:'gaurav', reminderSent:0, lastReminded:null},
    {id:'t9', title:'Q3 Plan4Growth content batch (40 reels)', desc:'40 reels covering Implant Training + Practice Freedom', assignee:'sona', priority:'high', status:'in-progress', dueDate:dd(10), category:'marketing', business:'p4g', createdBy:'gaurav', reminderSent:0, lastReminded:null},
    {id:'t10', title:'Biological Clinician CPD diploma curriculum', desc:'Finalise 12-module curriculum with Dr John Roberts', assignee:'john', priority:'urgent', status:'in-progress', dueDate:dd(1), category:'training', business:'bio', createdBy:'gaurav', reminderSent:0, lastReminded:null}
  ];
}
function tmSaveTasks(tasks) { localStorage.setItem('elv-tasks', JSON.stringify(tasks)); }
function tmGetOverdue(tasks) {
  const today = new Date().toISOString().split('T')[0];
  return tasks.filter(t => t.status !== 'done' && t.dueDate < today);
}
function tmGetDueToday(tasks) {
  const today = new Date().toISOString().split('T')[0];
  return tasks.filter(t => t.status !== 'done' && t.dueDate === today);
}
window.tmAddTask = function() {
  const title = document.getElementById('tm-new-title').value.trim();
  if (!title) { alert('Enter a task title'); return; }
  const tasks = tmLoadTasks();
  tasks.unshift({
    id: 't' + Date.now(),
    title,
    desc: document.getElementById('tm-new-desc').value.trim(),
    assignee: document.getElementById('tm-new-assignee').value,
    priority: document.getElementById('tm-new-priority').value,
    status: 'not-started',
    dueDate: document.getElementById('tm-new-due').value || new Date(Date.now()+7*864e5).toISOString().split('T')[0],
    category: document.getElementById('tm-new-category').value,
    business: document.getElementById('tm-new-business').value,
    createdBy: 'gaurav',
    reminderSent: 0,
    lastReminded: null
  });
  tmSaveTasks(tasks);
  navigate('task-manager');
};
window.tmToggleStatus = function(id) {
  const tasks = tmLoadTasks();
  const t = tasks.find(x=>x.id===id);
  if (!t) return;
  const order = ['not-started','in-progress','done'];
  t.status = order[(order.indexOf(t.status)+1) % order.length];
  tmSaveTasks(tasks);
  navigate('task-manager');
};
window.tmDelete = function(id) {
  if (!confirm('Delete this task?')) return;
  tmSaveTasks(tmLoadTasks().filter(t=>t.id!==id));
  navigate('task-manager');
};
window.tmSendReminder = function(id) {
  const tasks = tmLoadTasks();
  const t = tasks.find(x=>x.id===id);
  if (!t) return;
  t.reminderSent = (t.reminderSent||0) + 1;
  t.lastReminded = new Date().toISOString().split('T')[0];
  tmSaveTasks(tasks);
  const member = ELV_TEAM.find(m=>m.id===t.assignee);
  alert(`✉ Reminder sent to ${member?.name||'team'} (${member?.email||'email'})\n\nTask: ${t.title}\n\nA copy has also been emailed to Gaurav (owner notification).`);
  navigate('task-manager');
};

PAGES['task-manager'] = () => {
  const tasks = tmLoadTasks();
  const overdue = tmGetOverdue(tasks);
  const dueToday = tmGetDueToday(tasks);
  const completedThisWeek = tasks.filter(t => {
    if (t.status !== 'done') return false;
    return true; // simplified
  }).length;
  const tab = localStorage.getItem('tm-tab') || 'all';
  const setTabFn = `(function(t){localStorage.setItem('tm-tab',t);navigate('task-manager');})`;

  const kpis = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
    ${mKpi('📋','Total Tasks', tasks.length.toString(), '', 'across all teams')}
    ${mKpi('🔥','Due Today', dueToday.length.toString(), '', dueToday.length>0?'needs action':'all clear')}
    ${mKpi('⚠','Overdue', overdue.length.toString(), '', overdue.length>0?'auto-reminders firing':'on track')}
    ${mKpi('✓','Completed', completedThisWeek.toString(), '', 'this week')}
    ${mKpi('👥','Active Team', ELV_TEAM.length.toString(), '', 'with assignments')}
  </div>`;

  const overdueBanner = overdue.length > 0 ? `<div style="background:#FEE2E2;border:1px solid #EF4444;border-radius:10px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;gap:12px;align-items:center">
      <span style="font-size:20px">⚠</span>
      <div>
        <div style="font-weight:700;color:#991B1B;font-size:14px">${overdue.length} task${overdue.length>1?'s':''} overdue</div>
        <div style="color:#991B1B;font-size:12.5px;margin-top:2px">Auto-reminders sent to assignees + owner (Gaurav) notified by email · Pop-up on next login</div>
      </div>
    </div>
    <button onclick="(function(){const tasks=tmLoadTasks();const od=tmGetOverdue(tasks);od.forEach(t=>{t.reminderSent=(t.reminderSent||0)+1;t.lastReminded=new Date().toISOString().split('T')[0]});tmSaveTasks(tasks);alert('✉ Bulk reminder sent for '+od.length+' overdue tasks. Owners notified.');navigate('task-manager');})()" style="background:#991B1B;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Send All Reminders Now</button>
  </div>` : '';

  const tabs = [
    {k:'all', l:'All Tasks ('+tasks.length+')', i:'📋'},
    {k:'overdue', l:'Overdue ('+overdue.length+')', i:'⚠'},
    {k:'person', l:'By Person', i:'👤'},
    {k:'business', l:'By Business', i:'🏢'},
    {k:'rules', l:'Reminder Rules', i:'⚙'}
  ];

  const taskRow = (t) => {
    const member = ELV_TEAM.find(m=>m.id===t.assignee) || {name:'Unassigned', color:'#94A3B8', avatar:'??'};
    const business = ELV_BUSINESSES.find(b=>b.id===t.business) || {name:'—', color:'#94A3B8'};
    const today = new Date().toISOString().split('T')[0];
    const isOverdue = t.status!=='done' && t.dueDate < today;
    const isDoneToday = t.status==='done';
    const priorityColors = {urgent:'#EF4444', high:'#F59E0B', medium:'#3B82F6', low:'#64748B'};
    const statusColors = {'not-started':'#94A3B8','in-progress':'#3B82F6','done':'#10B981','blocked':'#EF4444'};
    const statusLabels = {'not-started':'Not Started','in-progress':'In Progress','done':'Done','blocked':'Blocked'};
    const dueDateFormatted = new Date(t.dueDate).toLocaleDateString('en-GB',{day:'numeric',month:'short'});

    return `<div style="background:#fff;border:1px solid ${isOverdue?'#FECACA':'#E5E7EB'};border-left:4px solid ${priorityColors[t.priority]};border-radius:10px;padding:14px 16px;margin-bottom:8px;display:grid;grid-template-columns:auto 1fr auto auto auto auto auto;gap:14px;align-items:center">
      <button onclick="tmToggleStatus('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:18px;padding:0;color:${statusColors[t.status]}" title="${statusLabels[t.status]}">${t.status==='done'?'✓':t.status==='in-progress'?'◐':'○'}</button>
      <div>
        <div style="font-weight:600;font-size:14px;color:${isDoneToday?'#94A3B8':'#0F172A'};text-decoration:${isDoneToday?'line-through':'none'}">${t.title}</div>
        <div style="font-size:12px;color:#64748B;margin-top:2px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:6px;height:6px;border-radius:50%;background:${business.color}"></span>${business.name}</span>
          <span>·</span>
          <span style="text-transform:capitalize">${t.category}</span>
          ${t.desc?`<span>·</span><span style="opacity:.75">${t.desc.length>50?t.desc.substring(0,50)+'…':t.desc}</span>`:''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:26px;height:26px;background:${member.color};color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700">${member.avatar}</div>
        <span style="font-size:12px;color:#475569;font-weight:500">${member.name.split(' ')[0]}</span>
      </div>
      <span style="font-size:11px;font-weight:700;text-transform:uppercase;padding:3px 9px;border-radius:5px;background:${priorityColors[t.priority]}22;color:${priorityColors[t.priority]};letter-spacing:.04em">${t.priority}</span>
      <div style="font-size:12px;color:${isOverdue?'#EF4444':'#475569'};font-weight:${isOverdue?'700':'500'}">${isOverdue?'⚠ ':''}${dueDateFormatted}</div>
      ${t.reminderSent>0?`<span title="${t.reminderSent} reminder(s) sent · last: ${t.lastReminded}" style="font-size:11px;color:#F59E0B;font-weight:600">📨 ${t.reminderSent}</span>`:'<span></span>'}
      <div style="display:flex;gap:4px">
        ${t.status!=='done' && isOverdue?`<button onclick="tmSendReminder('${t.id}')" style="background:#FEF3C7;color:#92400E;border:1px solid #F59E0B;padding:4px 9px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">Remind</button>`:''}
        <button onclick="tmDelete('${t.id}')" style="background:none;border:none;color:#94A3B8;cursor:pointer;font-size:14px;padding:4px" title="Delete">×</button>
      </div>
    </div>`;
  };

  let body = '';
  if (tab === 'overdue') {
    body = overdue.length > 0 ? overdue.map(taskRow).join('') : `<div style="text-align:center;padding:48px;color:#10B981;font-weight:600;font-size:14px">🎉 No overdue tasks. Team is on top of it.</div>`;
  } else if (tab === 'person') {
    body = ELV_TEAM.map(m => {
      const memberTasks = tasks.filter(t=>t.assignee===m.id && t.status!=='done');
      const memberOverdue = memberTasks.filter(t=>t.dueDate < new Date().toISOString().split('T')[0]).length;
      return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="width:36px;height:36px;background:${m.color};color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">${m.avatar}</div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px;color:#0F172A">${m.name}</div>
            <div style="font-size:11.5px;color:#64748B">${m.role}</div>
          </div>
          <div style="display:flex;gap:8px;font-size:12px">
            <span style="padding:4px 10px;background:#F8FAFC;border-radius:6px;color:#475569;font-weight:600">${memberTasks.length} open</span>
            ${memberOverdue>0?`<span style="padding:4px 10px;background:#FEE2E2;border-radius:6px;color:#991B1B;font-weight:700">⚠ ${memberOverdue} overdue</span>`:''}
          </div>
        </div>
        ${memberTasks.length > 0 ? memberTasks.map(taskRow).join('') : '<div style="padding:8px 12px;color:#94A3B8;font-size:12.5px;font-style:italic">No open tasks</div>'}
      </div>`;
    }).join('');
  } else if (tab === 'business') {
    body = ELV_BUSINESSES.map(b => {
      const bizTasks = tasks.filter(t=>t.business===b.id && t.status!=='done');
      return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${b.color};border-radius:10px;padding:16px;margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h3 style="font-weight:600;font-size:14px;color:#0F172A;margin:0">${b.name}</h3>
          <span style="padding:4px 10px;background:${b.color}22;color:${b.color};border-radius:6px;font-size:11.5px;font-weight:700">${bizTasks.length} open</span>
        </div>
        ${bizTasks.length > 0 ? bizTasks.map(taskRow).join('') : '<div style="padding:8px 12px;color:#94A3B8;font-size:12.5px;font-style:italic">No open tasks</div>'}
      </div>`;
    }).join('');
  } else if (tab === 'rules') {
    body = mCard('Auto-Reminder Rules', `<div style="display:flex;flex-direction:column;gap:14px">
      ${[
        {n:'24h before due', d:'Send assignee an email + in-app reminder 24 hours before due date', enabled:true},
        {n:'On overdue', d:'Immediate email to assignee, copy to Gaurav (owner) on the day a task becomes overdue', enabled:true},
        {n:'Overdue +1 day', d:'Second reminder, copy to Gaurav + line manager', enabled:true},
        {n:'Overdue +3 days', d:'Escalation to Gaurav with red-flag dashboard alert + WhatsApp message', enabled:true},
        {n:'Weekly digest', d:'Every Monday 8am - summary of open + overdue tasks per team member', enabled:true},
        {n:'Pop-up on login', d:'If task is overdue, show modal on assignee\\'s next login with task list and Snooze 1h option', enabled:true}
      ].map(r=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px">
        <div>
          <div style="font-weight:600;font-size:13.5px;color:#0F172A">${r.n}</div>
          <div style="font-size:12px;color:#64748B;margin-top:3px">${r.d}</div>
        </div>
        <label style="display:inline-flex;align-items:center;cursor:pointer">
          <div style="width:36px;height:20px;background:${r.enabled?'#10B981':'#CBD5E1'};border-radius:10px;position:relative;transition:background .15s"><div style="width:16px;height:16px;background:#fff;border-radius:50%;position:absolute;top:2px;${r.enabled?'right:2px':'left:2px'};transition:all .15s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></div></div>
        </label>
      </div>`).join('')}
      <div style="padding:14px;background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:6px;font-size:12.5px;color:#92400E;margin-top:6px">
        <b>📨 Owner Email:</b> All escalations cc: <b>gaurav@gmdental.co.uk</b> · Change in Settings → Notifications
      </div>
    </div>`);
  } else {
    body = tasks.length > 0 ? tasks.map(taskRow).join('') : `<div style="text-align:center;padding:48px;color:#64748B">No tasks yet. Add one above.</div>`;
  }

  const newTaskForm = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
    <h3 style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 12px">+ Add Task</h3>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr auto;gap:8px;align-items:end">
      <div>
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Task</label>
        <input id="tm-new-title" type="text" placeholder="What needs doing?" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px">
      </div>
      <div>
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Assignee</label>
        <select id="tm-new-assignee" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px">${ELV_TEAM.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}</select>
      </div>
      <div>
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Business</label>
        <select id="tm-new-business" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px">${ELV_BUSINESSES.map(b=>`<option value="${b.id}">${b.name}</option>`).join('')}</select>
      </div>
      <div>
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Category</label>
        <select id="tm-new-category" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px"><option>marketing</option><option>ops</option><option>finance</option><option>compliance</option><option>sales</option><option>training</option><option>tech</option></select>
      </div>
      <div>
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Priority</label>
        <select id="tm-new-priority" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px"><option>medium</option><option>high</option><option>urgent</option><option>low</option></select>
      </div>
      <div>
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Due</label>
        <input id="tm-new-due" type="date" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px">
      </div>
      <button onclick="tmAddTask()" style="background:#0E7C7B;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;height:38px">+ Add</button>
    </div>
    <input id="tm-new-desc" type="text" placeholder="Optional notes..." style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px;margin-top:8px">
  </div>`;

  return mPage('Task Manager · Team & Owner Accountability','Assign tasks across team and businesses · auto-reminders fire on overdue · owner gets escalation alerts', `${mBtn('⬇ Export','secondary')}${mBtn('📊 Reports','secondary')}`)
    + kpis + overdueBanner + newTaskForm + mTabs(tab, tabs, setTabFn) + body + `</div>`;
};

// ========== MARKETING OS HUB — Consolidated Marketing Dashboard ==========
PAGES['mkt-os-hub'] = () => {
  const tab = localStorage.getItem('mkt-hub-tab') || 'overview';
  const setTabFn = `(function(t){localStorage.setItem('mkt-hub-tab',t);navigate('mkt-os-hub');})`;
  const tabs = [
    {k:'overview', l:'ROI Dashboard', i:'📊'},
    {k:'social', l:'Social Media', i:'📱'},
    {k:'paid', l:'Paid Ads', i:'💰'},
    {k:'seo', l:'SEO', i:'🔍'},
    {k:'email', l:'Email & Automation', i:'✉'},
    {k:'reviews', l:'Reviews', i:'⭐'},
    {k:'leads', l:'Leads & Pipeline', i:'🎯'}
  ];

  let panel = '';

  if (tab === 'overview') {
    panel = `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px">
      ${mKpi('£','Spend MTD','£8,100','+12%','£270/day')}
      ${mKpi('👥','Leads','142','+24%','MTD')}
      ${mKpi('£','CPL','£57','-12','from £69')}
      ${mKpi('📈','ROAS','4.8×','+0.6','target 4×')}
      ${mKpi('£','Revenue','£140k','+28%','attributed')}
      ${mKpi('🎯','Conversions','169','+22%','36.4% rate')}
    </div>
    ${mCard('Channel Performance · MTD', mTable(
      [{l:'Channel'},{l:'Spend',align:'right'},{l:'Leads',align:'right'},{l:'CPL',align:'right'},{l:'Conv.',align:'right'},{l:'Revenue',align:'right'},{l:'ROAS',align:'right'},{l:'Status'}],
      [
        ['<b>Meta Ads</b>','£3,200','62','£52','19','£50,600',`<span style="color:#10B981;font-weight:700">6.3×</span>`,mBadge('Top','success')],
        ['<b>Google Ads</b>','£2,800','45','£62','12','£38,400',`<span style="color:#10B981;font-weight:700">5.1×</span>`,mBadge('Strong','success')],
        ['<b>SEO (organic)</b>','£0','22','£0','8','£24,800',`<span style="color:#10B981;font-weight:700">∞</span>`,mBadge('Hidden gem','info')],
        ['<b>TikTok Ads</b>','£800','8','£100','2','£8,200',`<span style="color:#F59E0B;font-weight:700">3.1×</span>`,mBadge('Below target','warn')],
        ['<b>Email Marketing</b>','£200','5','£40','3','£10,400',`<span style="color:#10B981;font-weight:700">7.2×</span>`,mBadge('Efficient','success')],
        ['<b>Referrals</b>','£0','0','£0','125','£7,800',`<span style="color:#10B981;font-weight:700">∞</span>`,mBadge('Reviews working','success')]
      ]
    ))}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
      ${mCard('Acquisition Funnel · This Month', `<div style="display:flex;flex-direction:column;gap:10px;padding:8px 4px">
        ${[
          ['Impressions','42,180','#0E7C7B',100],
          ['Clicks','1,612','#10B981',60],
          ['Leads','142','#3B82F6',32],
          ['Consultations','68','#8B5CF6',22],
          ['Treatment Started','42','#EC4899',12]
        ].map(([l,v,c,w])=>`<div>
          <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;color:#0F172A;margin-bottom:5px"><span>${l}</span><span>${v}</span></div>
          <div style="background:#F1F5F9;border-radius:6px;height:10px;overflow:hidden"><div style="background:${c};height:10px;width:${w}%;border-radius:6px"></div></div>
        </div>`).join('')}
      </div>`)}
      ${mCard('AI Recommendations', `<div style="display:flex;flex-direction:column;gap:10px;font-size:13px;color:#0F172A;line-height:1.5">
        <div style="padding:10px 12px;background:#F0FDFA;border-left:3px solid #0E7C7B;border-radius:6px"><b>⬆ Scale Meta Ads:</b> 6.3× ROAS, increase budget by 50% next month — projected £24k revenue.</div>
        <div style="padding:10px 12px;background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:6px"><b>⚠ Fix TikTok:</b> 3.1× ROAS below 4× target. Pause Whitening creative, test full-arch testimonial.</div>
        <div style="padding:10px 12px;background:#EFF6FF;border-left:3px solid #3B82F6;border-radius:6px"><b>💡 Lean into SEO:</b> 22 leads at £0 cost. Publish 4 implant case studies this month.</div>
        <div style="padding:10px 12px;background:#F5F3FF;border-left:3px solid #8B5CF6;border-radius:6px"><b>📈 Referral spike:</b> 125 conversions from reviews. Increase review-request frequency from 7d to 3d post-treatment.</div>
      </div>`)}
    </div>`;
  } else if (tab === 'social') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${mKpi('📷','Instagram Followers','24,800','+342','this month')}
      ${mKpi('▶','Reels Reach','186k','+22%','MTD')}
      ${mKpi('🎬','Posts Published','42','','of 60 planned')}
      ${mKpi('💬','Engagement','8.2%','+1.4%','above industry')}
    </div>
    ${mCard('Content Production · This Week', mTable(
      [{l:'Platform'},{l:'Asset'},{l:'Owner'},{l:'Status'},{l:'Scheduled'},{l:'Performance'}],
      [
        [mBadge('Instagram','purple'),'Reel — Invisalign vs Veneers','Sona',mBadge('Live','success'),'Mon 18:00','4.2k views · 142 likes'],
        [mBadge('Instagram','purple'),'Story — Behind the scenes Warwick','Abhishek',mBadge('Scheduled','info'),'Tue 09:00','—'],
        [mBadge('TikTok','neutral'),'30s · Patient transformation','Sona',mBadge('Editing','warn'),'Wed 17:00','—'],
        [mBadge('Facebook','info'),'Carousel · Implant journey','Sona',mBadge('Draft','neutral'),'Thu 12:00','—'],
        [mBadge('LinkedIn','info'),'Article · Why I switched to bio-dentistry','Dr John',mBadge('In review','warn'),'Fri 10:00','—'],
        [mBadge('Instagram','purple'),'Reel — Sona meets Dr Mehta','Sona',mBadge('Live','success'),'Sat 15:00','12.1k views · 421 likes']
      ]
    ))}
    ${mCard('AI Content Generator · Quick Spin Up', `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
      ${['Facebook Post','Instagram Post','Instagram Reel','Twitter / X','LinkedIn','TikTok Caption','Google My Business','Email Newsletter'].map((p,i)=>`<button style="background:${i===0?'#F0FDFA':'#fff'};border:1px solid ${i===0?'#0E7C7B':'#E5E7EB'};border-radius:10px;padding:12px;text-align:center;cursor:pointer;font-size:12.5px;font-weight:600;color:${i===0?'#0E7C7B':'#0F172A'}">${p}</button>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">
      <select style="padding:9px;border:1px solid #E5E7EB;border-radius:7px;font-size:12.5px"><option>Treatment: Invisalign</option><option>Implants</option><option>Composite Bonding</option></select>
      <select style="padding:9px;border:1px solid #E5E7EB;border-radius:7px;font-size:12.5px"><option>Tone: Friendly</option><option>Professional</option><option>Educational</option></select>
      <input type="text" placeholder="Hook angle..." style="padding:9px;border:1px solid #E5E7EB;border-radius:7px;font-size:12.5px">
      <button style="background:#0E7C7B;color:#fff;border:none;padding:9px;border-radius:7px;font-size:12.5px;font-weight:700;cursor:pointer">✨ Generate</button>
    </div>`)}`;
  } else if (tab === 'paid') {
    panel = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
      ${[
        {n:'Meta Ads',sub:'Connected · act_xxxx7832',v:'£3,200',sub2:'spent MTD',roas:'6.3×',c:'#1877F2'},
        {n:'Google Ads',sub:'Connected · xxx-xxx-4521',v:'£2,800',sub2:'spent MTD',roas:'5.1×',c:'#4285F4'},
        {n:'TikTok Ads',sub:'Not Connected',v:'£800',sub2:'spent MTD',roas:'3.1×',c:'#000'}
      ].map(p=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;border-top:3px solid ${p.c}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
          <div><div style="font-weight:700;font-size:13.5px;color:#0F172A">${p.n}</div><div style="font-size:11px;color:#64748B;margin-top:2px">${p.sub}</div></div>
          <span style="color:#10B981;font-weight:700;font-size:14px">${p.roas}</span>
        </div>
        <div style="font-size:22px;font-weight:700;color:#0F172A;letter-spacing:-.01em">${p.v}</div>
        <div style="font-size:11px;color:#64748B">${p.sub2}</div>
      </div>`).join('')}
    </div>
    ${mCard('Active Campaigns', mTable(
      [{l:'Campaign'},{l:'Platform'},{l:'Status'},{l:'Spent',align:'right'},{l:'Clicks',align:'right'},{l:'CTR',align:'right'},{l:'CPA',align:'right'},{l:'ROAS',align:'right'}],
      [
        ['Invisalign Spring Promo',mBadge('Google','info'),mBadge('active','success'),'£1,842','1,296','4.0%','£102',`<b style="color:#10B981">4.8×</b>`],
        ['Implants Awareness',mBadge('Google','info'),mBadge('active','success'),'£2,210','855','3.0%','£184',`<b style="color:#10B981">6.2×</b>`],
        ['Smile Makeover',mBadge('Meta','purple'),mBadge('active','success'),'£1,245','1,808','4.0%','£57',`<b style="color:#10B981">5.1×</b>`],
        ['Whitening Special',mBadge('Meta','purple'),mBadge('paused','warn'),'£680','884','4.0%','£45',`<b style="color:#10B981">3.8×</b>`],
        ['Emergency Dental',mBadge('Google','info'),mBadge('active','success'),'£1,120','915','5.0%','£40',`<b style="color:#10B981">3.2×</b>`],
        ['Veneers Transform',mBadge('TikTok','neutral'),mBadge('active','success'),'£520','2,736','4.0%','£65',`<b style="color:#10B981">7.5×</b>`]
      ]
    ), mBtn('+ New Campaign','primary'))}`;
  } else if (tab === 'seo') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${mKpi('🔍','Organic Sessions','12,840','+18%','MTD')}
      ${mKpi('🎯','Top 3 Rankings','42','+8','keywords')}
      ${mKpi('🔗','Backlinks','384','+24','DR 48')}
      ${mKpi('📍','Local Pack #1','5/5','','all sites visible')}
    </div>
    ${mCard('Keyword Rankings · Top 10', mTable(
      [{l:'Keyword'},{l:'Position',align:'right'},{l:'Volume',align:'right'},{l:'Change',align:'right'},{l:'URL'}],
      [
        ['dental implants Kent','#2','1,900','<span style="color:#10B981">+3</span>','warwicklodgedental.co.uk/implants'],
        ['Invisalign Herne Bay','#1','480','—','warwicklodgedental.co.uk/invisalign'],
        ['cosmetic dentist Ashford','#4','390','<span style="color:#10B981">+2</span>','gmdental.co.uk/ashford/cosmetic'],
        ['composite bonding Barnet','#3','320','<span style="color:#10B981">+1</span>','gmdental.co.uk/barnet/bonding'],
        ['full arch implants UK','#7','1,200','<span style="color:#10B981">+5</span>','warwicklodgedental.co.uk/full-arch'],
        ['emergency dentist Rochester','#1','590','—','gmdental.co.uk/rochester/emergency'],
        ['biological dentist UK','#12','210','<span style="color:#10B981">+8</span>','bioclinician.co.uk'],
        ['dental implant cost London','#8','2,400','<span style="color:#EF4444">-2</span>','warwicklodgedental.co.uk/cost'],
        ['Veneers Bexleyheath','#2','170','<span style="color:#10B981">+1</span>','fixedteethsolutions.co.uk'],
        ['mercury free dentistry','#5','340','<span style="color:#10B981">+3</span>','bioclinician.co.uk/mercury-free']
      ]
    ))}
    ${mCard('Content Opportunities · AI Suggestions', `<div style="display:flex;flex-direction:column;gap:10px;font-size:13px">
      <div style="padding:12px;background:#F0FDFA;border-left:3px solid #0E7C7B;border-radius:6px"><b>Write:</b> "Cost of Full Arch Implants UK 2026" · 2,400 mo volume · opportunity to outrank competitor at #1</div>
      <div style="padding:12px;background:#EFF6FF;border-left:3px solid #3B82F6;border-radius:6px"><b>Write:</b> "Invisalign vs ClearCorrect Comparison" · 1,100 mo volume · zero competition Kent area</div>
      <div style="padding:12px;background:#F5F3FF;border-left:3px solid #8B5CF6;border-radius:6px"><b>Optimise:</b> Existing /implants page · move to top 3 with 8 internal links + schema markup</div>
    </div>`)}`;
  } else if (tab === 'email') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${mKpi('✉','List Size','8,420','+182','contacts')}
      ${mKpi('📬','Open Rate','38%','+4%','above 22% avg')}
      ${mKpi('🖱','CTR','6.8%','+1.2%','industry: 2.5%')}
      ${mKpi('🤖','Workflows Live','14','','automated')}
    </div>
    ${mCard('Active Automations', mTable(
      [{l:'Workflow'},{l:'Trigger'},{l:'Audience',align:'right'},{l:'Open',align:'right'},{l:'CTR',align:'right'},{l:'Status'}],
      [
        ['New Patient Welcome','Booking confirmed','248','62%','11%',mBadge('Live','success')],
        ['Implant Consultation Follow-up','Consult attended','42','68%','14%',mBadge('Live','success')],
        ['DNA Recovery','No-show','12','45%','22%',mBadge('Live','success')],
        ['Review Request (7d post-tx)','Treatment done','86','52%','18%',mBadge('Live','success')],
        ['Lapsed Patient Reactivation','9mo no-visit','420','28%','5%',mBadge('Live','success')],
        ['Hygiene Recall (6 month)','Last visit +180d','340','41%','9%',mBadge('Live','success')],
        ['BDCDS Lead Nurture','NEC scan','247','58%','15%',mBadge('Running','info')],
        ['Plan4Growth Academy Drip','Lead magnet','312','44%','12%',mBadge('Live','success')]
      ]
    ), mBtn('+ New Workflow','primary'))}`;
  } else if (tab === 'reviews') {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${mKpi('⭐','Avg Rating','4.9','+0.1','across 5 sites')}
      ${mKpi('💬','Total Reviews','1,284','+42','MTD')}
      ${mKpi('📈','Response Rate','98%','','within 24h')}
      ${mKpi('🚫','Private Feedback','3','','filtered out')}
    </div>
    ${mCard('Reviews by Site', mTable(
      [{l:'Site'},{l:'Google',align:'right'},{l:'Facebook',align:'right'},{l:'Doctify',align:'right'},{l:'Avg',align:'right'},{l:'Trend'}],
      [
        ['Warwick Lodge (Herne Bay)','4.9 · 412','4.8 · 86','4.9 · 24','<b>4.9</b>','<span style="color:#10B981">↗ +0.1</span>'],
        ['Ashford','4.8 · 286','4.7 · 52','4.8 · 18','<b>4.8</b>','<span style="color:#10B981">↗ +0.2</span>'],
        ['Rochester','4.9 · 198','4.9 · 38','—','<b>4.9</b>','— stable'],
        ['Barnet','4.8 · 124','4.6 · 22','4.7 · 12','<b>4.7</b>','<span style="color:#F59E0B">↘ -0.1</span>'],
        ['Bexleyheath (FTS)','5.0 · 92','4.9 · 18','—','<b>5.0</b>','<span style="color:#10B981">↗ Top tier</span>']
      ]
    ))}
    ${mCard('Review Gate Performance · Last 30 days', `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
      <div style="text-align:center;padding:20px;background:#F0FDFA;border-radius:10px"><div style="font-size:32px;font-weight:700;color:#0E7C7B;letter-spacing:-.02em">142</div><div style="font-size:12px;color:#475569;font-weight:600;margin-top:4px">Requests Sent</div></div>
      <div style="text-align:center;padding:20px;background:#ECFDF5;border-radius:10px"><div style="font-size:32px;font-weight:700;color:#10B981;letter-spacing:-.02em">86</div><div style="font-size:12px;color:#475569;font-weight:600;margin-top:4px">Public Reviews (5★)</div></div>
      <div style="text-align:center;padding:20px;background:#FEF3C7;border-radius:10px"><div style="font-size:32px;font-weight:700;color:#F59E0B;letter-spacing:-.02em">3</div><div style="font-size:12px;color:#475569;font-weight:600;margin-top:4px">Private Feedback (filtered)</div></div>
    </div>`)}`;
  } else {
    panel = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${mKpi('🎯','Active Leads','248','+62','MTD')}
      ${mKpi('📞','Avg Response','3m','','target: 5m')}
      ${mKpi('✅','Conversion','27%','+4%','lead → consult')}
      ${mKpi('💷','Pipeline Value','£284k','+£42k','open opportunities')}
    </div>
    ${mCard('Pipeline by Stage', mTable(
      [{l:'Stage'},{l:'Count',align:'right'},{l:'Value',align:'right'},{l:'Conv. to next',align:'right'},{l:'Avg time'}],
      [
        ['New','62','£62k','82%','< 5m'],
        ['Contacted','51','£51k','71%','2.4h'],
        ['Consult Booked','36','£72k','68%','3.2 days'],
        ['Consult Attended','24','£48k','58%','same day'],
        ['Treatment Plan Sent','14','£42k','52%','6.8 days'],
        ['Treatment Started','9','£9k','—','closed']
      ]
    ))}
    ${mCard('Lead Sources · MTD', mTable(
      [{l:'Source'},{l:'Leads',align:'right'},{l:'Cost',align:'right'},{l:'CPL',align:'right'},{l:'Booked',align:'right'},{l:'Cost / Booking',align:'right'}],
      [
        ['Meta Ads','62','£3,200','£52','19','£168'],
        ['Google Ads','45','£2,800','£62','14','£200'],
        ['Organic Search','22','£0','£0','8','£0'],
        ['Direct / Brand','38','£0','£0','22','£0'],
        ['Referral / WoM','125','£0','£0','98','£0'],
        ['TikTok Ads','8','£800','£100','2','£400']
      ]
    ))}`;
  }

  return mPage('Marketing OS Hub · ROI Command Centre','One dashboard · social, paid, SEO, email, reviews, leads · all consolidated', `${mBtn('⬇ Export','secondary')}${mBtn('🤖 Ask AI','primary')}`) + mTabs(tab, tabs, setTabFn) + panel + `</div>`;
};

// ========== WEALTH — OTHER INVESTMENTS ==========
function wOLoad() {
  const stored = localStorage.getItem('elv-other-inv');
  if (stored) return JSON.parse(stored);
  return [
    {id:'i1', name:'Vanguard FTSE Global All Cap', type:'Index Fund', value:48200, costBasis:38000, growth:26.8, currency:'GBP', notes:'Monthly DCA £500'},
    {id:'i2', name:'Tesla shares (TSLA)', type:'Individual Stock', value:18400, costBasis:14200, growth:29.6, currency:'GBP', notes:'42 shares · long-term hold'},
    {id:'i3', name:'Bitcoin (BTC)', type:'Crypto', value:32100, costBasis:18500, growth:73.5, currency:'GBP', notes:'0.42 BTC · cold storage'},
    {id:'i4', name:'Stocks & Shares ISA', type:'Tax-Wrapped', value:95000, costBasis:62000, growth:53.2, currency:'GBP', notes:'AJ Bell · 80/20 equity/bond'},
    {id:'i5', name:'Premium Bonds', type:'NS&I', value:50000, costBasis:50000, growth:0, currency:'GBP', notes:'Avg ~3.8% prize rate'},
    {id:'i6', name:'Angel investment · DentTech startup', type:'Private Equity', value:25000, costBasis:25000, growth:0, currency:'GBP', notes:'10% stake · 3yr exit horizon'}
  ];
}
function wOSave(items) { localStorage.setItem('elv-other-inv', JSON.stringify(items)); }
window.wOAdd = function() {
  const name = document.getElementById('wo-name').value.trim();
  if (!name) return alert('Enter investment name');
  const items = wOLoad();
  items.push({
    id: 'i' + Date.now(),
    name,
    type: document.getElementById('wo-type').value,
    value: parseFloat(document.getElementById('wo-value').value) || 0,
    costBasis: parseFloat(document.getElementById('wo-cost').value) || 0,
    growth: parseFloat(document.getElementById('wo-growth').value) || 0,
    currency: 'GBP',
    notes: document.getElementById('wo-notes').value
  });
  wOSave(items);
  navigate('wealth-other');
};
window.wODel = function(id) {
  if (!confirm('Delete this investment?')) return;
  wOSave(wOLoad().filter(i=>i.id!==id));
  navigate('wealth-other');
};

PAGES['wealth-other'] = () => {
  const items = wOLoad();
  const total = items.reduce((s,i)=>s+i.value, 0);
  const totalCost = items.reduce((s,i)=>s+i.costBasis, 0);
  const overallGrowth = totalCost > 0 ? ((total - totalCost) / totalCost * 100).toFixed(1) : 0;

  const kpis = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
    ${mKpi('💰','Total Portfolio','£'+total.toLocaleString(),'',`across ${items.length} investments`)}
    ${mKpi('📈','Total Growth','+'+overallGrowth+'%','','vs cost basis')}
    ${mKpi('£','Cost Basis','£'+totalCost.toLocaleString(),'','original investment')}
    ${mKpi('💎','Unrealised Gain','£'+(total-totalCost).toLocaleString(),'','before CGT')}
  </div>`;

  const addForm = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:18px">
    <h3 style="font-size:14px;font-weight:700;color:#0F172A;margin:0 0 12px">+ Add Investment</h3>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr auto;gap:8px;align-items:end">
      <div><label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Name</label><input id="wo-name" type="text" placeholder="e.g., Apple shares" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px"></div>
      <div><label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Type</label><select id="wo-type" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px"><option>Index Fund</option><option>Individual Stock</option><option>Crypto</option><option>Tax-Wrapped</option><option>Bond</option><option>NS&I</option><option>Private Equity</option><option>Commodity</option><option>Other</option></select></div>
      <div><label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Value £</label><input id="wo-value" type="number" placeholder="48200" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px"></div>
      <div><label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Cost £</label><input id="wo-cost" type="number" placeholder="38000" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px"></div>
      <div><label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Growth %</label><input id="wo-growth" type="number" placeholder="26.8" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px"></div>
      <div><label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">Notes</label><input id="wo-notes" type="text" placeholder="optional" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13px"></div>
      <button onclick="wOAdd()" style="background:#0E7C7B;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;height:38px">+ Add</button>
    </div>
  </div>`;

  const table = mCard('Investment Portfolio', mTable(
    [{l:'Investment'},{l:'Type'},{l:'Cost £',align:'right'},{l:'Current £',align:'right'},{l:'Growth %',align:'right'},{l:'Gain/Loss',align:'right'},{l:'Notes'},{l:''}],
    items.map(i => {
      const gain = i.value - i.costBasis;
      const growthColor = i.growth >= 0 ? '#10B981' : '#EF4444';
      return [
        `<b>${i.name}</b>`,
        mBadge(i.type, 'info'),
        `£${i.costBasis.toLocaleString()}`,
        `<b>£${i.value.toLocaleString()}</b>`,
        `<span style="color:${growthColor};font-weight:700">${i.growth >= 0 ? '+' : ''}${i.growth}%</span>`,
        `<span style="color:${growthColor};font-weight:600">${gain >= 0 ? '+' : ''}£${gain.toLocaleString()}</span>`,
        `<span style="font-size:11.5px;color:#64748B">${i.notes||''}</span>`,
        `<button onclick="wODel('${i.id}')" style="background:none;border:none;color:#94A3B8;cursor:pointer;font-size:14px;padding:4px" title="Delete">×</button>`
      ];
    })
  ));

  return mPage('Other Investments','Manual portfolio tracking · stocks, crypto, bonds, private equity · live % growth', `${mBtn('⬇ Export CSV','secondary')}${mBtn('🔄 Sync prices','secondary')}`) + kpis + addForm + table + `</div>`;
};

// ========== WEALTH — EXIT STRATEGY (REVERSE-ENGINEERED) ==========
function exitLoad() {
  const stored = localStorage.getItem('elv-exit-strategy');
  if (stored) return JSON.parse(stored);
  return {
    targetValue: 100000000,  // £100M
    targetYear: 2033,
    businesses: [
      {id:'gm', name:'GM Dental Group', currentValue:8500000, targetShare:35, ebitda:1800000, multiple:5.5, type:'Multi-site dental group'},
      {id:'lab', name:'GM Dental Lab', currentValue:1200000, targetShare:8, ebitda:280000, multiple:4.5, type:'Specialist lab'},
      {id:'p4g', name:'Plan4Growth Academy', currentValue:1800000, targetShare:15, ebitda:420000, multiple:6.0, type:'Education / CPD platform'},
      {id:'bio', name:'Biological Clinician', currentValue:450000, targetShare:7, ebitda:80000, multiple:8.0, type:'CPD diploma brand'},
      {id:'elevate', name:'Elevate Accounts SaaS', currentValue:1200000, targetShare:35, ebitda:240000, multiple:12.0, type:'B2B SaaS · ARR-based'}
    ]
  };
}
function exitSave(data) { localStorage.setItem('elv-exit-strategy', JSON.stringify(data)); }
window.exitUpdate = function() {
  const data = exitLoad();
  data.targetValue = parseFloat(document.getElementById('ex-target').value) * 1000000 || 100000000;
  data.targetYear = parseInt(document.getElementById('ex-year').value) || 2033;
  data.businesses.forEach(b => {
    const share = document.getElementById('ex-share-'+b.id);
    const current = document.getElementById('ex-current-'+b.id);
    const ebitda = document.getElementById('ex-ebitda-'+b.id);
    const multiple = document.getElementById('ex-multiple-'+b.id);
    if (share) b.targetShare = parseFloat(share.value) || 0;
    if (current) b.currentValue = parseFloat(current.value) * 1000000 || 0;
    if (ebitda) b.ebitda = parseFloat(ebitda.value) * 1000000 || 0;
    if (multiple) b.multiple = parseFloat(multiple.value) || 0;
  });
  exitSave(data);
  navigate('wealth-fire');
};

PAGES['wealth-fire'] = () => {
  const data = exitLoad();
  const currentTotal = data.businesses.reduce((s,b)=>s+b.currentValue, 0);
  const yearsToTarget = data.targetYear - new Date().getFullYear();
  const gapToTarget = data.targetValue - currentTotal;
  const requiredCAGR = currentTotal > 0 ? ((Math.pow(data.targetValue / currentTotal, 1/yearsToTarget) - 1) * 100).toFixed(1) : 0;

  // AI-generated strategic actions per business
  const generateActions = (b) => {
    const targetVal = data.targetValue * b.targetShare / 100;
    const valueGap = targetVal - b.currentValue;
    const requiredGrowth = b.currentValue > 0 ? ((Math.pow(targetVal / b.currentValue, 1/yearsToTarget) - 1) * 100).toFixed(1) : 0;
    const targetEbitda = b.multiple > 0 ? targetVal / b.multiple : 0;
    const ebitdaGap = targetEbitda - b.ebitda;
    const ebitdaCAGR = b.ebitda > 0 ? ((Math.pow(targetEbitda / b.ebitda, 1/yearsToTarget) - 1) * 100).toFixed(1) : 0;

    const actions = {
      gm: [
        `Acquire 3 more practices by ${data.targetYear-2} · target Kent/Surrey · £400k-£600k EBITDA each`,
        `Push private mix from 38% → 65% · invisalign + implants focus across all sites`,
        `Group revenue: £3.8M → £${(targetEbitda * 4.5 / 1000000).toFixed(1)}M required · ${(parseFloat(ebitdaCAGR))}% YoY EBITDA growth`,
        `Refinance Warwick Lodge for £250k working capital before next acquisition`,
        `Standardise ops · move from ${b.multiple}× to ${(b.multiple * 1.4).toFixed(1)}× multiple via SOPs + PMI scale narrative`
      ],
      lab: [
        `Specialise into implant components · 70% margin vs 35% on crowns`,
        `Onboard 8 external practices as clients · diversify away from GM-only`,
        `Hit £${(targetEbitda/1000).toFixed(0)}k EBITDA · ${ebitdaCAGR}% CAGR for ${yearsToTarget} years`,
        `Build digital workflow (CAD/CAM + Exocad) to justify multiple expansion to ${(b.multiple*1.3).toFixed(1)}×`
      ],
      p4g: [
        `Scale to 240 students/yr by ${data.targetYear-1} (currently ~80) · £4,800 ASP`,
        `Launch Practice Freedom Formula as recurring £997/mo membership · target 200 MRR clients`,
        `Cross-sell pipeline to Elevate Accounts · 40% conversion target`,
        `Build EduQual Level 8 to lift multiple from ${b.multiple}× to ${(b.multiple*1.5).toFixed(1)}×`,
        `EBITDA path: £${(b.ebitda/1000).toFixed(0)}k → £${(targetEbitda/1000).toFixed(0)}k requires ${ebitdaCAGR}% CAGR`
      ],
      bio: [
        `Build diploma to 60 graduates/yr · £4,200 ASP · launch second cohort 2027`,
        `Add Mercury-Free supplier marketplace (5% margin) · £200k/yr revenue add-on`,
        `Strategic partnership with IAOMT for international credibility`,
        `Defend ${b.multiple}× multiple via IP-protected curriculum + Dr John Roberts brand`
      ],
      elevate: [
        `Scale ARR from £240k → £${(targetEbitda*4/1000000).toFixed(1)}M · 1,000+ practice owner accounts`,
        `Lift ACV from £4.8k → £9.6k via Compliance + Wealth modules at premium tier`,
        `Build moat via Dentally + Xero deep integrations · 12-month sticky contracts`,
        `Path to ${b.multiple}× multiple holds if NRR > 115% · push from 102% via Wealth upsell`,
        `Year ${yearsToTarget-2} strategic raise to fund AI agents · accelerates to 18× multiple at exit`
      ]
    };
    return {
      targetVal,
      valueGap,
      requiredGrowth,
      targetEbitda,
      ebitdaGap,
      ebitdaCAGR,
      actions: actions[b.id] || []
    };
  };

  const reverseEngineer = `<div style="background:linear-gradient(135deg,#0E7C7B,#0F766E);color:#fff;border-radius:14px;padding:24px;margin-bottom:20px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span style="font-size:22px">🎯</span>
      <h3 style="font-size:17px;font-weight:700;margin:0;letter-spacing:-.01em">Reverse-Engineered Exit Plan</h3>
      <span style="background:rgba(255,255,255,.2);padding:3px 10px;border-radius:5px;font-size:11px;font-weight:600">AI-Generated</span>
    </div>
    <p style="font-size:13.5px;opacity:.9;margin:0 0 18px;line-height:1.5">Tell me your exit value + target year. AI works backward through each business, calculates required EBITDA, growth rates, multiples and generates the strategic playbook.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:14px;align-items:end">
      <div>
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px;opacity:.85">Target Exit Value (£M)</label>
        <input id="ex-target" type="number" value="${data.targetValue/1000000}" style="width:100%;padding:11px 14px;border:none;border-radius:8px;font-size:18px;font-weight:700;color:#0F172A">
      </div>
      <div>
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:5px;opacity:.85">Target Exit Year</label>
        <input id="ex-year" type="number" value="${data.targetYear}" style="width:100%;padding:11px 14px;border:none;border-radius:8px;font-size:18px;font-weight:700;color:#0F172A">
      </div>
      <button onclick="exitUpdate()" style="background:#fff;color:#0E7C7B;border:none;padding:11px 22px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;height:46px;white-space:nowrap">⚡ Recalculate Plan</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,.2)">
      <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:600;letter-spacing:.04em">Current Value</div><div style="font-size:24px;font-weight:700;letter-spacing:-.02em;margin-top:3px">£${(currentTotal/1000000).toFixed(1)}M</div></div>
      <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:600;letter-spacing:.04em">Gap to Target</div><div style="font-size:24px;font-weight:700;letter-spacing:-.02em;margin-top:3px">£${(gapToTarget/1000000).toFixed(1)}M</div></div>
      <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:600;letter-spacing:.04em">Years</div><div style="font-size:24px;font-weight:700;letter-spacing:-.02em;margin-top:3px">${yearsToTarget} yrs</div></div>
      <div><div style="font-size:11px;opacity:.85;text-transform:uppercase;font-weight:600;letter-spacing:.04em">Required CAGR</div><div style="font-size:24px;font-weight:700;letter-spacing:-.02em;margin-top:3px">${requiredCAGR}%</div></div>
    </div>
  </div>`;

  const businesses = data.businesses.map(b => {
    const calc = generateActions(b);
    const progress = b.currentValue / calc.targetVal * 100;
    return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:20px;margin-bottom:14px;border-left:4px solid ${ELV_BUSINESSES.find(x=>x.id===b.id)?.color || '#0E7C7B'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
        <div>
          <h3 style="font-size:16px;font-weight:700;color:#0F172A;margin:0 0 3px;letter-spacing:-.01em">${b.name}</h3>
          <div style="font-size:12px;color:#64748B">${b.type}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#64748B;text-transform:uppercase;font-weight:600;letter-spacing:.04em">Target Contribution</div>
          <div style="font-size:18px;font-weight:700;color:#0F172A;letter-spacing:-.01em">${b.targetShare}% · £${(calc.targetVal/1000000).toFixed(1)}M</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px">
        <div><label style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:3px">Current £M</label><input id="ex-current-${b.id}" type="number" value="${(b.currentValue/1000000).toFixed(1)}" step="0.1" style="width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13.5px;font-weight:600"></div>
        <div><label style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:3px">Share %</label><input id="ex-share-${b.id}" type="number" value="${b.targetShare}" style="width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13.5px;font-weight:600"></div>
        <div><label style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:3px">EBITDA £M</label><input id="ex-ebitda-${b.id}" type="number" value="${(b.ebitda/1000000).toFixed(2)}" step="0.01" style="width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13.5px;font-weight:600"></div>
        <div><label style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:3px">Multiple ×</label><input id="ex-multiple-${b.id}" type="number" value="${b.multiple}" step="0.1" style="width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13.5px;font-weight:600"></div>
        <div><label style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:3px">Implied</label><div style="padding:8px 10px;background:#F0FDFA;border-radius:6px;font-size:13.5px;font-weight:700;color:#0E7C7B">£${((b.ebitda * b.multiple)/1000000).toFixed(1)}M</div></div>
      </div>

      <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:10px;padding:14px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#475569;letter-spacing:.04em;margin-bottom:8px">📊 Required Trajectory (AI-Calculated)</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;font-size:13px">
          <div><div style="color:#64748B;font-size:11px;font-weight:600;margin-bottom:2px">Target EBITDA</div><div style="font-weight:700;color:#0F172A;font-size:15px">£${(calc.targetEbitda/1000).toFixed(0)}k</div></div>
          <div><div style="color:#64748B;font-size:11px;font-weight:600;margin-bottom:2px">EBITDA Gap</div><div style="font-weight:700;color:#0F172A;font-size:15px">+£${(calc.ebitdaGap/1000).toFixed(0)}k</div></div>
          <div><div style="color:#64748B;font-size:11px;font-weight:600;margin-bottom:2px">EBITDA CAGR</div><div style="font-weight:700;color:#10B981;font-size:15px">${calc.ebitdaCAGR}%</div></div>
          <div><div style="color:#64748B;font-size:11px;font-weight:600;margin-bottom:2px">Value CAGR</div><div style="font-weight:700;color:#10B981;font-size:15px">${calc.requiredGrowth}%</div></div>
        </div>
        <div style="margin-top:10px"><div style="background:#E5E7EB;height:8px;border-radius:4px;overflow:hidden"><div style="background:#0E7C7B;height:100%;width:${Math.min(progress,100)}%"></div></div><div style="font-size:11px;color:#64748B;margin-top:3px">Progress: ${progress.toFixed(0)}% of target value</div></div>
      </div>

      <div style="padding:14px;background:#F0FDFA;border-left:3px solid #0E7C7B;border-radius:8px">
        <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;color:#0E7C7B;letter-spacing:.04em;margin-bottom:10px">🤖 AI Game Plan · What ${b.name} must do</div>
        <ol style="margin:0;padding-left:20px;font-size:13.5px;color:#0F172A;line-height:1.7">
          ${calc.actions.map(a => `<li style="margin-bottom:4px">${a}</li>`).join('')}
        </ol>
      </div>
    </div>`;
  }).join('');

  // Whole game plan summary
  const totalImplied = data.businesses.reduce((s,b)=>s + (b.ebitda * b.multiple), 0);
  const totalEbitda = data.businesses.reduce((s,b)=>s + b.ebitda, 0);
  const totalShareCheck = data.businesses.reduce((s,b)=>s + b.targetShare, 0);
  const shareWarn = totalShareCheck !== 100;

  const summary = mCard('🎯 Whole Game Plan · Reality Check', `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
    <div style="padding:14px;background:#F0FDFA;border-radius:10px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">Target</div>
      <div style="font-size:24px;font-weight:700;color:#0F172A;margin-top:3px;letter-spacing:-.02em">£${(data.targetValue/1000000).toFixed(0)}M</div>
      <div style="font-size:11px;color:#64748B;margin-top:1px">by ${data.targetYear}</div>
    </div>
    <div style="padding:14px;background:#ECFDF5;border-radius:10px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">Currently Implied</div>
      <div style="font-size:24px;font-weight:700;color:#0F172A;margin-top:3px;letter-spacing:-.02em">£${(totalImplied/1000000).toFixed(1)}M</div>
      <div style="font-size:11px;color:#64748B;margin-top:1px">EBITDA × multiple</div>
    </div>
    <div style="padding:14px;background:#FEF3C7;border-radius:10px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">Gap</div>
      <div style="font-size:24px;font-weight:700;color:#92400E;margin-top:3px;letter-spacing:-.02em">£${((data.targetValue - totalImplied)/1000000).toFixed(1)}M</div>
      <div style="font-size:11px;color:#64748B;margin-top:1px">to close in ${yearsToTarget} years</div>
    </div>
    <div style="padding:14px;background:${shareWarn?'#FEE2E2':'#ECFDF5'};border-radius:10px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748B;letter-spacing:.04em">Share Allocation</div>
      <div style="font-size:24px;font-weight:700;color:${shareWarn?'#991B1B':'#065F46'};margin-top:3px;letter-spacing:-.02em">${totalShareCheck}%</div>
      <div style="font-size:11px;color:#64748B;margin-top:1px">${shareWarn?'⚠ Should sum to 100%':'✓ allocated'}</div>
    </div>
  </div>
  <div style="padding:14px;background:#1F2937;color:#fff;border-radius:10px;font-size:13.5px;line-height:1.6">
    <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#5DCAA5">🤖 AI Verdict</div>
    ${totalImplied >= data.targetValue ?
      `Your current trajectory <b style="color:#10B981">meets or exceeds</b> the £${(data.targetValue/1000000).toFixed(0)}M target. Focus on multiple expansion (premium positioning, recurring revenue) over more bets.` :
      `Gap of £${((data.targetValue - totalImplied)/1000000).toFixed(1)}M requires <b style="color:#F59E0B">${requiredCAGR}% blended CAGR</b>. <br><br>The biggest levers (ranked):<br>
      ${data.businesses.sort((a,b)=>(b.ebitda*b.multiple)-(a.ebitda*a.multiple)).slice(0,3).map((b,i)=>`<b>${i+1}. ${b.name}:</b> ${b.multiple < 8 ? 'multiple expansion + ' : ''}EBITDA growth · adds £${((b.ebitda*b.multiple)/1000000).toFixed(1)}M today`).join('<br>')}
      <br><br>Elevate Accounts has the highest leverage — SaaS multiples (10-15×) compound fastest. Prioritise ARR growth above all else.`
    }
  </div>`);

  return mPage('Exit Strategy · Reverse Engineering','Set the target. AI works backward through every business to generate the game plan.', `${mBtn('⬇ Export Plan','secondary')}${mBtn('🤖 Refresh AI Analysis','primary','exitUpdate()')}`) + reverseEngineer + businesses + summary + `</div>`;
};

// ========== SETTINGS HUB ==========
PAGES['settings-hub'] = () => {
  const tab = localStorage.getItem('settings-tab') || 'general';
  const setTabFn = `(function(t){localStorage.setItem('settings-tab',t);navigate('settings-hub');})`;
  const tabs = [
    {k:'general', l:'General', i:'⚙'},
    {k:'team', l:'Team & Permissions', i:'👥'},
    {k:'integrations', l:'Integrations', i:'🔌'},
    {k:'notifications', l:'Notifications', i:'🔔'},
    {k:'billing', l:'Billing', i:'💳'},
    {k:'data', l:'Data & Backup', i:'☁'}
  ];

  let panel = '';
  if (tab === 'general') {
    panel = mCard('Organisation Settings', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${[
        ['Organisation Name','GM Dental Group'],
        ['Owner','Gaurav Mehta'],
        ['Primary Email','gaurav@gmdental.co.uk'],
        ['Phone','+44 1227 xxx xxx'],
        ['Country','United Kingdom'],
        ['Currency','GBP (£)'],
        ['Timezone','Europe/London (GMT)'],
        ['Fiscal Year Start','April']
      ].map(f=>`<div><label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#64748B;letter-spacing:.04em;display:block;margin-bottom:4px">${f[0]}</label><input type="text" value="${f[1]}" style="width:100%;padding:9px 12px;border:1px solid #E5E7EB;border-radius:7px;font-size:13.5px;color:#0F172A"></div>`).join('')}
    </div>`);
  } else if (tab === 'team') {
    panel = mCard('Team Members & Permissions', ELV_TEAM.map(m => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;margin-bottom:8px;display:flex;align-items:center;gap:14px">
      <div style="width:40px;height:40px;background:${m.color};color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${m.avatar}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:14px;color:#0F172A">${m.name}</div>
        <div style="font-size:12px;color:#64748B">${m.role} · ${m.email}</div>
      </div>
      <select style="padding:7px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:12.5px">
        <option ${m.id==='gaurav'?'selected':''}>Owner</option>
        <option ${['nadia','philippa','john'].includes(m.id)?'selected':''}>Admin</option>
        <option ${['nikhil','ruhith'].includes(m.id)?'selected':''}>Tech / Editor</option>
        <option ${['abhishek','sona'].includes(m.id)?'selected':''}>Editor</option>
        <option>Viewer</option>
      </select>
      <button style="background:none;border:none;color:#94A3B8;cursor:pointer;font-size:14px">×</button>
    </div>`).join('') + mBtn('+ Invite team member', 'primary'));
  } else if (tab === 'integrations') {
    const ints = [
      {n:'Dentally PMS',d:'Practice management · patients · scheduling',c:'success',l:'Connected'},
      {n:'Xero',d:'Bookkeeping · invoicing · reconciliation',c:'success',l:'Connected'},
      {n:'GoHighLevel (GHL)',d:'CRM · pipelines · automations · funnels',c:'success',l:'Connected'},
      {n:'Stripe',d:'Patient payments · subscriptions',c:'success',l:'Connected'},
      {n:'Google Ads',d:'Paid search campaigns',c:'success',l:'Connected'},
      {n:'Meta Business',d:'Facebook + Instagram ads',c:'success',l:'Connected'},
      {n:'TikTok Ads',d:'Short-form video advertising',c:'warn',l:'Pending'},
      {n:'Google Search Console',d:'SEO tracking · indexing',c:'success',l:'Connected'},
      {n:'Mailchimp',d:'Email marketing',c:'neutral',l:'Not connected'},
      {n:'Zapier',d:'No-code workflow automation',c:'success',l:'Connected'},
      {n:'AWS S3',d:'File storage · backups',c:'success',l:'Connected'},
      {n:'Slack',d:'Team comms · alerts',c:'neutral',l:'Not connected'},
      {n:'WhatsApp Business API',d:'Patient comms · two-way',c:'success',l:'Connected'},
      {n:'Doctify',d:'Review platform',c:'success',l:'Connected'}
    ];
    panel = mCard('Connected Apps', `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
      ${ints.map(i=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;display:flex;align-items:center;gap:14px">
        <div style="width:36px;height:36px;background:#F0FDFA;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">🔌</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:13.5px;color:#0F172A">${i.n}</div>
          <div style="font-size:11.5px;color:#64748B">${i.d}</div>
        </div>
        ${mBadge(i.l, i.c)}
        <button style="background:none;border:1px solid #E5E7EB;color:#475569;padding:5px 10px;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer">${i.l==='Connected'?'Manage':'Connect'}</button>
      </div>`).join('')}
    </div>`);
  } else if (tab === 'notifications') {
    panel = mCard('Notification Preferences', `<div style="display:flex;flex-direction:column;gap:10px">
      ${[
        {n:'Task overdue alerts',d:'Email + in-app when any team task becomes overdue',v:'Email + In-app',on:true},
        {n:'Daily morning digest',d:'8am daily summary of yesterday + today\\'s priorities',v:'Email · 8am',on:true},
        {n:'Weekly KPI report',d:'Monday 9am · revenue, leads, ROAS across all entities',v:'Email · Mon 9am',on:true},
        {n:'Compliance flags',d:'Immediate alert when DBS/GDC/insurance expires in <30 days',v:'Email + WhatsApp',on:true},
        {n:'Financial alerts',d:'Cashflow dip, large expense, unusual transaction',v:'Email · Real-time',on:true},
        {n:'Marketing thresholds',d:'CPL > £100 or ROAS < 3× triggers alert',v:'In-app only',on:true},
        {n:'Team escalations',d:'Repeated overdue tasks (3 days+) escalate to owner',v:'Email + WhatsApp',on:true},
        {n:'Review alerts',d:'New 3-star or lower review across any site',v:'Email · Real-time',on:true}
      ].map(p=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:14px">
        <div style="flex:1">
          <div style="font-weight:600;font-size:13.5px;color:#0F172A">${p.n}</div>
          <div style="font-size:12px;color:#64748B;margin-top:2px">${p.d}</div>
          <div style="font-size:11px;color:#0E7C7B;margin-top:4px;font-weight:600">📨 ${p.v}</div>
        </div>
        <div style="width:36px;height:20px;background:${p.on?'#10B981':'#CBD5E1'};border-radius:10px;position:relative;cursor:pointer"><div style="width:16px;height:16px;background:#fff;border-radius:50%;position:absolute;top:2px;${p.on?'right:2px':'left:2px'};box-shadow:0 1px 3px rgba(0,0,0,.15)"></div></div>
      </div>`).join('')}
    </div>`);
  } else if (tab === 'billing') {
    panel = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      ${mCard('Current Plan', `<div style="font-size:13px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Elevate OS</div>
        <div style="font-size:30px;font-weight:700;color:#0F172A;letter-spacing:-.02em;margin:6px 0">Owner · Enterprise</div>
        <div style="font-size:13px;color:#64748B;margin-bottom:14px">Unlimited users · all 5 entities · API access · priority support</div>
        ${mBadge('Active','success')}
        <div style="margin-top:12px;font-size:12.5px;color:#475569"><b>Next billing:</b> 1 June 2026 · £2,400/mo</div>`)}
      ${mCard('Payment Method', `<div style="display:flex;align-items:center;gap:14px;padding:14px;background:#F8FAFC;border-radius:10px;margin-bottom:10px">
          <div style="width:42px;height:30px;background:linear-gradient(135deg,#0F172A,#334155);border-radius:5px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700">VISA</div>
          <div style="flex:1"><div style="font-weight:600;font-size:13.5px;color:#0F172A">•••• 4521</div><div style="font-size:12px;color:#64748B">Expires 09/2028</div></div>
          <button style="background:none;border:1px solid #E5E7EB;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">Update</button>
        </div>
        ${mBtn('+ Add payment method','secondary')}`)}
    </div>
    ${mCard('Recent Invoices', mTable(
      [{l:'Date'},{l:'Description'},{l:'Amount',align:'right'},{l:'Status'},{l:''}],
      [
        ['1 May 2026','Elevate OS · May 2026','£2,400',mBadge('Paid','success'),'<button style="background:none;border:none;color:#0E7C7B;cursor:pointer;font-size:12.5px;font-weight:600">Download</button>'],
        ['1 Apr 2026','Elevate OS · Apr 2026','£2,400',mBadge('Paid','success'),'<button style="background:none;border:none;color:#0E7C7B;cursor:pointer;font-size:12.5px;font-weight:600">Download</button>'],
        ['1 Mar 2026','Elevate OS · Mar 2026','£2,400',mBadge('Paid','success'),'<button style="background:none;border:none;color:#0E7C7B;cursor:pointer;font-size:12.5px;font-weight:600">Download</button>']
      ]
    ))}`;
  } else {
    panel = mCard('Data & Backup', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      <div style="padding:18px;background:#ECFDF5;border-radius:10px;border:1px solid #10B981">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#065F46;letter-spacing:.04em">Last Backup</div>
        <div style="font-size:22px;font-weight:700;color:#065F46;letter-spacing:-.01em;margin:6px 0">2h ago · 100%</div>
        <div style="font-size:12px;color:#065F46">Auto-backup to AWS S3 · nightly 2am UTC</div>
      </div>
      <div style="padding:18px;background:#EFF6FF;border-radius:10px;border:1px solid #3B82F6">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#1E40AF;letter-spacing:.04em">Data Size</div>
        <div style="font-size:22px;font-weight:700;color:#1E40AF;letter-spacing:-.01em;margin:6px 0">8.2 GB</div>
        <div style="font-size:12px;color:#1E40AF">Patients · transactions · documents · analytics</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:14px">
      ${mBtn('⬇ Export All Data','secondary')}
      ${mBtn('🔄 Run Manual Backup','secondary')}
      ${mBtn('📋 GDPR Subject Access','secondary')}
    </div>
    <div style="padding:14px;background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:6px;font-size:12.5px;color:#92400E"><b>⚠ Data Retention:</b> Patient records retained 11 years (GDC requirement). Marketing data 5 years. Backups encrypted AES-256.</div>`);
  }

  return mPage('Settings','All configuration in one place · organisation, team, integrations, notifications, billing, data', mBtn('💾 Save Changes','primary')) + mTabs(tab, tabs, setTabFn) + panel + `</div>`;
};
