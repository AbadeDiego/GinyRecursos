"use client";

import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";

const assets = `/pdf-viewer/${pdfjs.version}/`;
pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;

const renderOptions = {
  cMapUrl: `${assets}cmaps/`,
  standardFontDataUrl: `${assets}standard_fonts/`,
  wasmUrl: `${assets}wasm/`,
};
const loading = <p className="document-preview-message" role="status">Carregando PDF…</p>;
const error = <p className="document-preview-message" role="alert">Não foi possível visualizar o PDF.</p>;

export default function PdfPreview({ url }: { url: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [hasText, setHasText] = useState<boolean | null>(null);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function goToPage(nextPage: number) {
    setHasText(null);
    setPageNumber(nextPage);
    viewport.current?.scrollTo({ top: 0, left: 0 });
  }

  return (
    <div className="pdf-preview">
      {numPages > 0 && (
        <div className="pdf-preview-toolbar">
          <div className="pdf-preview-controls" role="group" aria-label="Navegação do PDF">
            <button type="button" className="icon-button" onClick={() => goToPage(pageNumber - 1)} disabled={pageNumber <= 1} aria-label="Página anterior">
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <span role="status">Página {pageNumber} de {numPages}</span>
            <button type="button" className="icon-button" onClick={() => goToPage(pageNumber + 1)} disabled={pageNumber >= numPages} aria-label="Próxima página">
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
          <div className="pdf-preview-controls" role="group" aria-label="Zoom do PDF">
            <button type="button" className="icon-button" onClick={() => setZoom(zoom - 25)} disabled={zoom <= 100} aria-label="Diminuir zoom">
              <Minus size={17} aria-hidden="true" />
            </button>
            <span role="status">{zoom}%</span>
            <button type="button" className="icon-button" onClick={() => setZoom(zoom + 25)} disabled={zoom >= 200} aria-label="Aumentar zoom">
              <Plus size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      <div className="pdf-preview-viewport" ref={viewport} tabIndex={0} aria-label="Página do documento PDF">
        <Document file={url} options={renderOptions} loading={loading} error={error} onLoadSuccess={pdf => setNumPages(pdf.numPages)}>
          {width > 0 && (
            <Page key={pageNumber} pageNumber={pageNumber} width={Math.min(width, 760)} scale={zoom / 100}
              renderAnnotationLayer={false} loading={loading} error={error}
              onGetTextSuccess={({ items }) => setHasText(items.some(item => "str" in item && item.str.trim() !== ""))} />
          )}
        </Document>
      </div>
      {hasText !== null && (
        <p className="pdf-preview-hint">
          {hasText ? "Selecione o texto no PDF para copiar." : "Esta página não contém texto selecionável."}
        </p>
      )}
    </div>
  );
}
