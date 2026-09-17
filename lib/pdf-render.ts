// PDF 를 브라우저에서 이미지로 그립니다(pdf.js legacy 빌드: 오래된 안드로이드 웹뷰에서도 돌아가도록 폴리필 포함). 안드로이드 브라우저(카카오톡 인앱 포함)는
// <iframe> 에 PDF 를 넣으면 화면에 그리지 못하고 파일 다운로드로 넘겨 버리므로, 카드 타일에는
// 올릴 때 만든 첫 쪽 썸네일 이미지를 쓰고, 뷰어에서는 쪽마다 캔버스로 그립니다.
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

// 뷰어에서 한 번에 그리는 최대 쪽수. 그 이상은 "새 탭에서 열기"로 안내합니다.
export const PDF_PAGE_LIMIT = 30;

let pdfjsPromise: Promise<PdfJs> | null = null;

// pdf.js 본체를 필요할 때 한 번만 불러옵니다. 워커 파일 주소는 번들러가 정적 자원으로 내보낸 것을 쓰고,
// pdf.js 가 그 주소로 워커를 띄웁니다. 워커를 띄우지 못하는 환경이면 pdf.js 가 같은 파일을 이 스레드에 실어 그립니다.
async function loadPdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerPort && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    }
    return pdfjs;
  })();
  return pdfjsPromise;
}

async function toBytes(source: string | Blob | ArrayBuffer): Promise<Uint8Array> {
  if (typeof source === "string") {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`PDF 를 받지 못했습니다 (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
  if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
  return new Uint8Array(source);
}

export async function openPdf(source: string | Blob | ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const data = await toBytes(source);
  return pdfjs.getDocument({ data }).promise;
}

// 한 쪽을 주어진 CSS 너비에 맞춰 캔버스에 그립니다. 선명하게 보이도록 기기 배율(최대 maxScale)을 곱합니다.
export async function renderPdfPage(doc: PDFDocumentProxy, pageNumber: number, cssWidth: number, maxScale = 2): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const ratio = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, maxScale);
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("캔버스를 만들지 못했습니다.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  page.cleanup();
  return canvas;
}

// 첫 쪽을 JPEG 썸네일로 만듭니다. 실패하면 null 을 돌려주고 첨부 자체는 그대로 올라갑니다.
export async function renderPdfThumbnail(source: File | Blob, cssWidth = 960): Promise<File | null> {
  try {
    const doc = await openPdf(source);
    try {
      const canvas = await renderPdfPage(doc, 1, cssWidth, 1);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) return null;
      const stem = ("name" in source && typeof source.name === "string" ? source.name : "pdf").replace(/\.[^.]+$/, "") || "pdf";
      return new File([blob], `${stem}-preview.jpg`, { type: "image/jpeg" });
    } finally {
      void doc.loadingTask.destroy();
    }
  } catch (error) {
    console.warn("PDF 썸네일을 만들지 못했습니다.", error);
    return null;
  }
}
