export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-48 rounded bg-slate-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 rounded-lg bg-slate-200" />
        ))}
      </div>
    </div>
  );
}
