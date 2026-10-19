"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useRef, useState } from "react";
import { createNote, deleteNote, reorderNotes, updateNote, type NotePatch } from "@/app/notes/actions";
import type { ChecklistItem, Note, NoteColor } from "@/lib/types";
import { Section } from "./section";

const SAVE_DELAY_MS = 600;

const COLORS: { key: NoteColor; card: string; dot: string }[] = [
  { key: "yellow", card: "bg-amber-100 border-amber-200 dark:bg-amber-950/50 dark:border-amber-900", dot: "bg-amber-300" },
  { key: "pink", card: "bg-rose-100 border-rose-200 dark:bg-rose-950/50 dark:border-rose-900", dot: "bg-rose-300" },
  { key: "green", card: "bg-emerald-100 border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-900", dot: "bg-emerald-300" },
  { key: "blue", card: "bg-sky-100 border-sky-200 dark:bg-sky-950/50 dark:border-sky-900", dot: "bg-sky-300" },
  { key: "purple", card: "bg-violet-100 border-violet-200 dark:bg-violet-950/50 dark:border-violet-900", dot: "bg-violet-300" },
  { key: "orange", card: "bg-orange-100 border-orange-200 dark:bg-orange-950/50 dark:border-orange-900", dot: "bg-orange-300" },
];
const colorOf = (c: NoteColor) => COLORS.find((x) => x.key === c) ?? COLORS[0];

type SaveState = "saving" | "saved" | "error";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));

/** Pinned notes first, each group in its saved order. */
function arrange(notes: Note[]) {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sort_order - b.sort_order);
}

export function Notes({ initial }: { initial: Note[] | null }) {
  const [notes, setNotes] = useState<Note[]>(() => arrange(initial ?? []));
  const [status, setStatus] = useState<Record<string, SaveState>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const pending = useRef(new Map<string, NotePatch>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const flush = useCallback(async (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    const patch = pending.current.get(id);
    if (!patch) return;
    pending.current.delete(id);
    setStatus((s) => ({ ...s, [id]: "saving" }));
    const res = await updateNote(id, patch);
    setStatus((s) => ({ ...s, [id]: res.ok ? "saved" : "error" }));
    if (!res.ok) setError(res.error);
  }, []);

  // Save whatever is still waiting if the page is closed or hidden.
  useEffect(() => {
    const flushAll = () => [...pending.current.keys()].forEach(flush);
    const onHide = () => document.visibilityState === "hidden" && flushAll();
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  /** Updates a note locally at once and saves it shortly after the last change. */
  const change = useCallback(
    (id: string, patch: NotePatch, { now = false } = {}) => {
      setNotes((list) => list.map((n) => (n.id === id ? { ...n, ...patch } : n)));
      pending.current.set(id, { ...pending.current.get(id), ...patch });
      setStatus((s) => ({ ...s, [id]: "saving" }));
      clearTimeout(timers.current.get(id));
      if (now) flush(id);
      else timers.current.set(id, setTimeout(() => flush(id), SAVE_DELAY_MS));
    },
    [flush],
  );

  async function add(kind: Note["kind"]) {
    setCreating(true);
    setError(null);
    const res = await createNote(kind, "yellow");
    setCreating(false);
    if (!res.ok) return setError(res.error);
    setNotes((list) => arrange([...list, res.data]));
    setStatus((s) => ({ ...s, [res.data.id]: "saved" }));
  }

  async function remove(note: Note) {
    const empty = !note.title.trim() && !note.body.trim() && note.items.every((i) => !i.text.trim());
    if (!empty && !confirm("Delete this note?")) return;
    clearTimeout(timers.current.get(note.id));
    pending.current.delete(note.id);
    const before = notes;
    setNotes((list) => list.filter((n) => n.id !== note.id));
    const res = await deleteNote(note.id);
    if (!res.ok) {
      setNotes(before);
      setError(res.error);
    }
  }

  function persistOrder(list: Note[]) {
    const ordered = list.map((n, i) => ({ ...n, sort_order: (i + 1) * 10 }));
    setNotes(ordered);
    reorderNotes(ordered.map((n) => n.id)).then((res) => !res.ok && setError(res.error));
  }

  function togglePin(note: Note) {
    const pinned = !note.pinned;
    const others = notes.filter((n) => n.id !== note.id);
    const moved = { ...note, pinned };
    // A newly pinned note goes to the top; an unpinned one to the top of the rest.
    const list = pinned ? [moved, ...others] : [...others.filter((n) => n.pinned), moved, ...others.filter((n) => !n.pinned)];
    change(note.id, { pinned }, { now: true });
    persistOrder(list);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = notes.findIndex((n) => n.id === active.id);
    const to = notes.findIndex((n) => n.id === over.id);
    // Keep pinned and unpinned notes apart; pinning is how a note changes group.
    if (notes[from].pinned !== notes[to].pinned) return;
    persistOrder(arrayMove(notes, from, to));
  }

  const action = initial && (
    <div className="flex gap-2">
      <button type="button" disabled={creating} onClick={() => add("text")} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-60">
        + Note
      </button>
      <button type="button" disabled={creating} onClick={() => add("checklist")} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-60">
        + Checklist
      </button>
    </div>
  );

  return (
    <Section title="Notes" action={action}>
      {!initial ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-sm text-muted">
          Notes aren’t set up yet — run <code>supabase/migrations/20261019120000_dashboard_notes.sql</code> in the dashboard’s Supabase project.
        </p>
      ) : notes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-sm text-muted">No notes yet. Add a note or a checklist.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={notes.map((n) => n.id)} strategy={rectSortingStrategy}>
            <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
              {notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  status={status[note.id]}
                  onChange={(patch, opts) => change(note.id, patch, opts)}
                  onBlur={() => flush(note.id)}
                  onPin={() => togglePin(note)}
                  onDelete={() => remove(note)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}

function NoteCard({
  note,
  status,
  onChange,
  onBlur,
  onPin,
  onDelete,
}: {
  note: Note;
  status?: SaveState;
  onChange: (patch: NotePatch, opts?: { now?: boolean }) => void;
  onBlur: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: note.id });
  const [palette, setPalette] = useState(false);
  const color = colorOf(note.color);

  function convert() {
    if (note.kind === "text") {
      const lines = note.body.split("\n").map((l) => l.trim()).filter(Boolean);
      const items = (lines.length ? lines : [""]).map((text) => ({ id: newId(), text, done: false }));
      onChange({ kind: "checklist", items, body: "" }, { now: true });
    } else {
      const body = note.items.map((i) => (i.done ? `✓ ${i.text}` : i.text)).join("\n");
      onChange({ kind: "text", body, items: [] }, { now: true });
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex min-h-40 flex-col rounded-2xl border p-3 shadow-sm ${color.card} ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label="Drag note"
          className="cursor-grab touch-none rounded px-1 text-muted hover:text-fg active:cursor-grabbing"
        >
          ⠿
        </button>
        <input
          value={note.title}
          onChange={(e) => onChange({ title: e.target.value })}
          onBlur={onBlur}
          placeholder="Title"
          maxLength={200}
          aria-label="Note title"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-muted/70"
        />
        <button
          type="button"
          onClick={onPin}
          aria-label={note.pinned ? "Unpin note" : "Pin note"}
          aria-pressed={note.pinned}
          className={`rounded px-1 text-sm ${note.pinned ? "" : "opacity-30 grayscale hover:opacity-100 hover:grayscale-0"}`}
        >
          📌
        </button>
      </div>

      <div className="mt-2 flex-1">
        {note.kind === "text" ? (
          <textarea
            value={note.body}
            onChange={(e) => onChange({ body: e.target.value })}
            onBlur={onBlur}
            placeholder="Write something…"
            maxLength={10000}
            rows={4}
            aria-label="Note text"
            className="field-sizing-content min-h-24 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted/70"
          />
        ) : (
          <Checklist items={note.items} onChange={(items, opts) => onChange({ items }, opts)} onBlur={onBlur} />
        )}
      </div>

      <div className="mt-2 flex items-center gap-1 text-xs text-muted">
        <div className="relative">
          <button type="button" onClick={() => setPalette((p) => !p)} aria-label="Change colour" className="rounded px-1 py-0.5 hover:bg-black/5 dark:hover:bg-white/10">
            🎨
          </button>
          {palette && (
            <div className="absolute bottom-7 left-0 z-20 flex gap-1.5 rounded-full border border-line bg-surface p-1.5 shadow-md">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-label={c.key}
                  onClick={() => {
                    onChange({ color: c.key }, { now: true });
                    setPalette(false);
                  }}
                  className={`size-5 rounded-full ${c.dot} ${c.key === note.color ? "ring-2 ring-fg ring-offset-1" : ""}`}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={convert}
          aria-label={note.kind === "text" ? "Turn into checklist" : "Turn into text note"}
          title={note.kind === "text" ? "Turn into checklist" : "Turn into text note"}
          className="rounded px-1 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
        >
          {note.kind === "text" ? "☑" : "¶"}
        </button>
        <span className="ml-auto" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "error" ? <span className="text-danger">Not saved</span> : ""}
        </span>
        <button type="button" onClick={onDelete} aria-label="Delete note" className="rounded px-1 py-0.5 opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
          🗑
        </button>
      </div>
    </li>
  );
}

function Checklist({
  items,
  onChange,
  onBlur,
}: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[], opts?: { now?: boolean }) => void;
  onBlur: () => void;
}) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusId) return;
    inputs.current.get(focusId)?.focus();
    setFocusId(null);
  }, [focusId, items]);

  const done = items.filter((i) => i.done).length;
  // Show open items first; storage keeps the order they were written in.
  const shown = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];

  function update(id: string, patch: Partial<ChecklistItem>, opts?: { now?: boolean }) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)), opts);
  }

  function insertAfter(id: string | null) {
    if (items.length >= 100) return;
    const item = { id: newId(), text: "", done: false };
    const at = id ? items.findIndex((i) => i.id === id) + 1 : items.length;
    onChange([...items.slice(0, at), item, ...items.slice(at)]);
    setFocusId(item.id);
  }

  function removeItem(id: string) {
    const at = shown.findIndex((i) => i.id === id);
    onChange(items.filter((i) => i.id !== id));
    const prev = shown[at - 1] ?? shown[at + 1];
    if (prev && prev.id !== id) setFocusId(prev.id);
  }

  return (
    <div>
      {items.length > 0 && (
        <p className="mb-1 text-xs text-muted">
          {done}/{items.length} done
        </p>
      )}
      <ul className="space-y-1">
        {shown.map((item) => (
          <li key={item.id} className="group/item flex items-start gap-2">
            <input
              type="checkbox"
              checked={item.done}
              onChange={(e) => update(item.id, { done: e.target.checked }, { now: true })}
              aria-label={item.text ? `Done: ${item.text}` : "Done"}
              className="mt-1 size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
            />
            <input
              ref={(el) => {
                if (el) inputs.current.set(item.id, el);
                else inputs.current.delete(item.id);
              }}
              value={item.text}
              onChange={(e) => update(item.id, { text: e.target.value })}
              onBlur={onBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  insertAfter(item.id);
                } else if (e.key === "Backspace" && !item.text && items.length > 1) {
                  e.preventDefault();
                  removeItem(item.id);
                }
              }}
              placeholder="List item"
              maxLength={500}
              aria-label="Checklist item"
              className={`min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70 ${item.done ? "text-muted line-through" : ""}`}
            />
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              aria-label="Remove item"
              className="px-1 text-xs text-muted sm:opacity-0 sm:group-hover/item:opacity-100 sm:focus:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => insertAfter(null)} className="mt-1 text-sm text-muted hover:text-fg">
        + Add item
      </button>
    </div>
  );
}
