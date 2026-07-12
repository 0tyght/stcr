import { AlertTriangle, RefreshCw } from "lucide-react";
import { useAppData } from "../../app/providers";

export function DataConnectionBanner() {
  const { error, ovens, refresh, refreshing } = useAppData();

  if (!error) return null;

  return (
    <div className="data-connection-banner" role="alert">
      <AlertTriangle size={16} />
      <span>
        <strong>เชื่อมต่อข้อมูลไม่สำเร็จ</strong>
        {error}{" "}
        {ovens.length
          ? "ระบบยังแสดงข้อมูลล่าสุดที่ได้รับไว้"
          : "กรุณาตรวจสอบว่า Node-RED เปิดอยู่และ API URL ถูกต้อง"}
      </span>
      <button className="button" type="button" onClick={() => void refresh()} disabled={refreshing}>
        <RefreshCw size={15} />
        {refreshing ? "กำลังลองใหม่" : "ลองใหม่"}
      </button>
    </div>
  );
}
