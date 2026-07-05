export function LoadingState({ label = "กำลังโหลดข้อมูล" }: { label?: string }) {
  return (
    <div className="loading-state">
      <span className="spinner" />
      <strong>{label}</strong>
    </div>
  );
}
