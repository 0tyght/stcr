import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const defaultSvgWidth = 1123;
const defaultSvgHeight = 794;
const pdfRenderScale = 3;

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

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
  const viewBox = svgClone.getAttribute("viewBox") ?? `0 0 ${defaultSvgWidth} ${defaultSvgHeight}`;
  const { width: svgWidth, height: svgHeight } = getSvgViewBoxSize(viewBox);

  svgClone.setAttribute("viewBox", viewBox);
  svgClone.setAttribute("width", String(svgWidth));
  svgClone.setAttribute("height", String(svgHeight));
  svgClone.setAttribute("preserveAspectRatio", "xMidYMid meet");

  forceSvgThaiFont(svgClone);
  await embedSvgThaiFonts(svgClone);
  await inlineSvgImages(svgClone);

  const imageData = await svgToPngDataUrl(svgClone, svgWidth, svgHeight, pdfRenderScale);
  pdf.addImage(imageData, "PNG", 0, 0, pageWidth, pageHeight, undefined, "FAST");

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

async function embedSvgThaiFonts(svgElement: SVGSVGElement): Promise<void> {
  const baseUrl = `${import.meta.env.BASE_URL}fonts`;

  try {
    const [regularFont, boldFont] = await Promise.all([
      fetchFontDataUrl(`${baseUrl}/Sarabun-Regular.ttf`),
      fetchFontDataUrl(`${baseUrl}/Sarabun-Bold.ttf`),
    ]);

    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      @font-face {
        font-family: "Sarabun";
        src: url("${regularFont}") format("truetype");
        font-weight: 400;
        font-style: normal;
      }
      @font-face {
        font-family: "Sarabun";
        src: url("${boldFont}") format("truetype");
        font-weight: 700;
        font-style: normal;
      }
      text, tspan {
        font-family: "Sarabun", "Tahoma", sans-serif;
        dominant-baseline: alphabetic;
      }
    `;

    svgElement.insertBefore(style, svgElement.firstChild);
  } catch (error) {
    console.error("Cannot embed Thai fonts for PDF export", error);
    throw new Error(
      "ไม่พบไฟล์ฟอนต์ไทย กรุณาใส่ Sarabun-Regular.ttf และ Sarabun-Bold.ttf ใน public/fonts",
    );
  }
}

async function fetchFontDataUrl(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Font not found: ${url}`);
  }

  const buffer = await response.arrayBuffer();
  return `data:font/ttf;base64,${arrayBufferToBase64(buffer)}`;
}

function getSvgViewBoxSize(viewBox: string): { width: number; height: number } {
  const parts = viewBox.split(/\s+/).map((value) => Number.parseFloat(value));
  const width = parts[2];
  const height = parts[3];

  return {
    width: Number.isFinite(width) && width > 0 ? width : defaultSvgWidth,
    height: Number.isFinite(height) && height > 0 ? height : defaultSvgHeight,
  };
}

async function svgToPngDataUrl(
  svgElement: SVGSVGElement,
  width: number,
  height: number,
  scale: number,
): Promise<string> {
  if (document.fonts) {
    await document.fonts.ready;
  }

  const serializedSvg = new XMLSerializer().serializeToString(svgElement);
  const svgBlob = new Blob([serializedSvg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Cannot create canvas context for PDF export");
    }

    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Cannot render SVG image for PDF export"));
    image.src = url;
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
