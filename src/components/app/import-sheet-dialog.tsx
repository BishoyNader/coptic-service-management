"use client"

import { useRef, useState, useCallback } from "react"
import * as XLSX from "xlsx"
import { Upload, Download, FileSpreadsheet, Loader2, Check, X } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { importUsersAction, type ImportResult } from "@/app/actions/import-users"
import { type AppRole } from "@/lib/roles"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: AppRole
  /** Active classes — used for the sheet's `معرف الصف` reference list. */
  classes?: ClassOption[]
}

type ParsedRow = Record<string, unknown>

type ClassOption = { id: string; name: string }

/** Columns that must be filled for served-member imports; the rest are optional. */
const REQUIRED_MEMBER_HEADERS = new Set(["الاسم", "الموبايل", "كلمة المرور"])

function getTemplateHeaders(role: AppRole): string[] {
  if (role === "SERVED_MEMBER") {
    return ["الاسم", "الموبايل", "تاريخ الميلاد", "هاتف الأب", "هاتف الأم", "العنوان", "معرف الصف", "كلمة المرور"]
  }
  return ["الاسم", "الموبايل", "تاريخ الميلاد", "كلمة المرور"]
}

function getTemplateSampleRows(role: AppRole, classes: ClassOption[]): (string | number)[][] {
  if (role === "SERVED_MEMBER") {
    const [first, second] = classes
    return [
      ["يوسف ناصر", "01012345678", "2000-05-15", "01098765432", "01087654321", "القاهرة", first?.id ?? "", "12345678"],
      ["مرى بخيت", "01123456789", "", "", "", "", second?.id ?? first?.id ?? "", "87654321"],
    ]
  }
  return [
    ["مرقس عادل", "01011112222", "1990-03-20", ""],
    ["تيرسأ حنا", "01233334444", "", ""],
  ]
}

function downloadTemplate(role: AppRole, classes: ClassOption[]) {
  const headers = getTemplateHeaders(role)
  const sampleRows = getTemplateSampleRows(role, classes)
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows])
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length * 1.5, 18) }))
  const wb = XLSX.utils.book_new()
  const label = role === "SERVED_MEMBER" ? "المخدومين" : "الخدام"
  XLSX.utils.book_append_sheet(wb, ws, label)
  XLSX.writeFile(wb, `template-${label}.xlsx`)
}

export function ImportSheetDialog({ open, onOpenChange, role, classes = [] }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<"pick" | "preview" | "running" | "done">("pick")
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [results, setResults] = useState<ImportResult[]>([])
  const [created, setCreated] = useState(0)
  const [failed, setFailed] = useState(0)
  const [busy, setBusy] = useState(false)

  const reset = useCallback(() => {
    setPhase("pick")
    setRows([])
    setResults([])
    setCreated(0)
    setFailed(0)
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset()
      onOpenChange(next)
    },
    [reset, onOpenChange],
  )

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const data = new Uint8Array(ev.target?.result as ArrayBuffer)
          const wb = XLSX.read(data, { type: "array" })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const json = XLSX.utils.sheet_to_json<ParsedRow>(ws, { defval: "" })

          if (json.length === 0) {
            toast.error("الملف فارغ")
            return
          }
          if (json.length > 500) {
            toast.error("الحد الأقصى 500 صف")
            return
          }

          setRows(json)
          setPhase("preview")
        } catch {
          toast.error("تعذر قراءة الملف، تأكد من صيغة xlsx")
        }
      }
      reader.readAsArrayBuffer(file)
    },
    [],
  )

  const handleImport = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setPhase("running")
    try {
      const result = await importUsersAction(rows, role)
      if (!result.ok) {
        toast.error(result.message)
        setPhase("preview")
        setBusy(false)
        return
      }

      setResults(result.results)
      setCreated(result.created)
      setFailed(result.failed)
      setPhase("done")

      if (result.failed === 0) {
        toast.success(`تم إنشاء ${result.created} ${role === "SERVED_MEMBER" ? "مخدوم" : "خادم"}`)
      } else {
        toast.warning(`${result.created} تم إنشاؤهم، ${result.failed} فشل`)
      }
    } catch {
      toast.error("حدث خطأ غير متوقع")
      setPhase("preview")
    } finally {
      setBusy(false)
    }
  }, [rows, role, busy])

  const label = role === "SERVED_MEMBER" ? "المخدومين" : "الخدام"
  const headers = getTemplateHeaders(role)
  const classById = new Map(classes.map((c) => [c.id, c]))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 gap-1.5 border-b p-4 pe-12">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" />
            استيراد {label}
          </DialogTitle>
          <DialogDescription>
            {role === "SERVED_MEMBER"
              ? "الاسم والموبايل وكلمة المرور مطلوبين (*) — باقي البيانات اختيارية"
              : "قم بتحميل القالب، أضف البيانات، ثم ارفع الملف"}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {phase === "pick" && (
          <div className="space-y-4">
            <Button variant="outline" className="gap-2" onClick={() => downloadTemplate(role, classes)}>
              <Download className="size-4" />
              تحميل قالب {label}
            </Button>

            {role === "SERVED_MEMBER" && (
              <ClassLegend classes={classes} />
            )}

            <div
              className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-8 text-muted-foreground" />
              <div>
                <p className="font-medium">اضغط لاختيار الملف</p>
                <p className="text-sm text-muted-foreground">
                  يقبل ملفات .xlsx
                </p>
              </div>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFile}
            />

          </div>
        )}

        {phase === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {rows.length} {rows.length === 1 ? "صف" : "صفوف"} جاهز{rows.length === 1 ? "" : "ين"} للاستيراد
              </p>
              <Button variant="ghost" size="sm" onClick={reset}>
                تغيير الملف
              </Button>
            </div>

            <ScrollArea className="h-[300px] max-w-full rounded-lg border">
              <table className="w-max min-w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 text-center text-muted-foreground">#</th>
                    {headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-start text-muted-foreground whitespace-nowrap">
                        {h}
                        {role === "SERVED_MEMBER" && REQUIRED_MEMBER_HEADERS.has(h) && (
                          <span className="text-destructive"> *</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 text-center text-muted-foreground">{i + 2}</td>
                      {headers.map((h) => (
                        <td key={h} className="px-3 py-2 whitespace-nowrap">
                          {h === "معرف الصف"
                            ? (classById.get(String(row[h] ?? "").trim())?.name ??
                              String(row[h] ?? ""))
                            : String(row[h] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 100 && (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  + {rows.length - 100} صف إضافي
                </p>
              )}
            </ScrollArea>
          </div>
        )}

        {phase === "running" && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="size-10 animate-spin text-primary" />
            <p className="text-muted-foreground">جاري الاستيراد...</p>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-green-600">
                <Check className="size-4" />
                {created} تم إنشاؤهم
              </span>
              {failed > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <X className="size-4" />
                  {failed} فشل
                </span>
              )}
            </div>

            {results.some((r) => !r.ok) && (
              <ScrollArea className="h-[200px] rounded-lg border">
                <div className="space-y-1 p-2">
                  {results
                    .filter((r) => !r.ok)
                    .map((r, i) => (
                      <p key={i} className="text-xs text-destructive">{r.message}</p>
                    ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}
        </div>

        {(phase === "preview" || phase === "done") && (
          <DialogFooter className="shrink-0 border-t bg-muted/50 p-4">
            {phase === "preview" ? (
              <>
                <Button variant="outline" onClick={reset}>
                  إلغاء
                </Button>
                <Button onClick={handleImport} disabled={busy} className="gap-2">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  استيراد {rows.length} {rows.length === 1 ? "صف" : "صفوف"}
                </Button>
              </>
            ) : (
              <Button onClick={() => handleOpenChange(false)}>إغلاق</Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The class → ID reference sheet: the importer needs the UUID, not the name. */
function ClassLegend({ classes }: { classes: ClassOption[] }) {
  if (classes.length === 0) {
    return (
      <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
        لا توجد صفوف بعد — أنشئ صفًا أولًا من شاشة الأصناف قبل الاستيراد
      </p>
    )
  }
  return (
    <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
      <p className="text-xs font-medium">
        اكتب <span className="font-bold">معرف الصف</span> في الشيت (مش اسم الصف):
      </p>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {classes.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 text-xs">
            <span className="shrink-0 font-medium">{c.name}</span>
            <code className="truncate rounded bg-background px-2 py-0.5 text-[11px] text-muted-foreground" dir="ltr">
              {c.id}
            </code>
          </div>
        ))}
      </div>
    </div>
  )
}
