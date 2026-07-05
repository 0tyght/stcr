import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export async function downloadElementAsLandscapePdf(element: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(element, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
  });

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imageWidth = pageWidth;
  const imageHeight = (canvas.height * imageWidth) / canvas.width;
  const top = Math.max(0, (pageHeight - imageHeight) / 2);

  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, top, imageWidth, Math.min(imageHeight, pageHeight));
  pdf.save(filename);
}
