'use client';
// Tenant Module Library data hooks — read the REAL published catalogue from the
// backend (/api/training/*). Replaces the static mock in ./data for the wired
// screens. Shapes mirror trainingService (backend).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface LibLessonLite {
  id: string;
  title: string;
  access: 'free' | 'mentorship';
}

export interface LibModule {
  id: string;
  track: string;
  title: string;
  level: string;
  access: 'free' | 'mentorship';
  featured?: boolean;
  desc: string;
  instructor: string;
  instructorTitle: string;
  outcome: string;
  duration: string;
  lessons: LibLessonLite[];
  enrolled: boolean;
  total_lessons: number;
  completed_lessons: number;
  progress_pct: number;
}

export interface LibraryResponse {
  modules: LibModule[];
  mentorship_active: boolean;
}

export function useLibrary() {
  return useQuery<LibraryResponse>({
    queryKey: ['training-library'],
    queryFn: () => api<LibraryResponse>('/api/training/library'),
    staleTime: 60_000,
  });
}

export type CourseDetailCategory =
  | 'presentations'
  | 'reading'
  | 'assignments'
  | 'clinical'
  | 'misc';

export interface CourseDetailLessonFile {
  id: string;
  lesson_id: string;
  category: CourseDetailCategory;
  name: string;
  file_key: string;
  file_type: string | null;
  size_bytes: number | null;
  position: number;
  access: 'free' | 'mentorship';
}

export interface CourseDetailLesson {
  id: string;
  module_id: string | null;
  title: string;
  access: 'free' | 'mentorship';
  locked: boolean;
  completed: boolean;
  teaser: string | null;
  body: string | null;
  attachment_name: string | null;
  attachment_file_key: string | null;
  attachment_size_bytes: number | null;
  files: CourseDetailLessonFile[];
}

export interface CourseDetailModule {
  id: string;
  title: string;
  position: number;
  access: 'free' | 'mentorship';
  lessons: CourseDetailLesson[];
}

export interface CourseDetailResource {
  id: string;
  name: string;
  access: 'free' | 'mentorship';
  locked: boolean;
  file_type: string | null;
  size_bytes: number | null;
  file_key: string | null;
}

export interface CourseDetailResponse {
  id: string;
  track: string;
  title: string;
  level: string;
  access: 'free' | 'mentorship';
  featured: boolean;
  desc: string;
  instructor: string;
  instructorTitle: string;
  outcome: string;
  mentorship_active: boolean;
  enrolled: boolean;
  /** Flat list — used for total/done progress counts. */
  lessons: CourseDetailLesson[];
  /** Nested modules → lessons (with files by category) — used for detail view. */
  modules: CourseDetailModule[];
  resources: CourseDetailResource[];
}

export function useCourse(id: string) {
  return useQuery<CourseDetailResponse>({
    queryKey: ['training-course', id],
    queryFn: () => api<CourseDetailResponse>(`/api/training/courses/${id}`),
    staleTime: 60_000,
    enabled: !!id,
  });
}

// ---- Mutations: enrol + lesson progress -----------------------------------
// Both refresh the course detail + library + my-training caches so card/badge
// progress updates without a manual reload.
export function useEnrol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (courseId: string) =>
      api<{ enrolled: boolean; course_id: string }>(
        `/api/training/courses/${courseId}/enrol`,
        { method: 'POST' },
      ),
    onSuccess: (_d, courseId) => {
      qc.invalidateQueries({ queryKey: ['training-course', courseId] });
      qc.invalidateQueries({ queryKey: ['training-library'] });
      qc.invalidateQueries({ queryKey: ['training-my'] });
    },
  });
}

export function useSetLessonComplete(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lessonId, completed }: { lessonId: string; completed: boolean }) =>
      api<{ lesson_id: string; completed: boolean }>(
        `/api/training/lessons/${lessonId}/complete`,
        { method: 'POST', body: JSON.stringify({ completed }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['training-course', courseId] });
      qc.invalidateQueries({ queryKey: ['training-library'] });
      qc.invalidateQueries({ queryKey: ['training-my'] });
    },
  });
}

// ---- My training feed ------------------------------------------------------
export interface MyEnrolment {
  course_id: string;
  title: string;
  track: string;
  level: string;
  access: 'free' | 'mentorship';
  enrolled_at: string | null;
  total_lessons: number;
  completed_lessons: number;
  progress_pct: number;
}

export function useMyTraining() {
  return useQuery<{ enrolments: MyEnrolment[] }>({
    queryKey: ['training-my'],
    queryFn: () => api<{ enrolments: MyEnrolment[] }>('/api/training/my'),
    staleTime: 60_000,
  });
}

// ---- Downloads: fetch a short-lived signed S3 GET, then trigger the browser
// download. Throws (caller catches) on a gated 403 / missing 404.
async function triggerDownload(path: string) {
  const { url, name } = await api<{ url: string; name: string }>(path);
  const a = document.createElement('a');
  a.href = url;
  if (name) a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadLessonAttachment(lessonId: string) {
  return triggerDownload(`/api/training/lessons/${lessonId}/attachment`);
}

export function downloadLessonFile(fileId: string) {
  return triggerDownload(`/api/training/lesson-files/${fileId}/download`);
}

export function downloadResource(resourceId: string) {
  return triggerDownload(`/api/training/resources/${resourceId}/download`);
}
