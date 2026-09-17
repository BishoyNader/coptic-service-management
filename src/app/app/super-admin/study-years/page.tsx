import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/services/profile-service";
import { ROLES } from "@/lib/roles";
import {
  getStudyYearFridays,
  listStudyYears,
} from "@/services/study-year-service";
import { StudyYearsManager } from "@/components/app/study-years-manager";

export const metadata: Metadata = { title: "أعوام الخدمة" };

export default async function SuperAdminStudyYearsPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/");

  const years = await listStudyYears(createAdminClient());

  const rows = years.map((year) => ({
    id: year.id,
    name: year.name,
    start_date: year.start_date,
    end_date: year.end_date,
    is_active: year.is_active,
    friday_count: getStudyYearFridays(year).length,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">أعوام الخدمة</h1>
        <p className="text-sm text-muted-foreground">
          إدارة سنوات خدمة الجمعة وتفعيلها — مسؤول عام فقط
        </p>
      </div>

      <StudyYearsManager years={rows} />
    </div>
  );
}
