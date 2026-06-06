// Course (Module Library / LMS) authoring client. Wraps the platform proxy
// (/api/platform-backend/courses/*) which injects the superadmin platform_token.
// Catalog is global content; these calls are superadmin-only on the backend.
import { platformApi } from './platform-api';

export type Access = 'free' | 'mentorship';
export type Track =
  | 'foundations'
  | 'business-health'
  | 'marketing'
  | 'implants'
  | 'business'
  | 'sales';
export type Level = 'all' | 'beginner' | 'intermediate' | 'advanced';
export type Status = 'draft' | 'published';
export type Category = 'presentations' | 'reading' | 'assignments' | 'clinical' | 'misc';
export type ResourceCategory = 'marking-rubrics' | 'additional-resources';

export interface Course {
  id: string;
  slug: string | null;
  title: string;
  track: Track;
  level: Level;
  access: Access;
  featured: boolean;
  description: string;
  instructor: string;
  instructor_title: string;
  outcome: string;
  status: Status;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface LessonFile {
  id: string;
  lesson_id: string;
  category: Category;
  name: string;
  file_key: string;
  file_type: string | null;
  size_bytes: number | null;
  position: number;
  access: Access;
  created_at?: string | null;
}

export interface Lesson {
  id: string;
  course_id: string;
  module_id: string;
  title: string;
  position: number;
  access: Access;
  body: string | null;
  teaser: string | null;
  attachment_file_key: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size_bytes: number | null;
  files: LessonFile[];
}

export interface Module {
  id: string;
  course_id: string;
  title: string;
  position: number;
  access: Access;
  lessons: Lesson[];
}

export interface Resource {
  id: string;
  course_id: string;
  name: string;
  file_key: string;
  file_type: string | null;
  size_bytes: number | null;
  access: Access;
  position: number;
  category: ResourceCategory;
  created_at?: string | null;
}

export interface CourseDetail extends Course {
  modules: Module[];
  resources: Resource[];
}

export const TRACKS: Track[] = [
  'foundations',
  'business-health',
  'marketing',
  'implants',
  'business',
  'sales',
];
export const LEVELS: Level[] = ['all', 'beginner', 'intermediate', 'advanced'];
export const ACCESS: Access[] = ['free', 'mentorship'];
export const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'presentations', label: 'Presentations' },
  { key: 'reading', label: 'Reading Materials' },
  { key: 'assignments', label: 'Assignment Details' },
  { key: 'clinical', label: 'Clinical Cases' },
  { key: 'misc', label: 'Miscellaneous' },
];
export const RESOURCE_CATEGORIES: { key: ResourceCategory; label: string }[] = [
  { key: 'marking-rubrics', label: 'Marking Rubrics' },
  { key: 'additional-resources', label: 'Additional Resources' },
];

export const coursesApi = {
  list: () => platformApi<{ courses: Course[] }>('/courses'),
  get: (id: string) => platformApi<CourseDetail>(`/courses/${id}`),
  create: (body: Partial<Course>) =>
    platformApi<Course>('/courses', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Course>) =>
    platformApi<Course>(`/courses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) =>
    platformApi<{ deleted: boolean }>(`/courses/${id}`, { method: 'DELETE' }),
  publish: (id: string, status: Status) =>
    platformApi<Course>(`/courses/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  addModule: (id: string, body: Partial<Module>) =>
    platformApi<Module>(`/courses/${id}/modules`, { method: 'POST', body: JSON.stringify(body) }),
  updateModule: (id: string, moduleId: string, body: Partial<Module>) =>
    platformApi<Module>(`/courses/${id}/modules/${moduleId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  removeModule: (id: string, moduleId: string) =>
    platformApi<{ deleted: boolean }>(`/courses/${id}/modules/${moduleId}`, { method: 'DELETE' }),
  reorderModules: (id: string, ids: string[]) =>
    platformApi<{ modules: Module[] }>(`/courses/${id}/modules/reorder`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  addLesson: (id: string, moduleId: string, body: Partial<Lesson>) =>
    platformApi<Lesson>(`/courses/${id}/modules/${moduleId}/lessons`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateLesson: (id: string, lessonId: string, body: Partial<Lesson>) =>
    platformApi<Lesson>(`/courses/${id}/lessons/${lessonId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  removeLesson: (id: string, lessonId: string) =>
    platformApi<{ deleted: boolean }>(`/courses/${id}/lessons/${lessonId}`, { method: 'DELETE' }),
  reorderLessons: (id: string, moduleId: string, ids: string[]) =>
    platformApi<{ lessons: Lesson[] }>(`/courses/${id}/modules/${moduleId}/lessons/reorder`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  addLessonFile: (id: string, lessonId: string, body: Partial<LessonFile>) =>
    platformApi<LessonFile>(`/courses/${id}/lessons/${lessonId}/files`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeLessonFile: (id: string, lessonId: string, fileId: string) =>
    platformApi<{ deleted: boolean }>(`/courses/${id}/lessons/${lessonId}/files/${fileId}`, {
      method: 'DELETE',
    }),

  addResource: (id: string, body: Partial<Resource>) =>
    platformApi<Resource>(`/courses/${id}/resources`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeResource: (id: string, resId: string) =>
    platformApi<{ deleted: boolean }>(`/courses/${id}/resources/${resId}`, {
      method: 'DELETE',
    }),
};

/** Presign + PUT a course attachment straight to S3. Returns the stored key. */
export async function uploadAttachment(
  file: File,
): Promise<{ key: string; name: string; type: string; size: number }> {
  const contentType = file.type || 'application/octet-stream';
  const { uploadUrl, key } = await platformApi<{ uploadUrl: string; key: string }>(
    '/courses/presign',
    {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, content_type: contentType }),
    },
  );
  // The backend signs the PUT with SSE-KMS, so the client must echo the header.
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'x-amz-server-side-encryption': 'aws:kms',
    },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);
  return { key, name: file.name, type: contentType, size: file.size };
}
