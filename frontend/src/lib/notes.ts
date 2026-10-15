import * as api from "@/lib/api";
import type { ApiNote, ApiTag } from "@/lib/api";

export type Note = {
  id: string;
  title: string;
  body: string;
  tagIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type Tag = {
  id: string;
  name: string;
  createdAt: number;
};

export type SortMode = "recent" | "oldest" | "title" | "tag";

export const UNTAGGED = "untagged";

export function cleanTagName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function primaryTagName(note: Note, tags: Tag[]) {
  const names = note.tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => Boolean(name))
    .sort((left, right) => left.localeCompare(right));

  return names[0] ?? "Untagged";
}

export function visibleNotes(
  notes: Note[],
  tags: Tag[],
  sort: SortMode,
  filterTagId: string | null,
) {
  const filtered = notes.filter((note) => {
    if (filterTagId === UNTAGGED) return note.tagIds.length === 0;
    if (filterTagId) return note.tagIds.includes(filterTagId);
    return true;
  });

  const primary = (note: Note) => primaryTagName(note, tags).toLowerCase();

  return [...filtered].sort((left, right) => {
    if (sort === "oldest") return left.createdAt - right.createdAt;
    if (sort === "title") {
      return (
        (left.title || "Untitled").localeCompare(right.title || "Untitled") ||
        right.updatedAt - left.updatedAt
      );
    }
    if (sort === "tag") {
      const untaggedLast = (note: Note) =>
        note.tagIds.length === 0 ? "\uffff" : primary(note);
      return (
        untaggedLast(left).localeCompare(untaggedLast(right)) ||
        (left.title || "Untitled").localeCompare(right.title || "Untitled")
      );
    }
    return right.updatedAt - left.updatedAt;
  });
}

export function preview(body: string) {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "Empty note";
  return compact.length > 96 ? `${compact.slice(0, 96)}…` : compact;
}

type Snapshot = {
  notes: Note[];
  tags: Tag[];
  ready: boolean;
  locked: boolean;
  error: string | null;
  warning: string | null;
};

const EMPTY_SNAPSHOT: Snapshot = {
  notes: [],
  tags: [],
  ready: false,
  locked: false,
  error: null,
  warning: null,
};

let snapshot: Snapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;
const saveTimers = new Map<string, number>();

function toTag(tag: ApiTag): Tag {
  return {
    id: tag.id,
    name: tag.name,
    createdAt: Date.parse(tag.created_at),
  };
}

function toNote(note: ApiNote): Note {
  return {
    id: note.id,
    title: note.title,
    body: note.content,
    tagIds: note.tags.map((tag) => tag.id),
    createdAt: Date.parse(note.created_at),
    updatedAt: Date.parse(note.updated_at),
  };
}

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function upsertNote(note: Note) {
  const exists = snapshot.notes.some((item) => item.id === note.id);
  emit({
    ...snapshot,
    notes: exists
      ? snapshot.notes.map((item) => (item.id === note.id ? note : item))
      : [note, ...snapshot.notes],
    warning: null,
  });
}

function clearPendingSaves() {
  for (const timer of saveTimers.values()) window.clearTimeout(timer);
  saveTimers.clear();
}

function lockedSnapshot(): Snapshot {
  return {
    notes: [],
    tags: [],
    ready: true,
    locked: true,
    error: null,
    warning: null,
  };
}

async function loadFromApi() {
  try {
    const status = await api.getLockStatus();
    if (status.locked) {
      clearPendingSaves();
      emit(lockedSnapshot());
      return;
    }
    const [notes, tags] = await Promise.all([api.listNotes(), api.listTags()]);
    emit({
      notes: notes.map(toNote),
      tags: tags.map(toTag),
      ready: true,
      locked: false,
      error: null,
      warning: null,
    });
  } catch (caught) {
    if (caught instanceof Error && caught.message === "Notes are locked") {
      clearPendingSaves();
      emit(lockedSnapshot());
      return;
    }
    emit({
      notes: [],
      tags: [],
      ready: true,
      locked: false,
      error: "Start the notes API from the backend folder, then refresh this page.",
      warning: null,
    });
  }
}

export async function lockNotes() {
  await api.lockApp();
  clearPendingSaves();
  emit(lockedSnapshot());
}

export async function unlockNotes(password: string) {
  const result = await api.verifyPassword(password);
  if (!result.valid) return false;
  await loadFromApi();
  return true;
}

function startLoad() {
  if (typeof window === "undefined" || snapshot.ready || loadPromise) return;
  loadPromise = loadFromApi().finally(() => {
    loadPromise = null;
  });
}

export function subscribeNotes(listener: () => void) {
  listeners.add(listener);
  startLoad();
  return () => listeners.delete(listener);
}

export function getNotesSnapshot() {
  return snapshot;
}

export function getServerNotesSnapshot() {
  return EMPTY_SNAPSHOT;
}

export async function createNoteRecord(input: {
  title: string;
  body: string;
  tagIds: string[];
}) {
  const note = toNote(
    await api.createNote({
      title: input.title,
      content: input.body,
      tag_ids: input.tagIds,
    }),
  );
  upsertNote(note);
  return note;
}

export function updateNote(
  id: string,
  patch: Partial<Pick<Note, "title" | "body">>,
) {
  const notes = snapshot.notes.map((note) =>
    note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note,
  );
  const current = notes.find((note) => note.id === id);
  emit({ ...snapshot, notes, warning: null });
  if (!current) return;

  const pending = saveTimers.get(id);
  if (pending) window.clearTimeout(pending);
  saveTimers.set(
    id,
    window.setTimeout(() => {
      saveTimers.delete(id);
      void persistNote(id, current.title, current.body);
    }, 400),
  );
}

async function persistNote(id: string, title: string, body: string) {
  try {
    const saved = toNote(await api.updateNote(id, { title, content: body }));
    const latest = snapshot.notes.find((note) => note.id === id);
    if (!latest || latest.title !== title || latest.body !== body) return;
    upsertNote(saved);
  } catch {
    emit({ ...snapshot, warning: "Couldn't save that edit." });
  }
}

export async function deleteNoteRecord(id: string) {
  const pending = saveTimers.get(id);
  if (pending) window.clearTimeout(pending);
  saveTimers.delete(id);
  await api.deleteNote(id);
  emit({
    ...snapshot,
    notes: snapshot.notes.filter((note) => note.id !== id),
    warning: null,
  });
}

export async function createTagRecord(name: string) {
  const tag = toTag(await api.createTag(name));
  const exists = snapshot.tags.some((item) => item.id === tag.id);
  emit({
    ...snapshot,
    tags: exists
      ? snapshot.tags.map((item) => (item.id === tag.id ? tag : item))
      : [...snapshot.tags, tag],
    warning: null,
  });
  return tag;
}

export async function deleteTagRecord(id: string) {
  await api.deleteTag(id);
  emit({
    ...snapshot,
    tags: snapshot.tags.filter((tag) => tag.id !== id),
    notes: snapshot.notes.map((note) => ({
      ...note,
      tagIds: note.tagIds.filter((tagId) => tagId !== id),
    })),
    warning: null,
  });
}

export async function attachTagRecords(noteId: string, tagIds: string[]) {
  const note = toNote(await api.attachTags(noteId, tagIds));
  upsertNote(note);
  return note;
}

export async function detachTagRecord(noteId: string, tagId: string) {
  const note = toNote(await api.detachTag(noteId, tagId));
  upsertNote(note);
  return note;
}

export function formatWhen(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);
}
