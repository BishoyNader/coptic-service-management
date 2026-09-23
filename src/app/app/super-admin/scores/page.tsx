import type { Metadata } from "next"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "الدرجات" }

/** The super-admin scores tab moved into "نشاط الخدام" (record-activities). */
export default function SuperAdminScoresPage() {
  redirect("/app/super-admin/record-activities")
}