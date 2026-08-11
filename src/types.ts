/** Sitios soportados por el scraper. */
export type SiteId = "pj" | "oefa";

/** Documento normalizado extraído del portal. */
export interface DocumentRecord {
  site: SiteId;
  id: string;
  page: number;
  indexOnPage: number;
  fields: Record<string, string>;
  pdfUrl?: string;
  pdfUuid?: string;
  /** Campos JSF necesarios para descargar vía POST (OEFA). */
  pdfAction?: {
    formId: string;
    sourceId: string;
    paramUuid: string;
  };
  scrapedAt: string;
}

export interface FailedPdf {
  documentId: string;
  reason: string;
  attempts: number;
  lastStatus?: number;
  scrapedAt: string;
  pdfUrl?: string;
  pdfUuid?: string;
}

export interface ScrapeOptions {
  site: SiteId;
  /** Máximo de páginas a recorrer (útil para demos). Sin límite si es undefined. */
  maxPages?: number;
  /** Máximo de documentos a procesar. */
  maxDocuments?: number;
  /** Descargar PDFs asociados. */
  downloadPdfs: boolean;
  /** Delay base entre requests HTTP (ms). */
  delayMs: number;
  /** Reintentos máximos ante 429 / errores transitorios. */
  maxRetries: number;
  /** Directorio de salida. */
  outputDir: string;
  /** Filtros opcionales de búsqueda (dependen del sitio). */
  filters?: Record<string, string>;
}

export interface ScrapeSummary {
  site: SiteId;
  startedAt: string;
  finishedAt: string;
  pagesScraped: number;
  documentsExtracted: number;
  pdfsDownloaded: number;
  pdfsFailed: number;
  pdfsSkipped: number;
}

export interface PageResult {
  documents: DocumentRecord[];
  hasNextPage: boolean;
  totalRecords?: number;
  currentPage: number;
  totalPages?: number;
}
