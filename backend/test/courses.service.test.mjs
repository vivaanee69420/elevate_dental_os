// ============================================================================
// Module Library (LMS) — course.service. Covers: global (no org_id) course
// create with created_by, 404 on missing course, full getCourse aggregation,
// append-at-end lesson positioning, status guard, and reorder 404 guard.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const svc = (await import('../src/services/course.service.js')).courseService;

const COURSE = 'course-1';
const ADMIN = { id: 'admin-1', role: 'superadmin' };

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: null, error: null });
});

describe('createCourse', () => {
  it('inserts a GLOBAL row (no organisation_id) with created_by = admin id', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses' && q.insertVals) {
        insertVals = q.insertVals;
        return { data: { id: COURSE, ...q.insertVals }, error: null };
      }
      return { data: null, error: null };
    };
    await svc.createCourse({ title: 'Reading Your Numbers', track: 'business-health' }, ADMIN);
    expect(insertVals.title).toBe('Reading Your Numbers');
    expect(insertVals.created_by).toBe('admin-1');
    expect(insertVals).not.toHaveProperty('organisation_id');
  });
});

describe('getCourse', () => {
  it('throws 404 when the course is missing', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(svc.getCourse(COURSE)).rejects.toThrow('Course not found');
  });

  it('aggregates course + ordered lessons + resources', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C', status: 'draft' }, error: null };
      if (q.table === 'course_lessons') return { data: [{ id: 'l1', title: 'Intro' }], error: null };
      if (q.table === 'course_resources') return { data: [{ id: 'r1', name: 'Guide.pdf' }], error: null };
      return { data: null, error: null };
    };
    const out = await svc.getCourse(COURSE);
    expect(out.id).toBe(COURSE);
    expect(out.lessons).toHaveLength(1);
    expect(out.resources[0].name).toBe('Guide.pdf');
  });
});

describe('addLesson', () => {
  it('appends at maxPosition + 1 and scopes to the course', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C' }, error: null };
      if (q.table === 'course_lessons') {
        if (q.insertVals) {
          insertVals = q.insertVals;
          return { data: { id: 'l9', ...q.insertVals }, error: null };
        }
        return { data: { position: 2 }, error: null }; // maxLessonPosition read
      }
      return { data: null, error: null };
    };
    await svc.addLesson(COURSE, { title: 'Lesson 3', access: 'free' });
    expect(insertVals.position).toBe(3);
    expect(insertVals.course_id).toBe(COURSE);
  });

  it('throws 404 when adding a lesson to a missing course', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(svc.addLesson(COURSE, { title: 'x' })).rejects.toThrow('Course not found');
  });
});

describe('setStatus', () => {
  it('rejects an unknown status', async () => {
    await expect(svc.setStatus(COURSE, 'archived')).rejects.toThrow('status must be');
  });

  it('publishes via an update', async () => {
    let updateVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses' && q.updateVals) {
        updateVals = q.updateVals;
        return { data: { id: COURSE, status: 'published' }, error: null };
      }
      return { data: null, error: null };
    };
    const out = await svc.setStatus(COURSE, 'published');
    expect(updateVals.status).toBe('published');
    expect(out.status).toBe('published');
  });
});

describe('reorderLessons', () => {
  it('throws 404 when the course is missing', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(svc.reorderLessons(COURSE, ['l1', 'l2'])).rejects.toThrow('Course not found');
  });
});

describe('addModule', () => {
  it('appends at maxModulePosition + 1 and scopes to the course', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C' }, error: null };
      if (q.table === 'course_modules') {
        if (q.insertVals) {
          insertVals = q.insertVals;
          return { data: { id: 'm9', ...q.insertVals }, error: null };
        }
        return { data: { position: 1 }, error: null }; // maxModulePosition read
      }
      return { data: null, error: null };
    };
    await svc.addModule(COURSE, { title: 'Module 2', access: 'free' });
    expect(insertVals.position).toBe(2);
    expect(insertVals.course_id).toBe(COURSE);
  });

  it('throws 404 when the course is missing', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(svc.addModule(COURSE, { title: 'x' })).rejects.toThrow('Course not found');
  });
});

describe('reorderModules', () => {
  it('throws 404 when the course is missing', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(svc.reorderModules(COURSE, ['m1', 'm2'])).rejects.toThrow('Course not found');
  });
});
