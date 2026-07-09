import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";

export async function createLandscapePdfBlobFromElement(element: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(element, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
  });

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
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

export async function createLandscapePdfBlobFromSvg(svgElement: SVGSVGElement): Promise<Blob> {
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
    compress: true,
  });

  await registerThaiFonts(pdf);

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
  const viewBox = svgClone.getAttribute("viewBox") ?? "0 0 1123 794";

  svgClone.setAttribute("viewBox", viewBox);
  svgClone.setAttribute("width", String(pageWidth));
  svgClone.setAttribute("height", String(pageHeight));
  svgClone.setAttribute("preserveAspectRatio", "xMidYMid meet");

  forceSvgThaiFont(svgClone);
  await inlineSvgImages(svgClone);

  await svg2pdf(svgClone, pdf, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });

  return pdf.output("blob");
}

export async function downloadSvgAsLandscapePdf(
  svgElement: SVGSVGElement,
  filename: string,
): Promise<void> {
  const blob = await createLandscapePdfBlobFromSvg(svgElement);
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

async function registerThaiFonts(pdf: jsPDF): Promise<void> {
  const baseUrl = `${import.meta.env.BASE_URL}fonts`;

  const regularLoaded = await tryRegisterFont({
    pdf,
    url: `${baseUrl}/Sarabun-Regular.ttf`,
    filename: "Sarabun-Regular.ttf",
    family: "Sarabun",
    style: "normal",
  });

  const boldLoaded = await tryRegisterFont({
    pdf,
    url: `${baseUrl}/Sarabun-Bold.ttf`,
    filename: "Sarabun-Bold.ttf",
    family: "Sarabun",
    style: "bold",
  });

  if (!regularLoaded || !boldLoaded) {
    throw new Error(
      "ไม่พบไฟล์ฟอนต์ไทย กรุณาใส่ Sarabun-Regular.ttf และ Sarabun-Bold.ttf ใน public/fonts",
    );
  }

  pdf.setFont("Sarabun", "normal");
}

async function tryRegisterFont({
  pdf,
  url,
  filename,
  family,
  style,
}: {
  pdf: jsPDF;
  url: string;
  filename: string;
  family: string;
  style: "normal" | "bold";
}): Promise<boolean> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Font not found: ${url}`);
      return false;
    }

    const buffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);

    pdf.addFileToVFS(filename, base64);
    pdf.addFont(filename, family, style);

    return true;
  } catch (error) {
    console.error(`Cannot load font: ${url}`, error);
    return false;
  }
}

function forceSvgThaiFont(svgElement: SVGSVGElement): void {
  const textElements = svgElement.querySelectorAll("text, tspan");

  textElements.forEach((text) => {
    text.setAttribute("font-family", "Sarabun");

    const weight = text.getAttribute("font-weight") ?? text.getAttribute("data-weight") ?? "normal";
    const weightNumber = Number(weight);

    if (weight === "bold" || weightNumber >= 700) {
      text.setAttribute("font-weight", "bold");
    } else {
      text.setAttribute("font-weight", "normal");
    }
  });
}


async function inlineSvgImages(svgElement: SVGSVGElement): Promise<void> {
  const imageElements = Array.from(svgElement.querySelectorAll("image"));

  await Promise.all(
    imageElements.map(async (image) => {
      const href =
        image.getAttribute("href") ??
        image.getAttributeNS("http://www.w3.org/1999/xlink", "href");

      if (!href || href.startsWith("data:")) return;

      try {
        const absoluteUrl = new URL(href, window.location.href).toString();
        const response = await fetch(absoluteUrl);

        if (!response.ok) {
          console.error(`Image not found: ${absoluteUrl}`);
          return;
        }

        const blob = await response.blob();
        const dataUrl = await blobToDataUrl(blob);

        image.setAttribute("href", dataUrl);
        image.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);
      } catch (error) {
        console.error("Cannot inline SVG image for PDF export", error);
      }
    }),
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("Cannot read image blob"));
    };

    reader.readAsDataURL(blob);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    const chunk = bytes.subarray(index, index + 0x8000);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
