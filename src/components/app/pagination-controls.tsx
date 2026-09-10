import Link from "next/link"
import { ChevronRight, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

type PaginationControlsProps = {
  pathname: string
  page: number
  totalPages: number
  total: number
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
}: PaginationControlsProps) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <p className="text-xs text-muted-foreground">إجمالي {total}</p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={page > 2 ? `${pathname}?page=${page - 1}` : pathname}>
            <Button variant="outline" className="h-9 gap-1">
              <ChevronRight className="size-4" />
              السابق
            </Button>
          </Link>
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
          <Link href={`${pathname}?page=${page + 1}`}>
            <Button variant="outline" className="h-9 gap-1">
              التالي
              <ChevronLeft className="size-4" />
            </Button>
          </Link>
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