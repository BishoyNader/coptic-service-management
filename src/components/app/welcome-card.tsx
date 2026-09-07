import { QrCodeCard } from "@/components/app/qr-code-card"

type WelcomeCardProps = {
  name: string
  roleLabel: string
  qrToken: string
  personalCode: string
}

/** Shown right after a successful registration. */
export function WelcomeCard({ name, roleLabel, qrToken, personalCode }: WelcomeCardProps) {
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-3xl bg-coptic-teal p-6 text-center text-primary-foreground">
        <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
        <div className="relative">
          <p className="font-heading text-2xl font-extrabold">
            تم إنشاء حسابك بنجاح 🎉
          </p>
          <p className="mt-1 text-sm text-primary-foreground/85">
            أهلًا بيك يا {name} — حسابك كـ {roleLabel} جاهز
          </p>
        </div>
      </div>

      <QrCodeCard value={qrToken} name={name} personalCode={personalCode} />
    </div>
  )
}