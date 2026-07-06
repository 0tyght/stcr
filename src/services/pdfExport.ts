import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export async function createLandscapePdfBlobFromElement(
  element: HTMLElement,
): Promise<Blob> {
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

  pdf.addImage(
    canvas.toDataURL("image/png"),
    "PNG",
    0,
    top,
    imageWidth,
    Math.min(imageHeight, pageHeight),
  );

  return pdf.output("blob");
}

export async function downloadElementAsLandscapePdf(
  element: HTMLElement,
  filename: string,
): Promise<void> {
  const blob = await createLandscapePdfBlobFromElement(element);
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}