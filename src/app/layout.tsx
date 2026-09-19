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
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://coptic-service-management.vercel.app"
  ),
  title: {
    default: `${APP_NAME} — إدارة الخدمة`,
    template: `%s | ${APP_NAME}`,
  },
  description: `تطبيق إدارة الخدمة ل${APP_TAGLINE}`,
  applicationName: APP_NAME,
  authors: [{ name: APP_NAME }],
  openGraph: {
    type: "website",
    locale: "ar_EG",
    siteName: APP_NAME,
    title: `${APP_NAME} — إدارة الخدمة`,
    description: `تطبيق إدارة الخدمة ل${APP_TAGLINE}`,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: APP_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} — إدارة الخدمة`,
    description: `تطبيق إدارة الخدمة ل${APP_TAGLINE}`,
    images: ["/opengraph-image"],
  },
  icons: {
    icon: "/icon",
    apple: "/apple-icon",
  },
  robots: {
    index: false,
    follow: false,
  },
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