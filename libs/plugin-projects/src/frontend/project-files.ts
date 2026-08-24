// Shape and view mode of the project Files tab, shared by the detail view and
// the listing component it renders (#116).

export interface ProjectFile {
  id: string;
  url: string;
  mimeType: string;
  filename: string | null;
  isImage: boolean;
  isCover: boolean;
  sizeBytes: number;
  createdAt: string;
}

// How the files are drawn. `grid` is square tiles — right when the pictures ARE
// the content; `list` is rows with name, type, size and date — right for a build
// log full of models, gcode and datasheets, where the grid wastes space and
// hides the identifying details behind a hover title.
export const PROJECT_FILES_VIEWS = ['grid', 'list'] as const;
export type ProjectFilesView = (typeof PROJECT_FILES_VIEWS)[number];

export function isProjectFilesView(value: string): value is ProjectFilesView {
  return (PROJECT_FILES_VIEWS as readonly string[]).includes(value);
}

// Remembered across visits: which way you read your files is a preference, not
// a per-project decision. The URL still wins when it carries one (§5.3), so a
// shared link opens the way its author meant.
const STORAGE_KEY = 'projects:filesView';

export function readStoredFilesView(): ProjectFilesView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && isProjectFilesView(raw) ? raw : 'grid';
  } catch {
    // Storage can be unavailable (private mode, blocked cookies) — the default
    // is a working answer, not an error worth surfacing.
    return 'grid';
  }
}

export function storeFilesView(view: ProjectFilesView): void {
  try {
    localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Preference lost, feature intact.
  }
}
