"use client"

import { useRef, useState, useCallback } from "react"
import * as XLSX from "xlsx"
import { Upload, Download, FileSpreadsheet, Loader2, Check, X } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { importUsersAction, type ImportResult } from "@/app/actions/import-users"
import { ROLE_LABELS, type AppRole } from "@/lib/roles"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: AppRole
}

type ParsedRow = Record<string, unknown>

function getTemplateHeaders(role: AppRole): string[] {
  if (role === "SERVED_MEMBER") {
    return ["الاسم", "الموبايل", "كلمة المرور", "تاريخ الميلاد", "هاتف الأب", "هاتف الأم", "العنوان", "الصف"]
  }
  return ["الاسم", "الموبايل", "كلمة المرور", "تاريخ الميلاد"]
}

function getTemplateSampleRows(role: AppRole): (string | number)[][] {
  if (role === "SERVED_MEMBER") {
    return [
      ["يوسف ناصر", "01012345678", "12345678", "2000-05-15", "01098765432", "01087654321", "القاهرة", "الصف الأول"],
      ["مرى بخيت", "01123456789", "12345678", "", "", "", "", "الصف الثاني"],
    ]
  }
  return [
    ["مرقس عادل", "01011112222", "12345678", "1990-03-20"],
    ["تيرسأ حنا", "01233334444", "12345678", ""],
  ]
}

function downloadTemplate(role: AppRole) {
  const headers = getTemplateHeaders(role)
  const sampleRows = getTemplateSampleRows(role)
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows])
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length * 1.5, 18) }))
  const wb = XLSX.utils.book_new()
  const label = role === "SERVED_MEMBER" ? "المخدومين" : "الخدام"
  XLSX.utils.book_append_sheet(wb, ws, label)
  XLSX.writeFile(wb, `template-${label}.xlsx`)
}

export function ImportSheetDialog({ open, onOpenChange, role }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<"pick" | "preview" | "running" | "done">("pick")
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [results, setResults] = useState<ImportResult[]>([])
  const [created, setCreated] = useState(0)
  const [failed, setFailed] = useState(0)
  const [busy, setBusy] = useState(false)

  const reset = useCallback(() => {
    setPhase("pick")
    setRows([])
    setErrors([])
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
    setErrors([])
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
  const labelSingular = role === "SERVED_MEMBER" ? "مخدوم" : "خادم"
  const headers = getTemplateHeaders(role)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" />
            استيراد {label}
          </DialogTitle>
          <DialogDescription>
            قم بتحميل القالب، أضف البيانات، ثم ارفع الملف
          </DialogDescription>
        </DialogHeader>

        {phase === "pick" && (
          <div className="space-y-4 py-2">
            <Button variant="outline" className="gap-2" onClick={() => downloadTemplate(role)}>
              <Download className="size-4" />
              تحميل قالب {label}
            </Button>

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

            <ScrollArea className="h-[300px] rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 text-center text-muted-foreground">#</th>
                    {headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-start text-muted-foreground whitespace-nowrap">
                        {h}
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
                          {String(row[h] ?? "")}
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

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset}>
                إلغاء
              </Button>
              <Button onClick={handleImport} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                استيراد {rows.length} {rows.length === 1 ? "صف" : "صفوف"}
              </Button>
            </div>
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

            <div className="flex justify-end">
              <Button onClick={() => handleOpenChange(false)}>إغلاق</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
