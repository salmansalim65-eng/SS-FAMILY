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
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";
import { AppGlyph } from "@/components/app-icon";
import type { AppCategory, DashboardApp } from "@/lib/types";
import { deleteApp, reorderApps, saveApp } from "./actions";
import { Field, Status, dangerBtn, ghostBtn, inputCls, primaryBtn, useAction } from "./ui";

const CATEGORIES: { key: AppCategory; label: string }[] = [
  { key: "project", label: "My Projects" },
  { key: "personal", label: "Personal" },
];

export function AppsEditor({ apps }: { apps: DashboardApp[] }) {
  const [items, setItems] = useState(apps);
  const [editing, setEditing] = useState<string | null>(null); // app id, "new:<category>" or null
  const reorder = useAction();

  useEffect(() => setItems(apps), [apps]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(category: AppCategory, e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const list = items.filter((a) => a.category === category);
    const from = list.findIndex((a) => a.id === active.id);
    const to = list.findIndex((a) => a.id === over.id);
    const moved = arrayMove(list, from, to);
    setItems([...items.filter((a) => a.category !== category), ...moved]);
    reorder.exec(() => reorderApps(moved.map((a) => a.id)));
  }

  return (
    <div className="space-y-6">
      {CATEGORIES.map(({ key, label }) => {
        const list = items.filter((a) => a.category === key);
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{label}</h3>
              <button type="button" className={ghostBtn} onClick={() => setEditing(`new:${key}`)}>+ Add icon</button>
            </div>
            {editing === `new:${key}` && <AppForm category={key} onDone={() => setEditing(null)} />}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onDragEnd(key, e)}>
              <SortableContext items={list.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
                  {list.length === 0 && <li className="p-4 text-sm text-muted">No icons in this section.</li>}
                  {list.map((app) => (
                    <SortableRow
                      key={app.id}
                      app={app}
                      editing={editing === app.id}
                      onEdit={() => setEditing(editing === app.id ? null : app.id)}
                      onDone={() => setEditing(null)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </div>
        );
      })}
      <Status error={reorder.error} />
    </div>
  );
}

function SortableRow({ app, editing, onEdit, onDone }: { app: DashboardApp; editing: boolean; onEdit: () => void; onDone: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: app.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} className={`bg-surface ${isDragging ? "relative z-10 shadow-lg" : ""}`}>
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${app.name}`}
          className="cursor-grab touch-none rounded-lg px-1.5 py-2 text-lg text-muted hover:bg-surface-2 active:cursor-grabbing"
        >
          ⠿
        </button>
        <AppGlyph app={app} size="sm" />
        <div className="min-w-0 flex-1">
          <p className={`truncate font-medium ${app.is_active ? "" : "text-muted line-through"}`}>{app.name}</p>
          <p className="truncate text-xs text-muted">{app.url}</p>
        </div>
        <button type="button" className={ghostBtn} onClick={onEdit}>{editing ? "Close" : "Edit"}</button>
      </div>
      {editing && (
        <div className="border-t border-line p-3">
          <AppForm app={app} category={app.category} onDone={onDone} />
        </div>
      )}
    </li>
  );
}

function AppForm({ app, category, onDone }: { app?: DashboardApp; category: AppCategory; onDone: () => void }) {
  const save = useAction();
  const remove = useAction();
  const [preview, setPreview] = useState({ name: app?.name ?? "", icon: app?.icon ?? "", color: app?.color ?? "#4f46e5" });

  return (
    <form
      onSubmit={save.submit(saveApp, onDone)}
      className="space-y-4 rounded-2xl border border-line bg-surface p-4"
    >
      <input type="hidden" name="id" value={app?.id ?? ""} />
      <div className="flex items-center gap-4">
        <AppGlyph app={{ name: preview.name || "?", icon: preview.icon || null, color: preview.color }} />
        <p className="text-sm text-muted">Preview</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input name="name" required defaultValue={app?.name} onChange={(e) => setPreview({ ...preview, name: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Link (URL)">
          <input name="url" type="url" required defaultValue={app?.url} placeholder="https://" className={inputCls} />
        </Field>
        <Field label="Icon" hint="Initials or an emoji, or an image URL. Blank = initials of the name.">
          <input name="icon" defaultValue={app?.icon ?? ""} onChange={(e) => setPreview({ ...preview, icon: e.target.value })} className={inputCls} />
        </Field>
        <div className="grid grid-cols-[auto_1fr] gap-4">
          <Field label="Colour">
            <input
              name="color"
              type="color"
              defaultValue={preview.color}
              onChange={(e) => setPreview({ ...preview, color: e.target.value })}
              className="h-10 w-14 cursor-pointer rounded-xl border border-line bg-bg p-1"
            />
          </Field>
          <Field label="Section">
            <select name="category" defaultValue={category} className={inputCls}>
              <option value="project">My Projects</option>
              <option value="personal">Personal</option>
            </select>
          </Field>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_active" defaultChecked={app?.is_active ?? true} className="size-4 accent-[var(--accent)]" />
        Show on dashboard
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className={primaryBtn} disabled={save.pending}>{save.pending ? "Saving…" : app ? "Save" : "Add icon"}</button>
        <button type="button" className={ghostBtn} onClick={onDone}>Cancel</button>
        {app && (
          <button
            type="button"
            className={`${dangerBtn} ml-auto`}
            disabled={remove.pending}
            onClick={() => confirm(`Delete “${app.name}”?`) && remove.exec(() => deleteApp(app.id), onDone)}
          >
            Delete
          </button>
        )}
      </div>
      <Status error={save.error ?? remove.error} />
    </form>
  );
}
