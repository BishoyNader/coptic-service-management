/**
 * Class management service.
 *
 * CRUD for the `classes` table which stores predefined class/grade names
 * used to group served members. Only SUPER_ADMIN can mutate; staff can read.
 */
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import { logAudit } from "./auth-service"

export const CLASS_ENTITY = "CLASS"
export const CLASS_CREATED = "CLASS_CREATED"
export const CLASS_UPDATED = "CLASS_UPDATED"
export const CLASS_DELETED = "CLASS_DELETED"

export type ClassRecord = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ClassInput = {
  name: string
  sort_order: number
}

export type ClassValidation =
  | { ok: true; value: ClassInput }
  | { ok: false; message: string }

const MAX_NAME = 60

export function validateClass(raw: unknown): ClassValidation {
  const r = (raw ?? {}) as Record<string, unknown>
  const name = String(r.name ?? "").replace(/\s+/g, " ").trim()
  if (!name) return { ok: false, message: "مطلوب اسم الصف" }
  if (name.length > MAX_NAME) return { ok: false, message: "اسم الصف أطول من المسموح به" }
  let sort_order = Number(r.sort_order)
  if (!Number.isFinite(sort_order) || sort_order < 0) sort_order = 0
  return { ok: true, value: { name, sort_order: Math.round(sort_order) } }
}

/** Full class list ordered for settings. */
export async function listClasses(admin: SupabaseAdminClient): Promise<ClassRecord[]> {
  const { data } = await admin
    .from("classes")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  return (data ?? []) as ClassRecord[]
}

/** Active classes only — used for dropdowns. */
export async function listActiveClasses(admin: SupabaseAdminClient): Promise<ClassRecord[]> {
  const { data } = await admin
    .from("classes")
    .select("id, name, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  return (data ?? []) as ClassRecord[]
}

export type ClassMutationResult = { ok: boolean; message: string }

export async function createClass(
  admin: SupabaseAdminClient,
  params: { actorId: string; cls: ClassInput }
): Promise<ClassMutationResult> {
  const { actorId, cls } = params
  const { error } = await admin.from("classes").insert({
    name: cls.name,
    sort_order: cls.sort_order,
  })
  if (error) {
    if (error.code === "23505") return { ok: false, message: "اسم الصف موجود بالفعل" }
    return { ok: false, message: "تعذر إضافة الصف" }
  }
  await logAudit(admin, {
    actorId,
    action: CLASS_CREATED,
    entity: CLASS_ENTITY,
    next: cls,
  })
  return { ok: true, message: "تمت إضافة الصف ✓" }
}

export async function updateClass(
  admin: SupabaseAdminClient,
  params: { actorId: string; classId: string; cls: ClassInput }
): Promise<ClassMutationResult> {
  const { actorId, classId, cls } = params
  const { data: current, error: readErr } = await admin
    .from("classes")
    .select("name, sort_order")
    .eq("id", classId)
    .maybeSingle()
  if (readErr || !current) return { ok: false, message: "الصف غير موجود" }

  const { error } = await admin
    .from("classes")
    .update({ name: cls.name, sort_order: cls.sort_order })
    .eq("id", classId)
  if (error) {
    if (error.code === "23505") return { ok: false, message: "اسم الصف موجود بالفعل" }
    return { ok: false, message: "تعذر تحديث الصف" }
  }
  await logAudit(admin, {
    actorId,
    action: CLASS_UPDATED,
    entity: CLASS_ENTITY,
    entityId: classId,
    previous: current,
    next: cls,
  })
  return { ok: true, message: "تم تحديث الصف ✓" }
}

export async function deleteClass(
  admin: SupabaseAdminClient,
  params: { actorId: string; classId: string }
): Promise<ClassMutationResult> {
  const { actorId, classId } = params
  const { data: current, error: readErr } = await admin
    .from("classes")
    .select("name")
    .eq("id", classId)
    .maybeSingle()
  if (readErr || !current) return { ok: false, message: "الصف غير موجود" }

  const { error } = await admin.from("classes").delete().eq("id", classId)
  if (error) return { ok: false, message: "تعذر حذف الصف" }

  await logAudit(admin, {
    actorId,
    action: CLASS_DELETED,
    entity: CLASS_ENTITY,
    entityId: classId,
    previous: current,
  })
  return { ok: true, message: "تم حذف الصف ✓" }
}
