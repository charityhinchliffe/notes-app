"use client";

import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { changePassword } from "@/lib/api";
import {
  UNTAGGED,
  type SortMode,
  attachTagRecords,
  cleanTagName,
  createNoteRecord,
  createTagRecord,
  deleteNoteRecord,
  deleteTagRecord,
  detachTagRecord,
  formatWhen,
  getNotesSnapshot,
  getServerNotesSnapshot,
  lockNotes,
  preview,
  primaryTagName,
  subscribeNotes,
  unlockNotes,
  updateNote,
  visibleNotes,
} from "@/lib/notes";

const sorts: { id: SortMode; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "oldest", label: "Oldest" },
  { id: "title", label: "Title" },
  { id: "tag", label: "Tag" },
];

const fieldClass =
  "w-full rounded-2xl border border-line bg-white px-4 py-3 text-sm text-ink placeholder:text-muted/70";

const primaryClass =
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-brand px-4 py-3 text-sm font-semibold whitespace-nowrap text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40";

const quietClass =
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-line bg-white px-3 py-2 text-sm font-medium whitespace-nowrap text-brand transition hover:bg-soft";

export function NotesApp() {
  const { notes, tags, ready, error, warning, locked } = useSyncExternalStore(
    subscribeNotes,
    getNotesSnapshot,
    getServerNotesSnapshot,
  );
  const [chosenId, setChosenId] = useState<string | null | undefined>(undefined);
  const [sort, setSort] = useState<SortMode>("recent");
  const [filterTagId, setFilterTagId] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickBody, setQuickBody] = useState("");
  const [quickTagIds, setQuickTagIds] = useState<string[]>([]);
  const [draftTag, setDraftTag] = useState("");
  const [libraryTag, setLibraryTag] = useState("");
  const [editorDraft, setEditorDraft] = useState({
    noteId: "",
    tag: "",
    confirm: false,
  });
  const [tagToDelete, setTagToDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [lockPassword, setLockPassword] = useState("");
  const [lockError, setLockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const newestId = useMemo(() => {
    return [...notes].sort((left, right) => right.updatedAt - left.updatedAt)[0]
      ?.id ?? null;
  }, [notes]);
  const selectedId = chosenId === undefined ? newestId : chosenId;
  const editorTag = editorDraft.noteId === selectedId ? editorDraft.tag : "";
  const confirmDelete =
    editorDraft.noteId === selectedId ? editorDraft.confirm : false;

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!selectedId || locked) return;
    document.getElementById(`note-${selectedId}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [selectedId, locked]);

  useEffect(() => {
    if (!ready || error || locked) return;

    const idleLimit = 60_000;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void lockNotes().catch(() => {
          setNotice("Couldn't lock the notes.");
          arm();
        });
      }, idleLimit);
    };
    const markActive = () => {
      arm();
    };
    arm();
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"] as const;
    for (const eventName of events) {
      window.addEventListener(eventName, markActive, { passive: true });
    }

    return () => {
      window.clearTimeout(timer);
      for (const eventName of events) {
        window.removeEventListener(eventName, markActive);
      }
    };
  }, [ready, error, locked]);

  useEffect(() => {
    if (!locked) return;
    document.getElementById("lock-password")?.focus();
  }, [locked]);

  const orderedTags = useMemo(
    () => [...tags].sort((left, right) => left.name.localeCompare(right.name)),
    [tags],
  );

  const visible = useMemo(
    () => visibleNotes(notes, tags, sort, filterTagId),
    [notes, tags, sort, filterTagId],
  );

  const selected = notes.find((note) => note.id === selectedId) ?? null;
  const canCreate = quickTitle.trim().length > 0 || quickBody.trim().length > 0;
  const canChangePassword =
    currentPassword.length > 0 && newPassword.length > 0 && !savingPassword;

  function closePasswordDialog() {
    setChangingPassword(false);
    setCurrentPassword("");
    setNewPassword("");
    setPasswordError("");
    setPasswordSaved(false);
  }

  async function unlockApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lockPassword) return;
    setUnlocking(true);
    setLockError("");
    try {
      const unlocked = await unlockNotes(lockPassword);
      if (!unlocked) {
        setLockError("That password is incorrect.");
        return;
      }
      setLockPassword("");
    } catch (caught) {
      setLockError(caught instanceof Error ? caught.message : "Couldn't check that password.");
    } finally {
      setUnlocking(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canChangePassword) return;
    setSavingPassword(true);
    setPasswordError("");
    setPasswordSaved(false);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordSaved(true);
    } catch (caught) {
      setPasswordError(
        caught instanceof Error ? caught.message : "Couldn't change the password.",
      );
    } finally {
      setSavingPassword(false);
    }
  }

  async function rememberTag(name: string) {
    const cleaned = cleanTagName(name);
    if (!cleaned) return null;

    const existing = tags.find(
      (tag) => tag.name.toLowerCase() === cleaned.toLowerCase(),
    );
    if (existing) return existing.id;

    try {
      const tag = await createTagRecord(cleaned);
      return tag.id;
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Couldn't create that tag.");
      return null;
    }
  }

  async function createNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = quickTitle.trim();
    const body = quickBody.trim();
    if (!title && !body) return;

    try {
      const note = await createNoteRecord({
        title,
        body,
        tagIds: quickTagIds,
      });
      setChosenId(note.id);
      setQuickTitle("");
      setQuickBody("");
      setQuickTagIds([]);
      setDraftTag("");
      setFilterTagId((current) => {
        if (!current) return current;
        if (current === UNTAGGED) return note.tagIds.length === 0 ? current : null;
        return note.tagIds.includes(current) ? current : null;
      });
      setNotice("Note created");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Couldn't create that note.");
    }
  }

  async function addDraftTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = await rememberTag(draftTag);
    if (!id) return;
    setQuickTagIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setDraftTag("");
  }

  async function createLibraryTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = await rememberTag(libraryTag);
    if (!id) return;
    setLibraryTag("");
    setFilterTagId(id);
    setNotice("Tag created");
  }

  async function removeTag(tagId: string) {
    try {
      await deleteTagRecord(tagId);
      setQuickTagIds((current) => current.filter((id) => id !== tagId));
      if (filterTagId === tagId) setFilterTagId(null);
      setTagToDelete(null);
      setNotice("Tag deleted");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Couldn't delete that tag.");
    }
  }

  async function toggleNoteTag(noteId: string, tagId: string) {
    const note = notes.find((item) => item.id === noteId);
    if (!note) return;
    try {
      if (note.tagIds.includes(tagId)) {
        await detachTagRecord(noteId, tagId);
      } else {
        await attachTagRecords(noteId, [tagId]);
      }
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Couldn't update tags.");
    }
  }

  async function assignEditorTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const id = await rememberTag(editorTag);
    if (!id) return;
    try {
      await attachTagRecords(selected.id, [id]);
      setEditorDraft({ noteId: selected.id, tag: "", confirm: false });
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Couldn't assign that tag.");
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    const id = selected.id;
    const remaining = notes.filter((note) => note.id !== id);
    const nextVisible = visible.filter((note) => note.id !== id);
    try {
      await deleteNoteRecord(id);
      setChosenId(nextVisible[0]?.id ?? remaining[0]?.id ?? null);
      setEditorDraft({ noteId: "", tag: "", confirm: false });
      setNotice("Note deleted");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Couldn't delete that note.");
    }
  }

  if (!ready) {
    return (
      <main className="grid h-dvh place-items-center bg-blush text-sm text-muted">
        Loading notes…
      </main>
    );
  }

  if (error) {
    return (
      <main className="grid h-dvh place-items-center bg-blush px-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold">Notes are unavailable</h1>
          <p className="mt-2 text-sm text-muted">{error}</p>
        </div>
      </main>
    );
  }

  const pendingTag = tags.find((tag) => tag.id === tagToDelete) ?? null;

  return (
    <main className="flex min-h-dvh flex-col bg-blush text-ink md:h-dvh md:overflow-hidden">
      <div className="pointer-events-none fixed -top-28 -right-20 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
      <header className="flex shrink-0 items-center justify-between gap-4 px-4 pt-4 pb-3 md:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand text-white shadow-[0_10px_24px_-12px_rgba(194,37,107,0.9)]">
            <NoteIcon />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Notes</h1>
            <p className="text-sm text-muted">
              Write on the right. Keep the list close on the left.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            className={quietClass}
            onClick={() => setChangingPassword(true)}
          >
            Change password
          </button>
          <p className="text-sm whitespace-nowrap text-muted" aria-live="polite">
            {notice ||
              warning ||
              `${notes.length} ${notes.length === 1 ? "note" : "notes"}`}
          </p>
        </div>
      </header>

      <section className="mx-4 mb-3 shrink-0 rounded-3xl border border-line bg-white p-3 shadow-[0_18px_50px_-34px_rgba(194,37,107,0.8)] md:mx-6 md:p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-brand uppercase">
            Quick create
          </h2>
          <p className="text-xs text-muted">⌘/Ctrl + Enter</p>
        </div>
        <form
          onSubmit={createNote}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }
          }}
          className="grid gap-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="quick-title">
              Note title
            </label>
            <input
              id="quick-title"
              value={quickTitle}
              onChange={(event) => setQuickTitle(event.target.value)}
              placeholder="Title"
              className={`${fieldClass} sm:flex-1`}
            />
            <button type="submit" className={primaryClass} disabled={!canCreate}>
              Create note
            </button>
          </div>
          <label className="sr-only" htmlFor="quick-body">
            Note text
          </label>
          <textarea
            id="quick-body"
            value={quickBody}
            onChange={(event) => setQuickBody(event.target.value)}
            placeholder="A few lines to start the note"
            rows={1}
            className={`${fieldClass} resize-none`}
          />
        </form>
        <form onSubmit={addDraftTag} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 flex-wrap gap-2">
            {orderedTags.length === 0 ? (
              <p className="text-sm text-muted">Create a tag to assign it here.</p>
            ) : (
              orderedTags.map((tag) => {
                const active = quickTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setQuickTagIds((current) =>
                        current.includes(tag.id)
                          ? current.filter((id) => id !== tag.id)
                          : [...current, tag.id],
                      )
                    }
                    className={chipClass(active)}
                  >
                    {tag.name}
                  </button>
                );
              })
            )}
          </div>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="draft-tag">
              Create a tag for this note
            </label>
            <input
              id="draft-tag"
              value={draftTag}
              onChange={(event) => setDraftTag(event.target.value)}
              placeholder="New tag"
              maxLength={24}
              className={`${fieldClass} w-40`}
            />
            <button type="submit" className={quietClass} disabled={!cleanTagName(draftTag)}>
              Add tag
            </button>
          </div>
        </form>
      </section>

      <div className="grid grid-cols-1 gap-3 px-4 pb-4 md:min-h-0 md:flex-1 md:grid-cols-[24rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:px-6">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-[0_18px_50px_-34px_rgba(194,37,107,0.8)]">
          <div className="border-b border-line px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Your notes</h2>
              <p className="text-xs text-muted">
                {visible.length} shown
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Sort notes">
              <span className="text-xs font-semibold tracking-wide text-muted uppercase">
                Sort
              </span>
              {sorts.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={sort === option.id}
                  onClick={() => setSort(option.id)}
                  className={chipClass(sort === option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Filter notes by tag">
              <span className="text-xs font-semibold tracking-wide text-muted uppercase">
                Tags
              </span>
              <button
                type="button"
                aria-pressed={filterTagId === null}
                onClick={() => setFilterTagId(null)}
                className={chipClass(filterTagId === null)}
              >
                All
              </button>
              {orderedTags.map((tag) => {
                const active = filterTagId === tag.id;
                return (
                  <span
                    key={tag.id}
                    className={`inline-flex items-center rounded-full border ${
                      active
                        ? "border-brand bg-brand text-white"
                        : "border-line bg-white text-brand"
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilterTagId(active ? null : tag.id)}
                      className="cursor-pointer px-3 py-1.5 text-sm font-medium"
                    >
                      {tag.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete tag ${tag.name}`}
                      onClick={() => setTagToDelete(tag.id)}
                      className={`cursor-pointer pr-2.5 text-base leading-none ${
                        active ? "text-white" : "text-brand"
                      }`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                aria-pressed={filterTagId === UNTAGGED}
                onClick={() =>
                  setFilterTagId((current) =>
                    current === UNTAGGED ? null : UNTAGGED,
                  )
                }
                className={chipClass(filterTagId === UNTAGGED)}
              >
                Untagged
              </button>
            </div>

            <form onSubmit={createLibraryTag} className="mt-2 flex gap-2">
              <label className="sr-only" htmlFor="library-tag">
                Create a tag
              </label>
              <input
                id="library-tag"
                value={libraryTag}
                onChange={(event) => setLibraryTag(event.target.value)}
                placeholder="Create a tag"
                maxLength={24}
                className={fieldClass}
              />
              <button
                type="submit"
                className={primaryClass}
                disabled={!cleanTagName(libraryTag)}
              >
                Add
              </button>
            </form>

            {pendingTag ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-soft px-3 py-2">
                <p className="text-sm">
                  Delete “{pendingTag.name}”? It will be removed from every note.
                </p>
                <button
                  type="button"
                  className={primaryClass}
                  onClick={() => removeTag(pendingTag.id)}
                >
                  Delete tag
                </button>
                <button
                  type="button"
                  className={quietClass}
                  onClick={() => setTagToDelete(null)}
                >
                  Cancel
                </button>
              </div>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto md:max-h-none md:min-h-0 md:flex-1">
            {visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                {notes.length === 0
                  ? "Your notes will show up here."
                  : "No notes use this tag."}
              </p>
            ) : (
              <ul className="flex flex-col gap-1 p-2">
                {visible.map((note, index) => {
                  const group = primaryTagName(note, tags);
                  const previous = index > 0 ? primaryTagName(visible[index - 1], tags) : "";
                  const showGroup = sort === "tag" && group !== previous;
                  const isSelected = note.id === selectedId;
                  const noteTags = orderedTags.filter((tag) =>
                    note.tagIds.includes(tag.id),
                  );

                  return (
                    <li key={note.id}>
                      {showGroup ? (
                        <p className="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-brand uppercase">
                          {group}
                        </p>
                      ) : null}
                      <button
                        id={`note-${note.id}`}
                        type="button"
                        onClick={() => setChosenId(note.id)}
                        aria-current={isSelected ? "true" : undefined}
                        className={`w-full cursor-pointer rounded-2xl px-3 py-3 text-left transition ${
                          isSelected
                            ? "bg-soft ring-1 ring-brand"
                            : "hover:bg-soft"
                        }`}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm font-semibold">
                            {note.title || "Untitled"}
                          </span>
                          <span className="shrink-0 text-xs text-muted">
                            {formatWhen(note.updatedAt)}
                          </span>
                        </span>
                        <span className="mt-1 line-clamp-2 text-sm text-muted">
                          {preview(note.body)}
                        </span>
                        {noteTags.length > 0 ? (
                          <span className="mt-2 flex flex-wrap gap-1">
                            {noteTags.map((tag) => (
                              <span
                                key={tag.id}
                                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  isSelected
                                    ? "bg-white text-brand"
                                    : "bg-soft text-brand"
                                }`}
                              >
                                {tag.name}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-[0_18px_50px_-34px_rgba(194,37,107,0.8)] md:min-h-0">
          {selected ? (
            <div key={selected.id} className="flex min-h-0 flex-1 flex-col p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-brand uppercase">
                    Update note
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Last edited {formatWhen(selected.updatedAt)}. Changes save as you type.
                  </p>
                </div>
                {confirmDelete ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-soft px-3 py-2">
                    <p className="text-sm">Delete this note?</p>
                    <button type="button" className={primaryClass} onClick={deleteSelected}>
                      Delete
                    </button>
                    <button
                      type="button"
                      className={quietClass}
                      onClick={() =>
                        setEditorDraft({
                          noteId: selected.id,
                          tag: editorTag,
                          confirm: false,
                        })
                      }
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={quietClass}
                    onClick={() =>
                      setEditorDraft({
                        noteId: selected.id,
                        tag: editorTag,
                        confirm: true,
                      })
                    }
                  >
                    Delete note
                  </button>
                )}
              </div>

              <label className="sr-only" htmlFor="note-title">
                Note title
              </label>
              <input
                id="note-title"
                value={selected.title}
                onChange={(event) =>
                  updateNote(selected.id, { title: event.target.value })
                }
                placeholder="Untitled"
                className="mt-4 w-full border-b border-transparent bg-transparent py-2 text-2xl font-semibold tracking-tight placeholder:text-muted/50 focus:border-brand"
              />

              <div className="mt-4">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                  Assigned tags
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {orderedTags.length === 0 ? (
                    <p className="text-sm text-muted">
                      Create a tag, then assign it to this note.
                    </p>
                  ) : (
                    orderedTags.map((tag) => {
                      const active = selected.tagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleNoteTag(selected.id, tag.id)}
                          className={chipClass(active)}
                        >
                          {tag.name}
                        </button>
                      );
                    })
                  )}
                </div>
                <form onSubmit={assignEditorTag} className="mt-3 flex gap-2">
                  <label className="sr-only" htmlFor="editor-tag">
                    Create and assign a tag
                  </label>
                  <input
                    id="editor-tag"
                    value={editorTag}
                    onChange={(event) =>
                      setEditorDraft({
                        noteId: selected.id,
                        tag: event.target.value,
                        confirm: confirmDelete,
                      })
                    }
                    placeholder="Create and assign a tag"
                    maxLength={24}
                    className={fieldClass}
                  />
                  <button
                    type="submit"
                    className={primaryClass}
                    disabled={!cleanTagName(editorTag)}
                  >
                    Assign
                  </button>
                </form>
              </div>

              <label className="sr-only" htmlFor="note-body">
                Note text
              </label>
              <textarea
                id="note-body"
                value={selected.body}
                onChange={(event) =>
                  updateNote(selected.id, { body: event.target.value })
                }
                placeholder="Start writing…"
                className={`${fieldClass} mt-4 min-h-0 flex-1 resize-none leading-7`}
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-soft text-brand">
                <NoteIcon />
              </span>
              <h2 className="mt-4 text-lg font-semibold">Select a note</h2>
              <p className="mt-2 max-w-xs text-sm text-muted">
                Pick one from the list, or use quick create to start a new one.
              </p>
            </div>
          )}
        </section>
      </div>
      {changingPassword ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-ink/30 px-4">
          <form
            onSubmit={savePassword}
            className="w-full max-w-md rounded-3xl border border-line bg-white p-6 shadow-[0_18px_50px_-34px_rgba(194,37,107,0.8)]"
          >
            <h2 className="text-lg font-semibold">Change password</h2>
            <p className="mt-1 text-sm text-muted">
              Enter the current password, then choose a new one.
            </p>
            <label className="mt-4 block text-sm font-medium" htmlFor="current-password">
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              className={`${fieldClass} mt-2`}
            />
            <label className="mt-4 block text-sm font-medium" htmlFor="new-password">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              className={`${fieldClass} mt-2`}
            />
            {passwordError ? (
              <p className="mt-3 text-sm text-brand" role="alert">
                {passwordError}
              </p>
            ) : null}
            {passwordSaved ? (
              <p className="mt-3 text-sm text-brand" role="status">
                Password updated.
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={quietClass} onClick={closePasswordDialog}>
                Close
              </button>
              <button type="submit" className={primaryClass} disabled={!canChangePassword}>
                {savingPassword ? "Saving…" : "Save password"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {locked ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-blush px-4">
          <form
            onSubmit={unlockApp}
            className="w-full max-w-md rounded-3xl border border-line bg-white p-6 text-center shadow-[0_18px_50px_-34px_rgba(194,37,107,0.8)]"
          >
            <h2 className="text-lg font-semibold">Notes are locked</h2>
            <p className="mt-1 text-sm text-muted">
              Enter the app password to continue.
            </p>
            <label className="sr-only" htmlFor="lock-password">
              Password
            </label>
            <input
              id="lock-password"
              type="password"
              value={lockPassword}
              onChange={(event) => setLockPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Password"
              className={`${fieldClass} mt-5`}
            />
            {lockError ? (
              <p className="mt-3 text-sm text-brand" role="alert">
                {lockError}
              </p>
            ) : null}
            <button
              type="submit"
              className={`${primaryClass} mt-4 w-full`}
              disabled={!lockPassword || unlocking}
            >
              {unlocking ? "Checking…" : "Unlock"}
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function chipClass(active: boolean) {
  return `cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition ${
    active
      ? "border-brand bg-brand text-white"
      : "border-line bg-white text-brand hover:bg-soft"
  }`;
}

function NoteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3.5h7.2L19.5 8.8V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M14 3.8V9h5.1" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 13h7M8.5 16.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
