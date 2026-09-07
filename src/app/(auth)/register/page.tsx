import type { Metadata } from "next"
import Link from "next/link"
import { HeartHandshake, Users } from "lucide-react"
import { CopticCross, NileDivider } from "@/components/coptic/brand"

export const metadata: Metadata = { title: "إنشاء حساب" }

function RoleCard({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-center gap-4 rounded-3xl border border-border bg-card p-6 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex size-16 items-center justify-center rounded-2xl bg-coptic-gold-soft text-coptic-gold transition-colors group-hover:bg-coptic-teal group-hover:text-primary-foreground">
        {icon}
      </div>
      <div>
        <p className="font-heading text-xl font-extrabold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </Link>
  )
}

export default function RegisterPage() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-coptic-teal/10 text-coptic-teal">
          <CopticCross className="size-8" />
        </div>
        <h1 className="text-balance font-heading text-3xl font-extrabold">
          أهلاً بيك 👋
        </h1>
        <p className="mt-2 text-lg font-medium text-foreground/80">
          إنت خادم ولا مخدوم؟
        </p>
        <NileDivider className="mx-auto mt-4 max-w-40" />
      </div>

      <div className="grid gap-3">
        <RoleCard
          href="/register/member"
          icon={<Users className="size-8" />}
          title="مخدوم"
          subtitle="أنا مخدوم في الخدمة"
        />
        <RoleCard
          href="/register/servant"
          icon={<HeartHandshake className="size-8" />}
          title="خادم"
          subtitle="أنا خادم في الخدمة"
        />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        عندك حساب بالفعل؟{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          سجّل دخولك
        </Link>
      </p>
    </div>
  )
}