import type { Metadata, Viewport } from "next"
import { Cairo, Amiri } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/sonner"
import { APP_NAME, APP_TAGLINE } from "@/lib/constants"

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
})

const amiri = Amiri({
  variable: "--font-amiri",
  subsets: ["arabic"],
  weight: ["400", "700"],
})

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — إدارة الخدمة`,
    template: `%s | ${APP_NAME}`,
  },
  description: `تطبيق إدارة الخدمة ل${APP_TAGLINE}`,
}

export const viewport: Viewport = {
  themeColor: "#0E6E5C",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${cairo.variable} ${amiri.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}