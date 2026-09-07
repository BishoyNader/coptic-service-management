import { type NextRequest, NextResponse } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

const PUBLIC_PREFIXES = ["/login", "/register"]

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

/**
 * Session refresh + route protection.
 * Middleware in Next.js 16 is the "proxy". It never holds secrets and
 * never enforces data-level permissions — that is RLS + server logic.
 */
export async function proxy(request: NextRequest) {
  const { user, supabaseResponse, supabase } = await updateSession(request)
  const { pathname } = request.nextUrl

  // Public/auth traffic — let the page decide based on session.
  if (!user) {
    if (isPublicPath(pathname) || pathname === "/favicon.ico") {
      return supabaseResponse
    }
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  // Authenticated user on public pages → send them to their home.
  if (isPublicPath(pathname)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    if (profile?.role) {
      const home = `/app/${roleSegment(profile.role)}`
      if (pathname !== home) {
        const url = request.nextUrl.clone()
        url.pathname = home
        return NextResponse.redirect(url)
      }
    }
    return supabaseResponse
  }

  // Protected app routes — enforce the role segment.
  const match = pathname.match(/^\/app\/([^/]+)/)
  if (match) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    const expected = profile?.role ? roleSegment(profile.role) : null
    const base = match[1]

    if (!expected) {
      const url = request.nextUrl.clone()
      url.pathname = "/login"
      return NextResponse.redirect(url)
    }

    if (base === expected) {
      return supabaseResponse
    }

    const url = request.nextUrl.clone()
    url.pathname = `/app/${expected}`
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

function roleSegment(role: string): string {
  switch (role) {
    case "SERVED_MEMBER":
      return "member"
    case "SERVANT":
      return "servant"
    case "ADMIN":
      return "admin"
    case "SUPER_ADMIN":
      return "super-admin"
    default:
      return "member"
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except Next internals, static files and API routes.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}