// Training feature mock-data layer — pixel-faithful port of the
// Plan4Growth Academy fixtures in preview/elevate-dental-os-v2.html
// (TRAINING_MODULES, MENTORSHIP_CALLS, ONE_TO_ONE_SLOTS,
// getMentorshipStatus, getModuleProgress).
//
// The prototype persists progress/bookings in localStorage; this port
// holds a static, deterministic snapshot (no API, no persistence) so the
// four Training screens render identically across renders. When real
// endpoints land, screens swap this module for a data hook; the exported
// shapes stay stable.
//
// "Italy Implant Residency" is intentionally excluded (project rule 6) —
// it does not appear in the prototype's module list and is not added here.

/** A single lesson inside a training module. */
export interface Lesson {
  id: string;
  title: string;
  duration: string;
  type: 'video';
  access: 'free' | 'mentorship';
  teaser?: string;
}

/** A downloadable module resource. */
export interface ModuleResource {
  name: string;
  type: string;
  size: string;
  access: 'free' | 'mentorship';
}

/** A Plan4Growth Academy training module. */
export interface TrainingModule {
  id: string;
  track:
    | 'foundations'
    | 'business-health'
    | 'marketing'
    | 'implants'
    | 'business'
    | 'sales';
  title: string;
  duration: string;
  level: string;
  access: 'free' | 'mentorship';
  featured?: boolean;
  desc: string;
  instructor: string;
  instructorTitle: string;
  outcome: string;
  lessons: Lesson[];
  resources: ModuleResource[];
}

/**
 * Build a generated lesson list (mirrors the prototype's
 * Array.from({length}, ...) pattern for the longer mentorship modules).
 */
function lessons(titles: string[], baseStep: number): Lesson[] {
  return titles.map((title, i) => ({
    id: `l${i + 1}`,
    title,
    duration: `${baseStep + (i % 8) * 2} min`,
    type: 'video' as const,
    access: 'mentorship' as const,
  }));
}

/**
 * The full module catalogue, in prototype order: four free foundation
 * modules then the mentorship-only library.
 */
export const TRAINING_MODULES: TrainingModule[] = [
  {
    id: 'm01',
    track: 'foundations',
    title: 'Welcome to Plan4Growth',
    duration: '12 min',
    level: 'all',
    access: 'free',
    desc: 'Orientation + how to get the most out of the platform.',
    instructor: 'Gaurav Mehta',
    instructorTitle: 'CEO, GM Dental Group · 1,000+ implants/year',
    outcome:
      "You'll know exactly how to use Plan4Growth to grow your practice.",
    lessons: [
      {
        id: 'l1',
        title: "Welcome — what you'll get from this",
        duration: '3 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l2',
        title: 'Tour: dashboard, training, mentorship',
        duration: '5 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l3',
        title: 'Your 30-day quick win plan',
        duration: '4 min',
        type: 'video',
        access: 'free',
      },
    ],
    resources: [
      {
        name: 'Plan4Growth Quick Start Guide',
        type: 'pdf',
        size: '1.2 MB',
        access: 'free',
      },
      {
        name: '30-Day Action Plan Template',
        type: 'pdf',
        size: '480 KB',
        access: 'free',
      },
    ],
  },
  {
    id: 'm02',
    track: 'foundations',
    title: 'CEO Mindset Reset',
    duration: '38 min',
    level: 'all',
    access: 'free',
    desc: 'Why most dentists stay stuck as technicians. The mindset shift to running a real business.',
    instructor: 'Gaurav Mehta',
    instructorTitle: 'CEO, GM Dental Group',
    outcome:
      'Stop being the busiest dentist in the building. Start being the owner.',
    lessons: [
      {
        id: 'l1',
        title: 'The technician trap',
        duration: '7 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l2',
        title: 'The 3-pillar framework',
        duration: '8 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l3',
        title: 'The CEO 3 Block',
        duration: '6 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l4',
        title: 'Your first week as a CEO',
        duration: '5 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l5',
        title: 'The Delegation Decision Matrix',
        duration: '12 min',
        type: 'video',
        access: 'mentorship',
        teaser:
          "Most owners never delegate properly because they don't know what to keep. This matrix shows you exactly.",
      },
    ],
    resources: [
      {
        name: 'CEO Mindset Workbook',
        type: 'pdf',
        size: '2.1 MB',
        access: 'free',
      },
      {
        name: 'CEO 3 Block weekly planner',
        type: 'pdf',
        size: '380 KB',
        access: 'free',
      },
      {
        name: 'Delegation Decision Matrix (Excel)',
        type: 'xlsx',
        size: '120 KB',
        access: 'mentorship',
      },
      {
        name: 'Owner-to-CEO 90-day roadmap',
        type: 'pdf',
        size: '3.4 MB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm03',
    track: 'business-health',
    title: 'Reading Your Numbers',
    duration: '52 min',
    level: 'beginner',
    access: 'free',
    desc: 'P&L, gross margin, net margin, EBITDA. The 4 numbers every UK dental owner must know.',
    instructor: 'Shishir Khadka FCCA',
    instructorTitle: 'Group Accountant · Elevate Accounts',
    outcome: "Read your P&L in 60 seconds and spot what's leaking money.",
    lessons: [
      {
        id: 'l1',
        title: 'The 4 numbers that matter',
        duration: '8 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l2',
        title: 'Where dental practices leak money',
        duration: '11 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l3',
        title: 'Build your own P&L in Excel',
        duration: '14 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l4',
        title: 'Your first benchmark check',
        duration: '7 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l5',
        title: '13-week cash flow modelling',
        duration: '18 min',
        type: 'video',
        access: 'mentorship',
        teaser:
          'Stop running out of cash. Build a rolling forecast that predicts shortfalls 90 days out.',
      },
      {
        id: 'l6',
        title: 'EBITDA add-backs for valuation',
        duration: '14 min',
        type: 'video',
        access: 'mentorship',
        teaser:
          'Add £40-200k to your valuation legally. Every add-back UK buyers accept.',
      },
    ],
    resources: [
      {
        name: 'Dental P&L Template (Excel)',
        type: 'xlsx',
        size: '85 KB',
        access: 'free',
      },
      {
        name: 'UK Dental Benchmark Card',
        type: 'pdf',
        size: '320 KB',
        access: 'free',
      },
      {
        name: '13-Week Cash Flow Model (Excel)',
        type: 'xlsx',
        size: '210 KB',
        access: 'mentorship',
      },
      {
        name: 'EBITDA Add-Back Checklist',
        type: 'pdf',
        size: '480 KB',
        access: 'mentorship',
      },
      {
        name: 'Practice Valuation Calculator',
        type: 'xlsx',
        size: '340 KB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm04',
    track: 'marketing',
    title: 'Lead Sources 101',
    duration: '28 min',
    level: 'beginner',
    access: 'free',
    desc: 'Which channels actually work for UK dental in 2026. Stop wasting money.',
    instructor: 'Nadia Reinolds',
    instructorTitle: 'Co-founder, Plan4Growth Academy',
    outcome: 'Know which 3 channels to focus on for your stage and budget.',
    lessons: [
      {
        id: 'l1',
        title: 'The 8 lead sources for UK dental',
        duration: '6 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l2',
        title: 'What "good" looks like by channel',
        duration: '8 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l3',
        title: 'Picking your first 3 channels',
        duration: '7 min',
        type: 'video',
        access: 'free',
      },
      {
        id: 'l4',
        title: 'Google Ads campaign structure that works',
        duration: '24 min',
        type: 'video',
        access: 'mentorship',
        teaser:
          'The exact campaign structure that delivers £150 CPL for implants. Screen-share walkthrough.',
      },
      {
        id: 'l5',
        title: 'Instagram Authority Sprint preview',
        duration: '15 min',
        type: 'video',
        access: 'mentorship',
        teaser:
          'How Gaurav grew @gauravmehta.dental to 80k in 11 months. Full system in module 17.',
      },
    ],
    resources: [
      {
        name: 'Channel Decision Worksheet',
        type: 'pdf',
        size: '210 KB',
        access: 'free',
      },
      {
        name: 'UK Dental Lead Benchmarks 2026',
        type: 'pdf',
        size: '440 KB',
        access: 'free',
      },
      {
        name: 'Google Ads Account Template',
        type: 'pdf',
        size: '1.1 MB',
        access: 'mentorship',
      },
      {
        name: 'Meta Ads Creative Swipe File (60 ads)',
        type: 'pdf',
        size: '8.2 MB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm10',
    track: 'implants',
    title: 'Implant Master Playbook',
    duration: '4h 20m',
    level: 'intermediate',
    access: 'mentorship',
    featured: true,
    desc: 'The complete £200k/month implant pillar — from lead capture to All-on-4 close.',
    instructor: 'Gaurav Mehta',
    instructorTitle: 'CEO, GM Dental Group · 1,000+ implants/year',
    outcome: 'Build a £200k/month implant pillar in 12 months.',
    lessons: lessons(
      [
        'The implant economics model',
        'Lead capture: the 5-second rule',
        'TCO call: 9-question qualification',
        'Consultation room setup',
        'The CT scan walk-through script',
        'Treatment plan presentation',
        'Pricing & finance options',
        'Handling "I need to think about it"',
        'Deposit collection (same-day)',
        'Day-of-surgery patient flow',
        'Post-op care + retention',
        'Reviews & referral systems',
        'Case study: £1.2M year from scratch',
        'Live Q&A: Round 1',
      ],
      12,
    ),
    resources: [
      {
        name: 'TCO Qualification Script',
        type: 'pdf',
        size: '680 KB',
        access: 'mentorship',
      },
      {
        name: 'Treatment Plan Template (editable)',
        type: 'docx',
        size: '210 KB',
        access: 'mentorship',
      },
      {
        name: 'Consultation Room Setup Checklist',
        type: 'pdf',
        size: '480 KB',
        access: 'mentorship',
      },
      {
        name: 'Implant Economics Calculator',
        type: 'xlsx',
        size: '180 KB',
        access: 'mentorship',
      },
      {
        name: 'Patient Finance Comparison Sheet',
        type: 'pdf',
        size: '320 KB',
        access: 'mentorship',
      },
      {
        name: 'Day-of-Surgery SOP',
        type: 'pdf',
        size: '1.4 MB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm11',
    track: 'implants',
    title: 'All-on-4 Accelerator',
    duration: '3h 10m',
    level: 'advanced',
    access: 'mentorship',
    desc: 'Day-of-surgery protocol + same-day teeth. Filmed live at Warwick Lodge.',
    instructor: 'Gaurav Mehta',
    instructorTitle: 'CEO, GM Dental Group',
    outcome: 'Run a profitable All-on-4 day, week after week.',
    lessons: lessons(
      [
        'Patient selection criteria',
        'Pre-surgical planning',
        'Surgical guide design',
        'Anaesthesia & comfort',
        'Implant placement sequence',
        'Immediate loading workflow',
        'Same-day prosthetic delivery',
        'Post-op review schedule',
        'Complications & how to handle them',
        '12-month follow-up protocol',
        'Marketing All-on-4 specifically',
        'Pricing & finance plans',
        'Live case: Mr H from start to finish',
        'Team training for All-on-4 days',
      ],
      10,
    ),
    resources: [
      {
        name: 'All-on-4 Patient Selection Form',
        type: 'pdf',
        size: '320 KB',
        access: 'mentorship',
      },
      {
        name: 'Same-Day Workflow SOP',
        type: 'pdf',
        size: '2.1 MB',
        access: 'mentorship',
      },
      {
        name: 'Surgical Kit Checklist',
        type: 'pdf',
        size: '180 KB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm12',
    track: 'implants',
    title: 'Single Tooth Masterclass',
    duration: '2h 45m',
    level: 'beginner',
    access: 'mentorship',
    desc: 'Surgical, restorative, billing. £2,850 case from start to finish.',
    instructor: 'Gaurav Mehta',
    instructorTitle: 'CEO, GM Dental Group',
    outcome: 'Confidently place + restore single implants profitably.',
    lessons: lessons(
      [
        'Case assessment',
        '3D planning basics',
        'Surgical site preparation',
        'Implant placement (filmed)',
        'Healing protocol',
        'Impression-taking',
        'Crown design',
        'Cementation vs screw-retained',
        'The £2,850 fee build',
        'Patient finance conversations',
        'Common complications',
        'Long-term maintenance',
      ],
      10,
    ),
    resources: [
      {
        name: 'Single Implant Case Plan Template',
        type: 'pdf',
        size: '420 KB',
        access: 'mentorship',
      },
      {
        name: 'Fee Build Calculator',
        type: 'xlsx',
        size: '140 KB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm13',
    track: 'business',
    title: 'Practice Freedom Formula',
    duration: '5h 50m',
    level: 'all',
    access: 'mentorship',
    desc: 'Systemise everything. Step-by-step to remove yourself from daily ops.',
    instructor: 'Nadia Reinolds',
    instructorTitle: 'Co-founder, Plan4Growth Academy',
    outcome: 'Work IN your practice 2 days/week. Profit goes UP.',
    lessons: lessons(
      [
        'The Freedom Map exercise',
        'Identify the 12 weekly recurring tasks',
        'SOP-writing 101',
        'Filming SOPs on your phone',
        'The 90-day systemisation sprint',
        'Hiring your first PM',
        'PM onboarding playbook',
        'The weekly 1-1 rhythm',
        'Monthly KPI review template',
        'Reception scripts pack',
        'Treatment co-ordinator role',
        'Hygiene therapist economics',
        'Associate retention systems',
        'Practice culture document',
        'Patient journey map',
        'Recall systems that work',
        'Complaints handling SOP',
        'Financial controls',
        'Software stack audit',
        'Time tracking yourself',
        'The "fire yourself" calendar',
        '30-60-90 day check-ins',
        'Hitting Practice Freedom',
        'Maintaining Freedom (forever)',
      ],
      10,
    ),
    resources: [
      {
        name: 'Practice Freedom Diagnostic',
        type: 'pdf',
        size: '880 KB',
        access: 'mentorship',
      },
      {
        name: '50 Pre-Built SOP Templates',
        type: 'zip',
        size: '14 MB',
        access: 'mentorship',
      },
      {
        name: 'PM Hiring Pack (job spec, interview, scorecards)',
        type: 'zip',
        size: '6.4 MB',
        access: 'mentorship',
      },
      {
        name: 'Reception Scripts Pack',
        type: 'pdf',
        size: '2.8 MB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm14',
    track: 'business',
    title: 'Diploma in Integrative Dental Medicine',
    duration: '40h+',
    level: 'advanced',
    access: 'mentorship',
    desc: 'EduQual Level 7 accredited. Biological Clinician curriculum.',
    instructor: 'Dr John Roberts',
    instructorTitle: 'Clinical Director, Biological Clinician',
    outcome: 'EduQual Level 7 qualification + Biological Clinician status.',
    lessons: Array.from({ length: 60 }, (_, i) => ({
      id: `l${i + 1}`,
      title: `Unit ${Math.floor(i / 6) + 1}, Lesson ${(i % 6) + 1}`,
      duration: '40 min',
      type: 'video' as const,
      access: 'mentorship' as const,
    })),
    resources: [
      {
        name: 'Diploma Handbook (240 pages)',
        type: 'pdf',
        size: '32 MB',
        access: 'mentorship',
      },
      {
        name: 'Assessment Rubric',
        type: 'pdf',
        size: '1.1 MB',
        access: 'mentorship',
      },
      {
        name: 'Biological Materials Reference',
        type: 'pdf',
        size: '8.4 MB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm15',
    track: 'sales',
    title: 'Treatment Plan Presentation',
    duration: '1h 50m',
    level: 'intermediate',
    access: 'mentorship',
    desc: 'The TCO script that converts 47% of high-value consultations.',
    instructor: 'Nadia Reinolds',
    instructorTitle: 'Co-founder, Plan4Growth',
    outcome: 'Double your consultation-to-treatment conversion.',
    lessons: lessons(
      [
        'Pre-consultation prep',
        'The first 90 seconds',
        'Discovery: 9-question script',
        'Reveal: how to show the plan',
        'Pricing without flinching',
        'Handling objections',
        'Closing for deposit',
        "Follow-up if they don't commit",
      ],
      10,
    ),
    resources: [
      {
        name: 'Full TCO Script (15 pages)',
        type: 'pdf',
        size: '680 KB',
        access: 'mentorship',
      },
      {
        name: 'Objection Handler Flashcards',
        type: 'pdf',
        size: '420 KB',
        access: 'mentorship',
      },
      {
        name: 'Follow-Up Email Templates (12)',
        type: 'docx',
        size: '180 KB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm16',
    track: 'sales',
    title: 'Pricing & Finance Conversations',
    duration: '1h 20m',
    level: 'intermediate',
    access: 'mentorship',
    desc: 'Handle "it\'s too expensive" without dropping your prices.',
    instructor: 'Nadia Reinolds',
    instructorTitle: 'Co-founder, Plan4Growth',
    outcome: 'Stop discounting. Start qualifying.',
    lessons: lessons(
      [
        'Why patients say "too expensive"',
        'The reframe technique',
        'Comparing to alternatives',
        'Patient finance options walk-through',
        'When to walk away',
        'Following up the "thinkers"',
      ],
      10,
    ),
    resources: [
      {
        name: 'Pricing Objection Playbook',
        type: 'pdf',
        size: '540 KB',
        access: 'mentorship',
      },
      {
        name: 'Finance Provider Comparison Chart',
        type: 'pdf',
        size: '210 KB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm17',
    track: 'marketing',
    title: 'Instagram Authority Sprint',
    duration: '2h 30m',
    level: 'all',
    access: 'mentorship',
    featured: true,
    desc: '60 Reels in 30 days. The exact system used to grow @gauravmehta.dental to 80k.',
    instructor: 'Gaurav Mehta',
    instructorTitle: 'CEO, GM Dental Group',
    outcome: '10k+ followers in 90 days + leads coming from Instagram.',
    lessons: lessons(
      [
        'The authority positioning',
        'Content pillar system',
        'Hook-script-CTA framework',
        'Batch filming day setup',
        'Editing in 8 minutes',
        'Captions + hashtags 2026',
        'Posting schedule + analytics',
        'DM conversion strategy',
        'Story sales funnel',
        'Scaling beyond 10k',
      ],
      10,
    ),
    resources: [
      {
        name: '60 Reels Content Calendar',
        type: 'pdf',
        size: '1.2 MB',
        access: 'mentorship',
      },
      {
        name: 'Hook Library (200 hooks)',
        type: 'pdf',
        size: '720 KB',
        access: 'mentorship',
      },
      {
        name: 'Batch Filming Day Checklist',
        type: 'pdf',
        size: '180 KB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm18',
    track: 'marketing',
    title: 'Google Ads for Dentists',
    duration: '3h',
    level: 'intermediate',
    access: 'mentorship',
    desc: 'Campaign structure, keywords, landing pages, conversion tracking.',
    instructor: 'Nikhil Sharma',
    instructorTitle: 'Plan4Growth Tech Lead',
    outcome: 'Run profitable Google Ads without an agency.',
    lessons: lessons(
      [
        'Account structure for dental',
        'Keyword research walkthrough',
        'Negative keyword lists',
        'Ad copy that converts',
        'Landing page essentials',
        'Conversion tracking setup',
        'Quality Score optimisation',
        'Bid strategies explained',
        'Budget allocation',
        'Reading the data weekly',
        'When to scale, when to cut',
        'Common mistakes & fixes',
      ],
      12,
    ),
    resources: [
      {
        name: 'Account Structure Template',
        type: 'xlsx',
        size: '210 KB',
        access: 'mentorship',
      },
      {
        name: '500 Dental Keywords (sorted)',
        type: 'xlsx',
        size: '180 KB',
        access: 'mentorship',
      },
      {
        name: 'Negative Keyword Master List',
        type: 'csv',
        size: '40 KB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm19',
    track: 'business-health',
    title: 'Financial Modelling for Dental',
    duration: '2h 50m',
    level: 'advanced',
    access: 'mentorship',
    desc: '13-week cash flow, scenario planning, valuation modelling.',
    instructor: 'Shishir Khadka FCCA',
    instructorTitle: 'Group Accountant',
    outcome: 'Build the financial model that runs your business.',
    lessons: lessons(
      [
        'Model architecture overview',
        '13-week cash flow build',
        'Revenue forecasting',
        'Cost forecasting',
        'Scenario planning (3 cases)',
        'Valuation: principal-led',
        'Valuation: associate-led',
        'Valuation: DSO buyer',
        'EBITDA add-back rules',
        'Sensitivity analysis',
        'Live model walkthrough',
      ],
      12,
    ),
    resources: [
      {
        name: 'Full Financial Model (Excel)',
        type: 'xlsx',
        size: '480 KB',
        access: 'mentorship',
      },
      {
        name: 'Valuation Calculator',
        type: 'xlsx',
        size: '320 KB',
        access: 'mentorship',
      },
      {
        name: 'EBITDA Add-Back Reference',
        type: 'pdf',
        size: '640 KB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm20',
    track: 'business',
    title: 'Hiring & Building Your Team',
    duration: '2h 10m',
    level: 'intermediate',
    access: 'mentorship',
    desc: 'Recruit, onboard, retain. The CEO 3 Block delegation framework.',
    instructor: 'Nadia Reinolds',
    instructorTitle: 'Co-founder, Plan4Growth',
    outcome: 'Stop firefighting hiring. Build a team that runs itself.',
    lessons: lessons(
      [
        'Writing a job spec that pulls A-players',
        'Sourcing: where the good ones are',
        'Interview structure (90 min)',
        'Scorecards & references',
        'First-week onboarding',
        '30-60-90 day check-ins',
        'When to fire (and how)',
        'Pay structures that motivate',
        'The retention rituals',
      ],
      12,
    ),
    resources: [
      {
        name: 'Job Spec Library (12 roles)',
        type: 'zip',
        size: '4.2 MB',
        access: 'mentorship',
      },
      {
        name: 'Interview Scorecards',
        type: 'xlsx',
        size: '180 KB',
        access: 'mentorship',
      },
      {
        name: '30-60-90 Day Plan Template',
        type: 'docx',
        size: '120 KB',
        access: 'mentorship',
      },
    ],
  },
  {
    id: 'm21',
    track: 'business',
    title: 'Multi-Practice Group Building',
    duration: '3h 40m',
    level: 'advanced',
    access: 'mentorship',
    desc: 'From 1 → 5 practices. Acquisition, integration, group economics.',
    instructor: 'Gaurav Mehta',
    instructorTitle: 'CEO, GM Dental Group (5 practices)',
    outcome: 'Buy practice #2 in the next 12 months.',
    lessons: lessons(
      [
        'Why scale: the economics',
        'Sourcing acquisition targets',
        'Valuing a target',
        'Negotiation tactics',
        'Due diligence checklist',
        'Funding options (bank, MBO, JV)',
        'Day-1 integration plan',
        'Days 2-90 integration',
        'Team retention during transition',
        'Brand strategy: keep or merge',
        'Group operations setup',
        'Group financial reporting',
        'Cash management at group level',
        'Building toward exit',
        'Live case: how GM Dental did it',
      ],
      12,
    ),
    resources: [
      {
        name: 'Acquisition Target Sourcing Playbook',
        type: 'pdf',
        size: '2.1 MB',
        access: 'mentorship',
      },
      {
        name: 'Due Diligence Checklist',
        type: 'pdf',
        size: '880 KB',
        access: 'mentorship',
      },
      {
        name: 'Deal Valuation Model',
        type: 'xlsx',
        size: '420 KB',
        access: 'mentorship',
      },
      {
        name: 'Day-1 Integration SOP',
        type: 'pdf',
        size: '1.6 MB',
        access: 'mentorship',
      },
    ],
  },
];

/** A scheduled group mentorship call. */
export interface MentorshipCall {
  id: string;
  title: string;
  host: string;
  when: string;
  duration: number;
  type: 'group';
  spots: number | 'unlimited';
  desc: string;
}

/** Upcoming group calls (prototype MENTORSHIP_CALLS). */
export const MENTORSHIP_CALLS: MentorshipCall[] = [
  {
    id: 'c01',
    title: 'Monthly CEO Round Table',
    host: 'Gaurav Mehta',
    when: '2026-05-22T19:00:00',
    duration: 90,
    type: 'group',
    spots: 'unlimited',
    desc: 'Open Q&A with all mentorship members. Bring one challenge, leave with action steps.',
  },
  {
    id: 'c02',
    title: 'Implant Case Review Live',
    host: 'Gaurav Mehta',
    when: '2026-05-26T19:00:00',
    duration: 60,
    type: 'group',
    spots: 12,
    desc: 'Submit a case in advance — Gaurav reviews live. 12 spots only.',
  },
  {
    id: 'c03',
    title: 'Numbers Clinic with Shishir',
    host: 'Shishir Khadka FCCA',
    when: '2026-05-28T18:00:00',
    duration: 60,
    type: 'group',
    spots: 'unlimited',
    desc: "Open P&L review. Bring last month's numbers, get accountant-grade feedback.",
  },
  {
    id: 'c04',
    title: 'TCO Sales Lab',
    host: 'Nadia Reinolds',
    when: '2026-06-03T19:00:00',
    duration: 75,
    type: 'group',
    spots: 'unlimited',
    desc: 'Roleplay treatment plan presentations. Sharpen your close rate.',
  },
  {
    id: 'c05',
    title: 'Marketing Hot Seat',
    host: 'Gaurav Mehta + Nadia',
    when: '2026-06-10T19:00:00',
    duration: 90,
    type: 'group',
    spots: 6,
    desc: '6 members present their marketing. Live critique + action plan. 6 spots, first-come.',
  },
];

/** A bookable private 1-to-1 coaching slot. */
export interface OneToOneSlot {
  id: string;
  date: string;
  time: string;
  duration: number;
  with: string;
  topic: string;
}

/** Available 1-to-1 slots over the next 7 days (prototype ONE_TO_ONE_SLOTS). */
export const ONE_TO_ONE_SLOTS: OneToOneSlot[] = [
  { id: 's1', date: '2026-05-19', time: '08:00', duration: 60, with: 'Gaurav Mehta', topic: 'Strategic / Implant clinical' },
  { id: 's2', date: '2026-05-19', time: '17:30', duration: 60, with: 'Gaurav Mehta', topic: 'Strategic / Implant clinical' },
  { id: 's3', date: '2026-05-20', time: '08:00', duration: 45, with: 'Nadia Reinolds', topic: 'Sales / Marketing / Team' },
  { id: 's4', date: '2026-05-20', time: '12:00', duration: 45, with: 'Nadia Reinolds', topic: 'Sales / Marketing / Team' },
  { id: 's5', date: '2026-05-21', time: '09:00', duration: 60, with: 'Shishir Khadka FCCA', topic: 'Financials / Accounts / Tax' },
  { id: 's6', date: '2026-05-21', time: '15:00', duration: 60, with: 'Gaurav Mehta', topic: 'Strategic / Implant clinical' },
  { id: 's7', date: '2026-05-22', time: '08:30', duration: 45, with: 'Nadia Reinolds', topic: 'Sales / Marketing / Team' },
  { id: 's8', date: '2026-05-23', time: '10:00', duration: 60, with: 'Gaurav Mehta', topic: 'Strategic / Implant clinical' },
];

/** Mentorship membership status (prototype getMentorshipStatus default). */
export const MENTORSHIP_STATUS = {
  active: true,
  tier: 'Diploma Member',
  renewedAt: '2026-01-15',
  renewsAt: '2027-01-15',
  monthlyValue: 497,
} as const;

/** Per-module learning progress, keyed by module id. */
export interface ModuleProgress {
  started: boolean;
  completedLessons: number;
}

/**
 * Deterministic snapshot of the owner's module progress. Mirrors the
 * "demo data" feel of the prototype: a couple of modules in progress,
 * one finished, the rest untouched. (The prototype reads localStorage;
 * here it is a fixed mock so the screens render consistently.)
 */
export const MODULE_PROGRESS: Record<string, ModuleProgress> = {
  m01: { started: true, completedLessons: 3 }, // completed (3/3)
  m02: { started: true, completedLessons: 2 }, // in progress (2/5)
  m03: { started: true, completedLessons: 1 }, // in progress (1/6)
  m10: { started: true, completedLessons: 5 }, // in progress (5/14)
};

/** Look up progress for a module; defaults to "not started". */
export function getModuleProgress(moduleId: string): ModuleProgress {
  return MODULE_PROGRESS[moduleId] ?? { started: false, completedLessons: 0 };
}

/**
 * A booked call (group or 1-to-1). The prototype seeds none by default;
 * we mirror that — the upcoming-calls list starts empty so the booking
 * UI states render exactly as in the prototype's fresh state.
 */
export interface Booking {
  id: string;
  title: string;
  host: string;
  when: string;
  duration: number;
  type: 'group' | '1to1';
}

/** Seeded bookings (empty by default, matching the prototype). */
export const BOOKINGS: Booking[] = [];

/** Format an ISO datetime to a short en-GB month, e.g. "May". */
export function gbMonthShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short' });
}

/** Format an ISO datetime to a short en-GB weekday, e.g. "Fri". */
export function gbWeekdayShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short' });
}

/** Format an ISO datetime to a 2-digit en-GB time, e.g. "19:00". */
export function gbTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
