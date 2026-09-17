"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Loader2, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  activateStudyYearAction,
  createStudyYearAction,
  deactivateStudyYearAction,
  previewStudyYearFridaysAction,
} from "@/app/actions/study-years";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export type StudyYearRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  friday_count: number;
};

const fieldClass =
  "w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Super Admin — study years (أعوام الخدمة). Creates a new ministry year with a
 * live Friday-schedule preview and activates / deactivates years from the list.
 * Every mutation is super-admin-gated in the server action and audited.
 */
export function StudyYearsManager({ years }: { years: StudyYearRow[] }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activeOnCreate, setActiveOnCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [preview, setPreview] = useState<{
    count: number;
    first: string;
    last: string;
  } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    if (startDate.length !== 10 || endDate.length !== 10) {
      setPreview(null);
      setPreviewError("");
      return;
    }
    let cancelled = false;
    previewStudyYearFridaysAction(startDate, endDate).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setPreview({ count: res.count, first: res.first, last: res.last });
        setPreviewError("");
      } else {
        setPreview(null);
        setPreviewError(res.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  const submit = async () => {
    setError("");
    setBusy(true);
    const res = await createStudyYearAction({
      name,
      start_date: startDate,
      end_date: endDate,
      is_active: activeOnCreate,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    toast.success(res.message);
    setName("");
    setStartDate("");
    setEndDate("");
    setActiveOnCreate(false);
    setPreview(null);
    setPreviewError("");
    router.refresh();
  };

  const toggleActive = async (year: StudyYearRow) => {
    setTogglingId(year.id);
    const res = year.is_active
      ? await deactivateStudyYearAction(year.id)
      : await activateStudyYearAction(year.id);
    setTogglingId(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* Create form */}
      <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="size-4.5 text-muted-foreground" />
          <p className="font-heading text-sm font-bold">إضافة عام خدمة جديد</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3"
          data-testid="create-year-form"
        >
          <Field id="create-year-name" label="اسم عام الخدمة">
            <input
              id="create-year-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: 2028/2029"
              className={fieldClass}
              data-testid="create-year-name"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field id="create-year-start" label="بداية عام الخدمة">
              <input
                id="create-year-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={fieldClass}
                data-testid="create-year-start"
              />
            </Field>
            <Field id="create-year-end" label="نهاية عام الخدمة">
              <input
                id="create-year-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={fieldClass}
                data-testid="create-year-end"
              />
            </Field>
          </div>

          {preview ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="create-year-preview"
            >
              معاينة أيام الجمعة:{" "}
              <span className="font-semibold">{preview.count} جمعة</span>{" "}
              <span dir="ltr">
                ({preview.first} ← {preview.last})
              </span>
            </p>
          ) : previewError ? (
            <p
              className="text-xs text-destructive"
              data-testid="create-year-preview-error"
            >
              {previewError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch
                checked={activeOnCreate}
                onCheckedChange={setActiveOnCreate}
                aria-label="تفعيل عام الخدمة فورًا"
              />
              تفعيل فورًا
            </label>
            <Button
              type="submit"
              disabled={busy}
              className="gap-1.5"
              data-testid="create-year-submit"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              إضافة عام الخدمة
            </Button>
          </div>

          {error ? (
            <p
              className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
              data-testid="create-year-error"
            >
              {error}
            </p>
          ) : null}
        </form>
      </section>

      {/* List */}
      <section className="space-y-2" data-testid="study-years-list">
        {years.length === 0 ? (
          <p className="rounded-2xl bg-card px-5 py-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/5">
            لا توجد أعوام خدمة حتى الآن — أضف أول عام من النموذج بالأعلى
          </p>
        ) : (
          years.map((year) => {
            const active = year.is_active;
            return (
              <div
                key={year.id}
                data-testid={`study-year-row-${year.name}`}
                className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {year.name}
                  </p>
                  <Badge variant="secondary">{year.friday_count} جمعة</Badge>
                  {active ? (
                    <Badge data-testid={`active-badge-${year.name}`}>
                      مفعّل
                    </Badge>
                  ) : (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                      متوقف
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground" dir="ltr">
                  {year.start_date} ← {year.end_date}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {active
                      ? "الخدمة تعمل على هذا العام حاليًا"
                      : "غير مفعّل حاليًا"}
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      variant={active ? "outline" : "default"}
                      size="xs"
                      onClick={() => toggleActive(year)}
                      disabled={togglingId === year.id}
                      data-testid={`activate-${year.name}`}
                      className="gap-1"
                    >
                      {togglingId === year.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Check className="size-3" />
                      )}
                      تفعيل
                    </Button>
                    <Button
                      variant={active ? "default" : "outline"}
                      size="xs"
                      onClick={() => toggleActive(year)}
                      disabled={togglingId === year.id}
                      data-testid={`deactivate-${year.name}`}
                      className="gap-1"
                    >
                      {togglingId === year.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <RotateCcw className="size-3" />
                      )}
                      إيقاف
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
