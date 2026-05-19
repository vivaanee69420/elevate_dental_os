// Elevate CRM mock-data layer.
//
// Mirrors the fixtures hard-coded in preview/elevate-dental-os-v2.html for the
// CRM section screens (Today, Inbox, Pipeline, Enquiries, Nurturing, Templates,
// CRM Reports, CRM Settings, Automations, Landing Pages). The prototype's lead
// dataset is a gzipped blob that cannot be decoded here, so we use its
// SAMPLE_LEADS seed fixture (12 leads) as the deterministic population — every
// screen derives its data from this so the section stays internally
// consistent, exactly like the prototype's localStorage-backed loaders.
//
// The shared @/features/_mock module is frozen and exposes a different
// PRACTICES/STAGES vocabulary (whole-pound, generic). The prototype's CRM uses
// its own journey-status taxonomy, treatment list and currency formatter, so
// those live here scoped to this feature (matching how features/operations
// keeps its own fixtures). When real endpoints land, screens swap their data
// source; these contracts stay stable.
//
// Convention: amounts are WHOLE POUNDS (matches the prototype's arithmetic).
// Pence conversion happens at the future backend-swap point, not here.

// --- Constants (verbatim from the prototype) ----------------------------------

/** Group practices, prototype display order. */
export const PRACTICES = [
  'Ashford Dental',
  'Rochester Dental',
  'Barnet Dental',
  'Warwick Lodge Implant Centre',
  'Fixed Teeth Solutions Bexleyheath',
] as const;

/** Lead capture sources. */
export const SOURCES = [
  'Website Form',
  'Meta Lead Ad',
  'Google Ads',
  'Patient Referral',
  'Phone Enquiry',
] as const;

/** Treatment catalogue. */
export const TREATMENTS = [
  'All-on-4 Implants',
  'Single Tooth Implant',
  'Invisalign',
  'Composite Bonding',
  'Porcelain Veneers',
  'Teeth Whitening',
] as const;

/** Default case value per treatment (whole pounds). */
export const TREATMENT_VALUES: Record<string, number> = {
  'All-on-4 Implants': 14500,
  'Single Tooth Implant': 2850,
  Invisalign: 3500,
  'Composite Bonding': 1200,
  'Porcelain Veneers': 2400,
  'Teeth Whitening': 450,
};

/** Patient finance options offered (CRM Settings). */
export const PAYMENT_PLANS = [
  'Pay upfront',
  'Practice Finance 12m',
  'Practice Finance 24m',
  'Tabeo 24m',
  'Medenta 36m',
] as const;

/** Brand colours used by the CRM prototype screens. */
export const CRM_NAVY = '#1E2434';
export const CRM_TEAL = '#0E7C7B';

/** Format a whole-pound amount as British currency, no decimals. */
export function formatCurrency(amount: number): string {
  return '£' + Math.round(amount).toLocaleString('en-GB');
}

// --- Journey status taxonomy --------------------------------------------------

/** One lead-journey status: key, label, accent colour and chip background. */
export interface JourneyStatus {
  key: string;
  label: string;
  colour: string;
  bg: string;
}

/** Canonical journey statuses, prototype order/colours. */
export const JOURNEY_STATUSES: JourneyStatus[] = [
  { key: 'new', label: 'New', colour: '#3B82F6', bg: '#DBEAFE' },
  { key: 'contact_attempted', label: 'Contact attempted', colour: '#F59E0B', bg: '#FEF3C7' },
  { key: 'contact_made', label: 'Contact made', colour: '#7C3AED', bg: '#EDE9FE' },
  { key: 'consultation_booked', label: 'Consultation booked', colour: '#6366F1', bg: '#E0E7FF' },
  { key: 'failed_to_attend', label: 'Failed to attend', colour: '#DC2626', bg: '#FEE2E2' },
  { key: 'consultation_attended', label: 'Consultation attended', colour: '#0891B2', bg: '#CFFAFE' },
  { key: 'treatment_started', label: 'Treatment started', colour: '#10B981', bg: '#D1FAE5' },
  { key: 'treatment_completed', label: 'Treatment completed', colour: '#059669', bg: '#A7F3D0' },
  { key: 'not_proceeding', label: 'Not proceeding', colour: '#94A3B8', bg: '#F1F5F9' },
  { key: 'paused', label: 'Paused / Nurturing', colour: '#64748B', bg: '#F1F5F9' },
];

/** Index of journey statuses by key. */
export const journeyByKey: Record<string, JourneyStatus> = Object.fromEntries(
  JOURNEY_STATUSES.map((s) => [s.key, s]),
);

/** Resolve a status to its display style, with a slate fallback. */
export function journeyStyle(status: string): JourneyStatus {
  return journeyByKey[status] || { key: status, label: status, colour: '#64748B', bg: '#F1F5F9' };
}

/** Task-type metadata (icon dropped per rule 7; label/colour kept). */
export const TASK_TYPES: Record<string, { label: string; colour: string }> = {
  call_first: { label: 'Call (first)', colour: '#DC2626' },
  call_followup: { label: 'Call (follow-up)', colour: '#F59E0B' },
  send_message: { label: 'Send message', colour: '#3B82F6' },
  book_appointment: { label: 'Book appointment', colour: '#7C3AED' },
  admin: { label: 'Admin', colour: '#64748B' },
  notification: { label: 'Notification', colour: '#10B981' },
};

/** Communication channel metadata (icon dropped per rule 7). */
export const CHANNELS: Record<string, { label: string; colour: string }> = {
  sms: { label: 'SMS', colour: '#10B981' },
  email: { label: 'Email', colour: '#3B82F6' },
  call: { label: 'Call', colour: '#F59E0B' },
  whatsapp: { label: 'WhatsApp', colour: '#25D366' },
  voice_ai: { label: 'Voice AI', colour: '#8B5CF6' },
  chat: { label: 'Chat', colour: '#7C3AED' },
  note: { label: 'Note', colour: '#64748B' },
  system: { label: 'System', colour: '#94A3B8' },
};

/** GDPR lawful-basis metadata (CRM lead detail / settings). */
export const GDPR_BASIS: Record<string, { label: string; colour: string }> = {
  consent: { label: 'Consent', colour: '#10B981' },
  legitimate_interest: { label: 'Legitimate interest', colour: '#F59E0B' },
  contract: { label: 'Contract', colour: '#3B82F6' },
  none: { label: 'None', colour: '#DC2626' },
};

// --- Leads --------------------------------------------------------------------

/** A captured CRM lead. */
export interface Lead {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  practice: string;
  source: string;
  treatment: string;
  value: number; // whole pounds
  status: string;
  created: string; // ISO
}

/** Seed lead population — verbatim from the prototype's SAMPLE_LEADS. */
export const LEADS: Lead[] = [
  { id: 1, first_name: 'Sarah', last_name: 'Mitchell', phone: '07700 900123', email: 'sarah.m@email.com', practice: 'Warwick Lodge Implant Centre', source: 'Meta Lead Ad', treatment: 'All-on-4 Implants', value: 14500, status: 'consultation_booked', created: '2026-05-12T09:30:00Z' },
  { id: 2, first_name: 'James', last_name: 'Thompson', phone: '07700 900234', email: 'j.thompson@email.com', practice: 'Ashford Dental', source: 'Google Ads', treatment: 'Invisalign', value: 3500, status: 'contact_made', created: '2026-05-14T14:15:00Z' },
  { id: 3, first_name: 'Emily', last_name: 'Carter', phone: '07700 900345', email: 'emily.c@email.com', practice: 'Rochester Dental', source: 'Website Form', treatment: 'Composite Bonding', value: 1200, status: 'new', created: '2026-05-16T08:00:00Z' },
  { id: 4, first_name: 'Michael', last_name: 'Davies', phone: '07700 900456', email: 'mdavies@email.com', practice: 'Warwick Lodge Implant Centre', source: 'Patient Referral', treatment: 'Single Tooth Implant', value: 2850, status: 'treatment_started', created: '2026-04-28T11:20:00Z' },
  { id: 5, first_name: 'Olivia', last_name: 'Bennett', phone: '07700 900567', email: 'olivia.b@email.com', practice: 'Barnet Dental', source: 'Meta Lead Ad', treatment: 'Porcelain Veneers', value: 2400, status: 'consultation_attended', created: '2026-05-08T16:45:00Z' },
  { id: 6, first_name: 'Daniel', last_name: 'Wright', phone: '07700 900678', email: 'd.wright@email.com', practice: 'Fixed Teeth Solutions Bexleyheath', source: 'Phone Enquiry', treatment: 'All-on-4 Implants', value: 14500, status: 'contact_attempted', created: '2026-05-15T10:00:00Z' },
  { id: 7, first_name: 'Sophie', last_name: 'Hughes', phone: '07700 900789', email: 'sophie.h@email.com', practice: 'Ashford Dental', source: 'Website Form', treatment: 'Teeth Whitening', value: 450, status: 'new', created: '2026-05-17T07:30:00Z' },
  { id: 8, first_name: 'William', last_name: 'Foster', phone: '07700 900890', email: 'w.foster@email.com', practice: 'Rochester Dental', source: 'Google Ads', treatment: 'Invisalign', value: 3500, status: 'contact_made', created: '2026-05-13T13:00:00Z' },
  { id: 9, first_name: 'Charlotte', last_name: 'Reed', phone: '07700 900901', email: 'c.reed@email.com', practice: 'Warwick Lodge Implant Centre', source: 'Meta Lead Ad', treatment: 'Single Tooth Implant', value: 2850, status: 'consultation_booked', created: '2026-05-11T15:30:00Z' },
  { id: 10, first_name: 'Thomas', last_name: 'Clarke', phone: '07700 900012', email: 't.clarke@email.com', practice: 'Barnet Dental', source: 'Patient Referral', treatment: 'Composite Bonding', value: 1200, status: 'treatment_started', created: '2026-05-02T09:00:00Z' },
  { id: 11, first_name: 'Amelia', last_name: 'Walker', phone: '07700 900111', email: 'a.walker@email.com', practice: 'Fixed Teeth Solutions Bexleyheath', source: 'Website Form', treatment: 'Porcelain Veneers', value: 2400, status: 'new', created: '2026-05-17T11:30:00Z' },
  { id: 12, first_name: 'Henry', last_name: 'Robinson', phone: '07700 900222', email: 'h.robinson@email.com', practice: 'Ashford Dental', source: 'Phone Enquiry', treatment: 'All-on-4 Implants', value: 14500, status: 'consultation_attended', created: '2026-05-06T14:00:00Z' },
];

/** Full display name for a lead. */
export function leadFullName(l: Lead): string {
  return `${l.first_name} ${l.last_name}`.trim();
}

// --- Tasks (CRM Today) --------------------------------------------------------
//
// Derived from leads (data flow):
//   LEADS -> per-status rule -> open task; plus 3 synthetic completed-today
//            tasks. Mirrors the prototype's loadTasks() generator. A fixed
//            "now" (today's date in the brief, 2026-05-19) keeps the
//            overdue/today/upcoming split deterministic across renders.

/** A CRM task in the Today inbox. */
export interface CrmTask {
  id: string;
  leadId: number;
  type: string;
  title: string;
  dueAt: string; // ISO
  completedAt: string | null;
  assignedTo: string;
}

// Anchor "now" to the brief's current date so the screen is deterministic
// (the live prototype used Date.now() against localStorage-frozen data).
const NOW = new Date('2026-05-19T09:00:00Z');

/** Build the deterministic CRM task list from the lead population. */
export function buildTasks(): CrmTask[] {
  const tasks: CrmTask[] = [];
  let tid = 1;
  const t0 = NOW.getTime();
  LEADS.forEach((l) => {
    if (l.status === 'new') {
      tasks.push({ id: `T${tid++}`, leadId: l.id, type: 'call_first', title: `Call ${l.first_name} ${l.last_name} — first contact`, dueAt: new Date(t0 + 30 * 60000).toISOString(), completedAt: null, assignedTo: 'Nadia Reinolds' });
    }
    if (l.status === 'contact_attempted') {
      tasks.push({ id: `T${tid++}`, leadId: l.id, type: 'call_followup', title: `Follow up: ${l.first_name} ${l.last_name}`, dueAt: new Date(t0 - 1 * 3600000).toISOString(), completedAt: null, assignedTo: 'Nadia Reinolds' });
    }
    if (l.status === 'contact_made') {
      tasks.push({ id: `T${tid++}`, leadId: l.id, type: 'book_appointment', title: `Book consultation for ${l.first_name} ${l.last_name}`, dueAt: new Date(t0 + 18 * 3600000).toISOString(), completedAt: null, assignedTo: 'Nadia Reinolds' });
    }
    if (l.status === 'consultation_booked') {
      tasks.push({ id: `T${tid++}`, leadId: l.id, type: 'send_message', title: `Send 48h reminder: ${l.first_name} ${l.last_name}`, dueAt: new Date(t0 + 48 * 3600000).toISOString(), completedAt: null, assignedTo: 'Reception' });
    }
  });
  for (let i = 0; i < 3 && i < LEADS.length; i++) {
    tasks.push({ id: `T${tid++}`, leadId: LEADS[i].id, type: 'call_followup', title: `Called ${LEADS[i].first_name} — confirmed appointment`, dueAt: new Date(t0 - (i + 1) * 3600000).toISOString(), completedAt: new Date(t0 - i * 1800000).toISOString(), assignedTo: 'Nadia Reinolds' });
  }
  return tasks;
}

/** The fixed "now" the Today screen reasons about. */
export const TASK_NOW = NOW;

// --- Enquiries ----------------------------------------------------------------
//
// One enquiry per lead (data flow): LEADS -> map to treatment enquiry with a
// payment plan derived from value. Mirrors the prototype's loadEnquiries().

/** A treatment enquiry attached to a lead. */
export interface Enquiry {
  id: string;
  leadId: number;
  treatment: string;
  value: number;
  paymentPlan: string;
  journeyStatus: string;
  consultationAt: string | null;
}

/** Build the deterministic enquiry list from the lead population. */
export function buildEnquiries(): Enquiry[] {
  return LEADS.map((l, i) => ({
    id: `E${i + 1}`,
    leadId: l.id,
    treatment: l.treatment,
    value: l.value,
    paymentPlan: l.value > 3000 ? 'Practice Finance 24m' : 'Pay upfront',
    journeyStatus: l.status,
    consultationAt:
      l.status === 'consultation_booked'
        ? new Date(NOW.getTime() + ((l.id % 7) + 1) * 86400000).toISOString()
        : null,
  }));
}

// --- Inbox threads ------------------------------------------------------------

/** A unified-inbox conversation thread. */
export interface InboxThread {
  id: string;
  leadId: number;
  name: string;
  initials: string;
  channel: 'sms' | 'email' | 'whatsapp' | 'voice_ai';
  unread: number;
  subject?: string;
  lastSnippet: string;
  minutesAgo: number;
  tag: string;
}

/** Inbox threads — verbatim from the prototype (times as minutes-ago). */
export const INBOX_THREADS: InboxThread[] = [
  { id: 'th1', leadId: 1, name: 'Sarah Mitchell', initials: 'SM', channel: 'whatsapp', unread: 2, lastSnippet: 'Yes Tuesday at 2pm still works. Can I bring my husband for the consultation?', minutesAgo: 12, tag: 'Hot' },
  { id: 'th2', leadId: 2, name: 'James Thompson', initials: 'JT', channel: 'email', unread: 1, subject: 'Re: Invisalign consultation', lastSnippet: 'Thank you for the brochure. I have a couple of questions about the treatment timeline. Could you let me know if evening appointments are available?', minutesAgo: 60, tag: '' },
  { id: 'th3', leadId: 3, name: 'Emily Carter', initials: 'EC', channel: 'sms', unread: 0, lastSnippet: 'Perfect, see you Wednesday!', minutesAgo: 120, tag: 'Booked' },
  { id: 'th4', leadId: 5, name: 'Olivia Bennett', initials: 'OB', channel: 'sms', unread: 0, lastSnippet: "Just wanted to say thank you for today's consultation. I'd like to proceed with the veneer treatment plan we discussed.", minutesAgo: 180, tag: 'Won' },
  { id: 'th5', leadId: 4, name: 'Michael Davies', initials: 'MD', channel: 'email', unread: 0, subject: 'Implant treatment update', lastSnippet: 'Following our discussion last week, I wanted to confirm I am ready to book the implant placement appointment. Please advise availability.', minutesAgo: 26 * 60, tag: 'In treatment' },
  { id: 'th6', leadId: 7, name: 'Sophie Hughes', initials: 'SH', channel: 'whatsapp', unread: 1, lastSnippet: 'Hi! I filled out the form on your website about teeth whitening. When can someone call me back?', minutesAgo: 28 * 60, tag: 'New' },
  { id: 'th7', leadId: 6, name: 'Daniel Wright', initials: 'DW', channel: 'voice_ai', unread: 1, lastSnippet: 'Voice AI: 4min call. Confirmed budget £14.5k. Wants Saturday consult. Sentiment: positive. Booked.', minutesAgo: 30, tag: 'AI Qualified' },
  { id: 'th8', leadId: 8, name: 'William Foster', initials: 'WF', channel: 'sms', unread: 0, lastSnippet: 'No worries — please send me the brochure when you have a chance.', minutesAgo: 5 * 60, tag: '' },
  { id: 'th9', leadId: 9, name: 'Charlotte Reed', initials: 'CR', channel: 'whatsapp', unread: 0, lastSnippet: 'Got it, thanks! See you on the 22nd.', minutesAgo: 4 * 60, tag: 'Booked' },
  { id: 'th10', leadId: 11, name: 'Amelia Walker', initials: 'AW', channel: 'email', unread: 1, subject: 'Veneers consultation enquiry', lastSnippet: 'Hi, I am interested in porcelain veneers and would love to book a consultation. What dates do you have available?', minutesAgo: 90, tag: 'New' },
  { id: 'th11', leadId: 12, name: 'Henry Robinson', initials: 'HR', channel: 'sms', unread: 0, lastSnippet: 'Looking forward to seeing the treatment plan you mentioned.', minutesAgo: 8 * 60, tag: 'Hot' },
  { id: 'th12', leadId: 10, name: 'Thomas Clarke', initials: 'TC', channel: 'voice_ai', unread: 0, lastSnippet: 'Voice AI: Outbound recall. 2min. Patient still committed to bonding. Sentiment: neutral.', minutesAgo: 6 * 60, tag: 'In treatment' },
];

/** One message inside a thread's conversation view. */
export interface ThreadMessage {
  dir: 'in' | 'out';
  text: string;
  minutesAgo: number;
  template?: string;
}

/**
 * Conversation history per thread id. Only a representative subset of threads
 * carries a scripted transcript (WhatsApp + SMS examples from the prototype);
 * threads without an entry render an empty-state, matching the prototype.
 */
export const THREAD_MESSAGES: Record<string, ThreadMessage[]> = {
  th1: [
    { dir: 'in', text: 'Hi! I saw your Instagram ad about All-on-4 — is the £14k price still on?', minutesAgo: 4 * 1440 },
    { dir: 'out', text: 'Hi Sarah! Yes, £14,500 per arch with full lifetime warranty. Would you like a free consultation?', minutesAgo: 4 * 1440 - 10, template: 'Initial outreach' },
    { dir: 'in', text: 'Yes please!', minutesAgo: 4 * 1440 - 20 },
    { dir: 'out', text: 'Brilliant. Tuesday 2pm at Warwick Lodge — does that work?', minutesAgo: 4 * 1440 - 25 },
    { dir: 'in', text: 'Yes Tuesday at 2pm still works. Can I bring my husband for the consultation?', minutesAgo: 12 },
  ],
  th6: [
    { dir: 'in', text: 'Hi! I filled out the form on your website about teeth whitening. When can someone call me back?', minutesAgo: 28 * 60 },
  ],
  th9: [
    { dir: 'out', text: 'Hi Charlotte, confirming your Single Tooth Implant consultation on 22 May at 10am at Warwick Lodge. Reply Y to confirm.', minutesAgo: 5 * 60, template: 'Appointment confirmation' },
    { dir: 'in', text: 'Y', minutesAgo: 270 },
    { dir: 'out', text: 'Perfect, see you then! Free parking on site, no need to bring anything except questions.', minutesAgo: 264 },
    { dir: 'in', text: 'Got it, thanks! See you on the 22nd.', minutesAgo: 4 * 60 },
  ],
  th3: [
    { dir: 'out', text: 'Hi Emily, thanks for your enquiry about composite bonding. When is a good time to chat?', minutesAgo: 5 * 1440 },
    { dir: 'in', text: 'Hi, can you call me tomorrow afternoon?', minutesAgo: 5 * 1440 - 120 },
    { dir: 'out', text: 'Of course — booked you in for Wednesday at 14:00.', minutesAgo: 3 * 1440 },
    { dir: 'in', text: 'Perfect, see you Wednesday!', minutesAgo: 120 },
  ],
};

// --- Nurturing sequences ------------------------------------------------------

/** One step within a nurturing sequence. */
export interface SequenceStep {
  order: number;
  delayMinutes: number;
  channel: string;
  template?: string;
  subject?: string;
  body: string;
}

/** A nurturing (drip) sequence. */
export interface Sequence {
  id: string;
  name: string;
  triggerStatus: string;
  isActive: boolean;
  enrolled: number;
  completed: number;
  steps: SequenceStep[];
}

/** Nurturing sequences — verbatim from the prototype's loadSequences(). */
export const SEQUENCES: Sequence[] = [
  {
    id: 's1', name: 'New Lead Welcome', triggerStatus: 'new', isActive: true, enrolled: 12, completed: 89,
    steps: [
      { order: 1, delayMinutes: 0, channel: 'sms', template: 'welcome_sms', subject: '', body: 'Hi {{first_name}}, thanks for enquiring about {{treatment}}. We will call within 1 hour.' },
      { order: 2, delayMinutes: 60, channel: 'email', template: 'welcome_email', subject: 'Your enquiry at {{practice}}', body: 'Hi {{first_name}}, thanks for getting in touch...' },
      { order: 3, delayMinutes: 1440, channel: 'sms', template: 'day1_reminder', subject: '', body: 'Did we miss you? Reply YES to book a consultation.' },
      { order: 4, delayMinutes: 4320, channel: 'sms', template: 'day3_reminder', subject: '', body: 'Still interested in {{treatment}}? We have slots this week.' },
      { order: 5, delayMinutes: 10080, channel: 'email', template: 'week1_nurture', subject: '5 things to know about {{treatment}}', body: 'A short guide with patient stories and FAQs.' },
    ],
  },
  {
    id: 's2', name: 'Pre-Consultation Reminders', triggerStatus: 'consultation_booked', isActive: true, enrolled: 8, completed: 156,
    steps: [
      { order: 1, delayMinutes: 0, channel: 'sms', template: 'booking_confirm', subject: '', body: 'Your consultation is booked for {{appointment_date}} at {{practice}}.' },
      { order: 2, delayMinutes: -2880, channel: 'sms', template: 'reminder_48h', subject: '', body: 'Reminder: your consultation is in 2 days. Reply C to confirm.' },
      { order: 3, delayMinutes: -120, channel: 'sms', template: 'reminder_2h', subject: '', body: 'See you at {{practice}} in 2 hours! Address: {{address}}' },
    ],
  },
  {
    id: 's3', name: 'FTA Recovery', triggerStatus: 'failed_to_attend', isActive: true, enrolled: 2, completed: 31,
    steps: [
      { order: 1, delayMinutes: 30, channel: 'sms', template: 'fta_immediate', subject: '', body: 'Sorry we missed you today. Reply BOOK to reschedule — no charge.' },
      { order: 2, delayMinutes: 1440, channel: 'call', template: '', subject: '', body: 'Call lead to reschedule.' },
      { order: 3, delayMinutes: 4320, channel: 'email', template: 'fta_final', subject: 'We would still love to see you', body: 'Last chance offer — book by Friday for...' },
    ],
  },
  {
    id: 's4', name: 'Lapsed Lead Re-engagement (90-day)', triggerStatus: 'paused', isActive: false, enrolled: 0, completed: 14,
    steps: [
      { order: 1, delayMinutes: 0, channel: 'email', template: 'reactivation_offer', subject: 'A special offer just for you', body: '£250 off {{treatment}} this month only.' },
      { order: 2, delayMinutes: 4320, channel: 'sms', template: 'reactivation_sms', subject: '', body: 'Did you see our offer? Save £250 on {{treatment}}.' },
    ],
  },
  {
    id: 's5', name: 'Post-Treatment Review Request', triggerStatus: 'treatment_completed', isActive: true, enrolled: 5, completed: 47,
    steps: [
      { order: 1, delayMinutes: 1440, channel: 'sms', template: 'review_request', subject: '', body: 'Hi {{first_name}}, hope you are happy with your {{treatment}}. Could you leave us a Google review? {{review_link}}' },
      { order: 2, delayMinutes: 10080, channel: 'email', template: 'review_followup', subject: 'Quick favour?', body: 'Your review helps other patients...' },
    ],
  },
];

// --- Message templates --------------------------------------------------------

/** A reusable SMS/email message template. */
export interface MessageTemplate {
  id: string;
  channel: 'sms' | 'email';
  name: string;
  subject?: string;
  body: string;
}

/** Message templates — verbatim from the prototype's loadTemplates(). */
export const TEMPLATES: MessageTemplate[] = [
  { id: 't1', channel: 'sms', name: 'Welcome SMS', body: 'Hi {{first_name}}, thanks for enquiring about {{treatment}}. We will call within 1 hour. — {{practice}}' },
  { id: 't2', channel: 'email', name: 'Consultation prep', subject: 'Preparing for your consultation', body: 'Hi {{first_name}}, a few things to bring with you...' },
  { id: 't3', channel: 'sms', name: '48h reminder', body: 'Reminder: {{first_name}}, your consultation at {{practice}} is in 2 days. Reply C to confirm.' },
  { id: 't4', channel: 'sms', name: '2h reminder', body: 'See you at {{practice}} in 2 hours. Address: {{address}}' },
  { id: 't5', channel: 'email', name: 'Treatment plan ready', subject: 'Your {{treatment}} plan is ready', body: 'Please find your bespoke treatment plan attached...' },
  { id: 't6', channel: 'sms', name: 'Quote follow-up', body: 'Hi {{first_name}}, have you had a chance to look at your treatment plan? Happy to answer any questions.' },
  { id: 't7', channel: 'sms', name: 'FTA immediate', body: 'Sorry we missed you today. Reply BOOK to reschedule.' },
  { id: 't8', channel: 'email', name: 'Review request', subject: 'How was your visit?', body: 'Hi {{first_name}}, your feedback means everything to us...' },
  { id: 't9', channel: 'sms', name: 'Birthday', body: 'Happy birthday {{first_name}}! As our gift, here is 10% off your next appointment.' },
  { id: 't10', channel: 'email', name: 'Post-treatment care', subject: 'Looking after your {{treatment}}', body: 'A few tips to get the most from your treatment...' },
];

// --- Automations (Workflows) --------------------------------------------------

/** A marketing-automation workflow row. */
export interface Workflow {
  name: string;
  trigger: string;
  steps: number;
  status: 'active' | 'paused';
  sent: number;
  conversion: number;
}

/** Automation workflows — verbatim from the prototype's PAGES.workflows. */
export const WORKFLOWS: Workflow[] = [
  { name: 'New lead — instant SMS', trigger: 'Lead created', steps: 4, status: 'active', sent: 1240, conversion: 18.5 },
  { name: 'No-show recovery (FTA)', trigger: 'FTA marked', steps: 5, status: 'active', sent: 142, conversion: 32.0 },
  { name: 'Consult booked — confirmation series', trigger: 'Status: consultation_booked', steps: 6, status: 'active', sent: 980, conversion: 88.0 },
  { name: 'Treatment abandoned — re-engage', trigger: 'Status: not_proceeding 14d', steps: 3, status: 'active', sent: 320, conversion: 14.0 },
  { name: 'Birthday hygiene reminder', trigger: 'Patient birthday week', steps: 2, status: 'active', sent: 412, conversion: 18.0 },
  { name: 'Implant 6-month check-up', trigger: '6m post-treatment', steps: 3, status: 'paused', sent: 38, conversion: 65.0 },
  { name: 'Lapsed 12-month reactivation', trigger: 'No visit 12m', steps: 4, status: 'active', sent: 1840, conversion: 7.0 },
  { name: 'Review request after treatment', trigger: 'Treatment completed', steps: 2, status: 'active', sent: 680, conversion: 24.0 },
];

// --- Landing pages ------------------------------------------------------------

/** A marketing landing page row. */
export interface LandingPage {
  name: string;
  url: string;
  views: number;
  leads: number;
  conversion: number;
  template: string;
}

/** Landing pages — verbatim from the prototype's PAGES.pages. */
export const LANDING_PAGES: LandingPage[] = [
  { name: 'All-on-4 Implants — Kent', url: 'gmdental.uk/implants-kent', views: 4280, leads: 142, conversion: 3.3, template: 'Implant' },
  { name: 'Invisalign — Free Consultation', url: 'gmdental.uk/invisalign', views: 2840, leads: 89, conversion: 3.1, template: 'Orthodontics' },
  { name: 'Composite Bonding Smile Makeover', url: 'gmdental.uk/bonding', views: 1980, leads: 64, conversion: 3.2, template: 'Cosmetic' },
  { name: 'Teeth Whitening — Same Day', url: 'gmdental.uk/whitening', views: 1450, leads: 38, conversion: 2.6, template: 'Cosmetic' },
  { name: 'Emergency Dental Care', url: 'gmdental.uk/emergency', views: 920, leads: 78, conversion: 8.5, template: 'Emergency' },
  { name: 'New Patient — Free Hygiene', url: 'gmdental.uk/new-patient', views: 3200, leads: 220, conversion: 6.9, template: 'New Patient' },
];

// --- Shared time formatting ---------------------------------------------------

/** Human "x ago" label from a minutes-ago integer (prototype ageLabel). */
export function agoLabel(minutesAgo: number): string {
  if (minutesAgo < 60) return `${minutesAgo}m ago`;
  const hours = Math.floor(minutesAgo / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Signed "due in / overdue" label relative to TASK_NOW. */
export function timeFromNow(iso: string): string {
  const diffMs = new Date(iso).getTime() - TASK_NOW.getTime();
  const past = diffMs < 0;
  const mins = Math.abs(Math.round(diffMs / 60000));
  const prefix = past ? '' : 'in ';
  const suffix = past ? ' ago' : '';
  if (mins < 60) return `${prefix}${mins}m${suffix}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${prefix}${hours}h${suffix}`;
  return `${prefix}${Math.round(hours / 24)}d${suffix}`;
}

/** Short date, en-GB. */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Short date-time, en-GB. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Clock time only, en-GB. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
