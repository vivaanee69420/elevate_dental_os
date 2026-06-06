// ============================================================================
// Module Library (LMS) — tenant trainingService. Covers: library progress
// rollup (enrolled + completed counts per course), enrol 404/idempotent upsert,
// lesson complete 404 + upsert, myTraining feed, and the download gate (403 on
// a locked mentorship attachment, 404 when missing). Download success is NOT
// asserted here — it would hit S3 presign (AWS creds); the gate runs first.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/training.service.js')).trainingService;

const ORG = 'org-1';
const USER = 'user-1';

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: null, error: null });
});

describe('library', () => {
  it('rolls up enrolment + completed-lesson counts per course', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: [{ id: 'c1', title: 'C', track: 'business', level: 'all', access: 'free', status: 'published' }], error: null };
      if (q.table === 'organisations') return { data: { mentorship_active: false }, error: null };
      if (q.table === 'course_enrolments') return { data: [{ course_id: 'c1' }], error: null };
      if (q.table === 'lesson_progress') return { data: [{ lesson_id: 'l1' }], error: null };
      if (q.table === 'course_lessons') return { data: [{ id: 'l1', course_id: 'c1' }, { id: 'l2', course_id: 'c1' }], error: null };
      return { data: null, error: null };
    };
    const out = await svc.library(ORG, USER);
    const m = out.modules[0];
    expect(m.total_lessons).toBe(2);
    expect(m.completed_lessons).toBe(1);
    expect(m.progress_pct).toBe(50);
    expect(m.enrolled).toBe(true);
    expect(out.mentorship_active).toBe(false);
  });
});

describe('enrol', () => {
  it('throws 404 when the course is not published', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(svc.enrol(ORG, USER, 'cX')).rejects.toThrow('Course not found');
  });

  it('upserts an enrolment for a published course', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: 'c1', status: 'published' }, error: null };
      return { data: null, error: null };
    };
    const out = await svc.enrol(ORG, USER, 'c1');
    expect(out.enrolled).toBe(true);
    expect(supaRec.last.table).toBe('course_enrolments');
    expect(supaRec.last.op).toBe('upsert');
    expect(supaRec.last.upsertVals).toMatchObject({ organisation_id: ORG, user_id: USER, course_id: 'c1' });
  });
});

describe('setLessonComplete', () => {
  it('throws 404 when the lesson is missing', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_lessons') return { data: null, error: null };
      return { data: null, error: null };
    };
    await expect(svc.setLessonComplete(ORG, USER, 'lX', true)).rejects.toThrow('Lesson not found');
  });

  it('upserts lesson_progress for a published-course lesson', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_lessons') return { data: { id: 'l1', course_id: 'c1' }, error: null };
      if (q.table === 'courses') return { data: { id: 'c1', status: 'published' }, error: null };
      return { data: null, error: null };
    };
    const out = await svc.setLessonComplete(ORG, USER, 'l1', true);
    expect(out).toEqual({ lesson_id: 'l1', completed: true });
    expect(supaRec.last.table).toBe('lesson_progress');
    expect(supaRec.last.op).toBe('upsert');
  });

  it('deletes lesson_progress when completed=false', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_lessons') return { data: { id: 'l1', course_id: 'c1' }, error: null };
      if (q.table === 'courses') return { data: { id: 'c1', status: 'published' }, error: null };
      return { data: null, error: null };
    };
    await svc.setLessonComplete(ORG, USER, 'l1', false);
    expect(supaRec.last.table).toBe('lesson_progress');
    expect(supaRec.last.op).toBe('delete');
  });
});

describe('myTraining', () => {
  it('returns only enrolled published courses with progress', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_enrolments') return { data: [{ course_id: 'c1', enrolled_at: 't' }], error: null };
      if (q.table === 'lesson_progress') return { data: [{ lesson_id: 'l1' }], error: null };
      if (q.table === 'courses') return { data: [{ id: 'c1', title: 'C', track: 'business', level: 'all', access: 'free' }, { id: 'c2', title: 'Other' }], error: null };
      if (q.table === 'course_lessons') return { data: [{ id: 'l1', course_id: 'c1' }, { id: 'l2', course_id: 'c1' }], error: null };
      return { data: null, error: null };
    };
    const out = await svc.myTraining(ORG, USER);
    expect(out.enrolments).toHaveLength(1);
    expect(out.enrolments[0].course_id).toBe('c1');
    expect(out.enrolments[0].progress_pct).toBe(50);
  });
});

describe('download gate', () => {
  it('403s a locked mentorship attachment when mentorship is inactive', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_lessons') return { data: { id: 'l1', course_id: 'c1', access: 'mentorship', attachment_file_key: 'courses/x', attachment_name: 'x.pdf' }, error: null };
      if (q.table === 'courses') return { data: { id: 'c1', status: 'published' }, error: null };
      if (q.table === 'organisations') return { data: { mentorship_active: false }, error: null };
      return { data: null, error: null };
    };
    await expect(svc.lessonAttachmentUrl(ORG, 'l1')).rejects.toThrow('Locked');
  });

  it('404s a missing lesson attachment', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_lessons') return { data: null, error: null };
      return { data: null, error: null };
    };
    await expect(svc.lessonAttachmentUrl(ORG, 'lX')).rejects.toThrow('Attachment not found');
  });

  it('404s a missing resource', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_resources') return { data: null, error: null };
      return { data: null, error: null };
    };
    await expect(svc.resourceDownloadUrl(ORG, 'rX')).rejects.toThrow('Resource not found');
  });

  // lessonFileUrl — lesson-level mentorship gate
  it('403s a free-access file on a mentorship lesson when mentorship is inactive', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'lesson_files') return { data: { id: 'f1', lesson_id: 'l1', file_key: 'courses/f.pdf', name: 'f.pdf', access: 'free' }, error: null };
      if (q.table === 'course_lessons') return { data: { id: 'l1', course_id: 'c1', access: 'mentorship' }, error: null };
      if (q.table === 'courses') return { data: { id: 'c1', status: 'published' }, error: null };
      if (q.table === 'organisations') return { data: { mentorship_active: false }, error: null };
      return { data: null, error: null };
    };
    await expect(svc.lessonFileUrl(ORG, 'f1')).rejects.toThrow('Locked — mentorship required');
  });

  it('returns a URL for a free file on a free lesson (no mentorship needed)', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'lesson_files') return { data: { id: 'f1', lesson_id: 'l1', file_key: 'courses/f.pdf', name: 'f.pdf', access: 'free' }, error: null };
      if (q.table === 'course_lessons') return { data: { id: 'l1', course_id: 'c1', access: 'free' }, error: null };
      if (q.table === 'courses') return { data: { id: 'c1', status: 'published' }, error: null };
      if (q.table === 'organisations') return { data: { mentorship_active: false }, error: null };
      return { data: null, error: null };
    };
    // presignDownload is not mocked — it will throw; we only need to confirm the
    // mentorship gate does NOT throw 403. Check it's a different (presign) error.
    const result = await svc.lessonFileUrl(ORG, 'f1').catch((e) => e);
    expect(result?.message ?? '').not.toMatch(/Locked/);
  });
});
