// Pure normaliser for the Materials folder view. Converts a course (admin or
// tenant shape, pre-adapted to MaterialsInput) into a folder tree + stats.
// Per-module folders = the 5 lesson_files categories; course-level folders =
// Marking Rubrics + Additional Resources (backed by course_resources.category).
import { CATEGORIES, RESOURCE_CATEGORIES, type Category, type ResourceCategory } from '@/lib/course-admin';

export interface MaterialFile {
  id: string;
  name: string;
  size_bytes: number | null;
  created_at?: string | null;
  source: 'lesson-file' | 'resource';
  lessonId?: string; // present for lesson-file deletes
  locked?: boolean;
}

export interface FolderNode {
  id: string;
  label: string;
  count: number;
  files: MaterialFile[];
  kind: 'module-category' | 'course-resource';
  moduleId?: string;
  category?: Category;
  resourceCategory?: ResourceCategory;
}

export interface ModuleGroup {
  id: string;
  title: string;
  locked: boolean;
  fileCount: number;
  folders: FolderNode[];
}

export interface MaterialsTree {
  modules: ModuleGroup[];
  courseFolders: FolderNode[];
}

export interface MaterialsStats {
  totalModules: number;
  totalFolders: number;
  totalFiles: number;
}

export interface MatInputFile {
  id: string;
  name: string;
  size_bytes: number | null;
  created_at?: string | null;
  category: Category;
  lessonId: string;
}

export interface MatInputModule {
  id: string;
  title: string;
  locked: boolean;
  files: MatInputFile[]; // flattened across the module's lessons
}

export interface MatInputResource {
  id: string;
  name: string;
  size_bytes: number | null;
  created_at?: string | null;
  category: ResourceCategory;
  locked?: boolean;
}

export interface MaterialsInput {
  modules: MatInputModule[];
  resources: MatInputResource[];
}

export function buildTree(input: MaterialsInput): {
  tree: MaterialsTree;
  stats: MaterialsStats;
} {
  const modules: ModuleGroup[] = input.modules.map((m) => {
    const folders: FolderNode[] = CATEGORIES.map((c) => {
      const files = m.files
        .filter((f) => f.category === c.key)
        .map<MaterialFile>((f) => ({
          id: f.id,
          name: f.name,
          size_bytes: f.size_bytes,
          created_at: f.created_at,
          source: 'lesson-file',
          lessonId: f.lessonId,
        }));
      return {
        id: `${m.id}:${c.key}`,
        label: c.label,
        count: files.length,
        files,
        kind: 'module-category',
        moduleId: m.id,
        category: c.key,
      };
    });
    return {
      id: m.id,
      title: m.title,
      locked: m.locked,
      fileCount: folders.reduce((n, f) => n + f.count, 0),
      folders,
    };
  });

  const courseFolders: FolderNode[] = RESOURCE_CATEGORIES.map((rc) => {
    const files = input.resources
      .filter((r) => r.category === rc.key)
      .map<MaterialFile>((r) => ({
        id: r.id,
        name: r.name,
        size_bytes: r.size_bytes,
        created_at: r.created_at,
        source: 'resource',
        locked: r.locked,
      }));
    return {
      id: `course:${rc.key}`,
      label: rc.label,
      count: files.length,
      files,
      kind: 'course-resource',
      resourceCategory: rc.key,
    };
  });

  const totalFiles =
    input.modules.reduce((n, m) => n + m.files.length, 0) + input.resources.length;

  return {
    tree: { modules, courseFolders },
    stats: {
      totalModules: input.modules.length,
      totalFolders: input.modules.length * CATEGORIES.length + courseFolders.length,
      totalFiles,
    },
  };
}
