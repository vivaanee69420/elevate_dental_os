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
      if (q.table === 'course_modules') return { data: [{ id: 'mod-1', title: 'M1', position: 0 }], error: null };
      if (q.table === 'course_lessons') return { data: [{ id: 'l1', module_id: 'mod-1', title: 'Intro', position: 0 }], error: null };
      if (q.table === 'lesson_files') return { data: [], error: null };
      if (q.table === 'course_resources') return { data: [{ id: 'r1', name: 'Guide.pdf' }], error: null };
      return { data: null, error: null };
    };
    const out = await svc.getCourse(COURSE);
    expect(out.id).toBe(COURSE);
    expect(out.modules[0].lessons).toHaveLength(1);
    expect(out.resources[0].name).toBe('Guide.pdf');
  });
});

describe('addLesson', () => {
  it('appends at maxPosition + 1 and scopes to the course', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C' }, error: null };
      if (q.table === 'course_modules') return { data: { id: 'module-1', course_id: COURSE }, error: null };
      if (q.table === 'course_lessons') {
        if (q.insertVals) {
          insertVals = q.insertVals;
          return { data: { id: 'l9', ...q.insertVals }, error: null };
        }
        return { data: { position: 2 }, error: null }; // maxLessonPosition read
      }
      return { data: null, error: null };
    };
    await svc.addLesson(COURSE, 'module-1', { title: 'Lesson 3', access: 'free' });
    expect(insertVals.position).toBe(3);
    expect(insertVals.course_id).toBe(COURSE);
  });

  it('throws 404 when adding a lesson to a missing course', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(svc.addLesson(COURSE, 'module-1', { title: 'x' })).rejects.toThrow('Course not found');
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
  it('throws 404 when the module is missing or belongs to another course', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    await expect(svc.reorderLessons(COURSE, 'module-1', ['l1', 'l2'])).rejects.toThrow('Module not found');
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

const MODULE = 'module-1';

describe('addLesson (module-scoped)', () => {
  it('validates the module belongs to the course and appends at maxPosition + 1', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C' }, error: null };
      if (q.table === 'course_modules') return { data: { id: MODULE, course_id: COURSE }, error: null };
      if (q.table === 'course_lessons') {
        if (q.insertVals) {
          insertVals = q.insertVals;
          return { data: { id: 'l9', ...q.insertVals }, error: null };
        }
        return { data: { position: 0 }, error: null }; // maxLessonPosition read
      }
      return { data: null, error: null };
    };
    await svc.addLesson(COURSE, MODULE, { title: 'Lesson 2', access: 'free' });
    expect(insertVals.position).toBe(1);
    expect(insertVals.module_id).toBe(MODULE);
    expect(insertVals.course_id).toBe(COURSE);
  });

  it('throws 404 when the module belongs to another course', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C' }, error: null };
      if (q.table === 'course_modules') return { data: { id: MODULE, course_id: 'other-course' }, error: null };
      return { data: null, error: null };
    };
    await expect(svc.addLesson(COURSE, MODULE, { title: 'x' })).rejects.toThrow('Module not found');
  });
});

describe('addLessonFile', () => {
  it('appends at maxLessonFilePosition + 1 scoped to the lesson', async () => {
    let insertVals;
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_lessons') return { data: { id: 'l1', course_id: COURSE }, error: null };
      if (q.table === 'lesson_files') {
        if (q.insertVals) {
          insertVals = q.insertVals;
          return { data: { id: 'f1', ...q.insertVals }, error: null };
        }
        return { data: { position: 2 }, error: null }; // maxLessonFilePosition read
      }
      return { data: null, error: null };
    };
    await svc.addLessonFile(COURSE, 'l1', { category: 'reading', name: 'a.pdf', file_key: 'courses/a.pdf' });
    expect(insertVals.position).toBe(3);
    expect(insertVals.lesson_id).toBe('l1');
    expect(insertVals.category).toBe('reading');
  });

  it('throws 404 when the lesson is not in the course', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'course_lessons') return { data: { id: 'l1', course_id: 'other' }, error: null };
      return { data: null, error: null };
    };
    await expect(
      svc.addLessonFile(COURSE, 'l1', { category: 'misc', name: 'a', file_key: 'k' }),
    ).rejects.toThrow('Lesson not found');
  });
});

describe('getCourse (nested modules)', () => {
  it('nests lessons under their module and files under their lesson', async () => {
    supaRec.resultProvider = (q) => {
      if (q.table === 'courses') return { data: { id: COURSE, title: 'C', status: 'draft' }, error: null };
      if (q.table === 'course_modules') return { data: [{ id: MODULE, title: 'Module 1', position: 0 }], error: null };
      if (q.table === 'course_lessons') return { data: [{ id: 'l1', module_id: MODULE, title: 'Intro', position: 0 }], error: null };
      if (q.table === 'lesson_files') return { data: [{ id: 'f1', lesson_id: 'l1', category: 'reading', name: 'g.pdf' }], error: null };
      if (q.table === 'course_resources') return { data: [], error: null };
      return { data: null, error: null };
    };
    const out = await svc.getCourse(COURSE);
    expect(out.modules).toHaveLength(1);
    expect(out.modules[0].lessons).toHaveLength(1);
    expect(out.modules[0].lessons[0].files[0].name).toBe('g.pdf');
  });
});
