export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-24" aria-busy="true" aria-live="polite">
      <div className="h-10 w-44 animate-pulse rounded-2xl bg-secondary" />
      <div className="h-32 animate-pulse rounded-3xl bg-card shadow-sm ring-1 ring-foreground/5" />
      <div className="space-y-2">
        <div className="h-16 animate-pulse rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5" />
        <div className="h-16 animate-pulse rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5" />
        <div className="h-16 animate-pulse rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5" />
      </div>
    </div>
  )
}