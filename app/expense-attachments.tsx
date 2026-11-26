"use client";

import dynamic from "next/dynamic";
import { Download, Eye, FileCheck2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type DocumentFile = {
  id: string;
  kind: string;
  name: string;
  mime: string;
  size: number;
};

const PdfPreview = dynamic(() => import("./pdf-preview"), {
  ssr: false,
  loading: () => <p className="document-preview-message" role="status">Carregando PDF…</p>,
});

const fileTypes: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
};

const sizeFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const documentUrl = (file: DocumentFile) => `/api/documents/${encodeURIComponent(file.id)}`;

function documentMetadata(file: DocumentFile) {
  const type = fileTypes[file.mime] || "Arquivo";
  if (file.size >= 1024 ** 2) return `${type} · ${sizeFormat.format(file.size / 1024 ** 2)} MB`;
  if (file.size >= 1024) return `${type} · ${sizeFormat.format(file.size / 1024)} KB`;
  return `${type} · ${file.size} B`;
}

export function ExpenseDocumentRow({ file, label, onPreview }: {
  file: DocumentFile;
  label: string;
  onPreview: (file: DocumentFile) => void;
}) {
  return (
    <div className="expense-file">
      <div className="expense-file-info">
        <FileCheck2 size={19} aria-hidden="true" />
        <div>
          <strong>{label}</strong>
          <span>{file.name}</span>
          <small>{documentMetadata(file)}</small>
        </div>
      </div>
      <div className="expense-file-actions">
        <button type="button" className="secondary-button small" aria-label={`Visualizar ${file.name}`} onClick={() => onPreview(file)}>
          <Eye size={16} aria-hidden="true" /> Visualizar
        </button>
        <a className="secondary-button small" href={documentUrl(file)} download aria-label={`Baixar ${file.name}`}>
          <Download size={16} aria-hidden="true" /> Baixar
        </a>
      </div>
    </div>
  );
}

export function ExpenseDocumentPreview({ file, onClose }: { file: DocumentFile; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const url = documentUrl(file);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement;
    element.showModal();
    closeButton.current?.focus();
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog ref={dialog} className="document-preview" aria-labelledby="document-preview-title" onCancel={event => {
      event.preventDefault();
      onClose();
    }}>
      <header className="document-preview-header">
        <div>
          <h2 id="document-preview-title">{file.name}</h2>
          <small>{documentMetadata(file)}</small>
        </div>
        <a className="secondary-button small" href={url} download><Download size={16} aria-hidden="true" /> Baixar</a>
        <button ref={closeButton} type="button" className="icon-button" onClick={onClose} aria-label="Fechar visualização">
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      {file.mime === "application/pdf" ? (
        <PdfPreview url={url} />
      ) : (
        <div className="document-preview-image">
          {imageError ? <p className="document-preview-message" role="alert">Não foi possível visualizar a imagem.</p> : (
            <>
              {imageLoading && <p className="document-preview-message" role="status">Carregando imagem…</p>}
              {/* Serve the original image directly from the authenticated endpoint. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={file.name} onLoad={() => setImageLoading(false)} onError={() => setImageError(true)} />
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
