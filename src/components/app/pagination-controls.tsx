import Link from "next/link"
import { ChevronRight, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

type PaginationControlsProps = {
  pathname: string
  page: number
  totalPages: number
  total: number
  /** Extra query params to preserve across page links (e.g. search). */
  searchParams?: Record<string, string>
}

function buildHref(
  pathname: string,
  page: number,
  searchParams?: Record<string, string>,
): string {
  const params = new URLSearchParams()
  if (page > 1) params.set("page", String(page))
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v) params.set(k, v)
    }
  }
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/**
 * Server-rendered offset pagination. Hides entirely when there is a single
 * page so small lists look identical to before.
 */
export function PaginationControls({
  pathname,
  page,
  totalPages,
  total,
  searchParams,
}: PaginationControlsProps) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <p className="text-xs text-muted-foreground">إجمالي {total}</p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button
            render={<Link href={buildHref(pathname, page - 1, searchParams)} />}
            variant="outline"
            className="h-9 gap-1"
          >
            <ChevronRight className="size-4" />
            السابق
          </Button>
        ) : (
          <Button variant="outline" disabled className="h-9 gap-1">
            <ChevronRight className="size-4" />
            السابق
          </Button>
        )}

        <span className="text-xs text-muted-foreground">
          صفحة {page} من {totalPages}
        </span>

        {page < totalPages ? (
          <Button
            render={<Link href={buildHref(pathname, page + 1, searchParams)} />}
            variant="outline"
            className="h-9 gap-1"
          >
            التالي
            <ChevronLeft className="size-4" />
          </Button>
        ) : (
          <Button variant="outline" disabled className="h-9 gap-1">
            التالي
            <ChevronLeft className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}