import type { Metadata, Viewport } from "next"
import { Cairo, Amiri } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/sonner"

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
    default: "خدمتي — إدارة الخدمة",
    template: "%s | خدمتي",
  },
  description: "تطبيق إدارة الخدمة لكنيسة القديسين للخدمات",
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