"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLES } from "@/lib/roles";
import {
  activateStudyYear,
  createStudyYear,
  deactivateStudyYear,
  getStudyYearFridays,
  updateStudyYear,
  validateStudyYearInput,
  type StudyYearMutationResult,
} from "@/services/study-year-service";

/**
 * Study Year management is SUPER_ADMIN only. The actor is verified from the
 * session inside every action, then the mutation runs through the service-role
 * client (mirroring the `study_years_write_super` policy) with full audit
 * logging — exactly like the scoring-rules and activities management flows.
 */
async function requireRoles(
  allowed: string[],
): Promise<{ actorId: string; role: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !allowed.includes(profile.role as string)) return null;
  return { actorId: user.id, role: profile.role as string };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F-]{36}$/.test(value);
}

/** The "activate right away" flag, tolerant of client/browser encodings. */
function rawIsActive(raw: unknown): boolean {
  const r = (raw ?? {}) as Record<string, unknown>;
  return (
    r.is_active === true ||
    r.is_active === "true" ||
    r.is_active === "on" ||
    r.is_active === "1"
  );
}

export async function createStudyYearAction(
  raw: unknown,
): Promise<StudyYearMutationResult> {
  const actor = await requireRoles([ROLES.SUPER_ADMIN]);
  if (!actor) return { ok: false, message: "غير مصرح" };

  const validation = validateStudyYearInput(raw);
  if (!validation.ok) return validation;

  const result = await createStudyYear(createAdminClient(), {
    actorId: actor.actorId,
    year: validation.value,
    is_active: rawIsActive(raw),
  });
  if (result.ok) revalidatePath("/app/super-admin/study-years", "page");
  return result;
}

export async function updateStudyYearAction(
  yearId: unknown,
  raw: unknown,
): Promise<StudyYearMutationResult> {
  const actor = await requireRoles([ROLES.SUPER_ADMIN]);
  if (!actor) return { ok: false, message: "غير مصرح" };
  if (!isUuid(yearId)) return { ok: false, message: "بيانات غير صحيحة" };

  const validation = validateStudyYearInput(raw);
  if (!validation.ok) return validation;

  const result = await updateStudyYear(createAdminClient(), {
    actorId: actor.actorId,
    yearId,
    year: validation.value,
  });
  if (result.ok) revalidatePath("/app/super-admin/study-years", "page");
  return result;
}

export async function activateStudyYearAction(
  yearId: unknown,
): Promise<StudyYearMutationResult> {
  const actor = await requireRoles([ROLES.SUPER_ADMIN]);
  if (!actor) return { ok: false, message: "غير مصرح" };
  if (!isUuid(yearId)) return { ok: false, message: "بيانات غير صحيحة" };

  const result = await activateStudyYear(createAdminClient(), {
    actorId: actor.actorId,
    yearId,
  });
  if (result.ok) revalidatePath("/app/super-admin/study-years", "page");
  return result;
}

export async function deactivateStudyYearAction(
  yearId: unknown,
): Promise<StudyYearMutationResult> {
  const actor = await requireRoles([ROLES.SUPER_ADMIN]);
  if (!actor) return { ok: false, message: "غير مصرح" };
  if (!isUuid(yearId)) return { ok: false, message: "بيانات غير صحيحة" };

  const result = await deactivateStudyYear(createAdminClient(), {
    actorId: actor.actorId,
    yearId,
  });
  if (result.ok) revalidatePath("/app/super-admin/study-years", "page");
  return result;
}

export type StudyYearFridayPreview =
  | { ok: true; count: number; first: string; last: string }
  | { ok: false; message: string };

/**
 * Live preview for the create form: derives the Friday schedule of the entered
 * date range through the same service routine the ministry runs on.
 */
export async function previewStudyYearFridaysAction(
  startDate: unknown,
  endDate: unknown,
): Promise<StudyYearFridayPreview> {
  const actor = await requireRoles([ROLES.SUPER_ADMIN]);
  if (!actor) return { ok: false, message: "غير مصرح" };

  const validation = validateStudyYearInput({
    name: "معاينة",
    start_date: startDate,
    end_date: endDate,
  });
  if (!validation.ok) return validation;

  const schedule = getStudyYearFridays(validation.value);
  return {
    ok: true,
    count: schedule.length,
    first: schedule[0] ?? "",
    last: schedule[schedule.length - 1] ?? "",
  };
}
