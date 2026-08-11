import { AxiosResponse } from "axios";
import { HttpClient, RateLimitError } from "../http/client";
import { encodeForm, sanitizeFilename } from "../jsf/helpers";
import { logger } from "../logger";
import { OutputStore } from "../storage/outputStore";
import { DocumentRecord, FailedPdf } from "../types";

export interface PdfDownloadResult {
  ok: boolean;
  skipped?: boolean;
  filename?: string;
  failure?: FailedPdf;
}

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).toString("utf8") === "%PDF";
}

function filenameFromDisposition(
  disposition: string | undefined,
  fallback: string
): string {
  if (!disposition) return fallback;
  const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf?.[1]) {
    try {
      return sanitizeFilename(decodeURIComponent(utf[1]));
    } catch {
      /* ignore */
    }
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  if (plain?.[1]) return sanitizeFilename(plain[1]);
  return fallback;
}

export class PdfDownloader {
  constructor(
    private readonly http: HttpClient,
    private readonly store: OutputStore,
    private readonly maxRetries: number
  ) {}

  async downloadForDocument(
    doc: DocumentRecord,
    postUrl?: string,
    viewState?: string,
    extraFormFields?: Record<string, string>
  ): Promise<PdfDownloadResult> {
    const baseName = sanitizeFilename(
      [
        doc.fields.resolucion ??
          doc.fields.expediente ??
          doc.fields.nro ??
          doc.id,
        doc.pdfUuid ?? "",
      ]
        .filter(Boolean)
        .join("_")
    );
    const preferred = `${baseName || doc.id}.pdf`;

    if (this.store.existsPdf(preferred)) {
      logger.info(`PDF ya existe, se omite: ${preferred}`);
      return { ok: true, skipped: true, filename: preferred };
    }

    try {
      const response = await this.fetchPdf(
        doc,
        postUrl,
        viewState,
        extraFormFields
      );

      if (response.status === 429) {
        return this.fail(doc, "HTTP 429 Too Many Requests", 429, this.maxRetries);
      }

      if (response.status >= 400) {
        return this.fail(doc, `HTTP ${response.status}`, response.status, 1);
      }

      const buffer = Buffer.from(response.data);
      if (!isPdfBuffer(buffer)) {
        return this.fail(
          doc,
          `respuesta no es PDF (content-type=${String(response.headers["content-type"] ?? "")})`,
          response.status,
          1
        );
      }

      const filename = filenameFromDisposition(
        response.headers["content-disposition"],
        preferred.endsWith(".pdf") ? preferred : `${preferred}.pdf`
      );
      const safeName = filename.toLowerCase().endsWith(".pdf")
        ? filename
        : `${filename}.pdf`;

      if (this.store.existsPdf(safeName)) {
        return { ok: true, skipped: true, filename: safeName };
      }

      this.store.writePdf(safeName, buffer);
      logger.info(`PDF guardado: ${safeName} (${buffer.length} bytes)`);
      return { ok: true, filename: safeName };
    } catch (error) {
      const axiosErr = this.http.asAxiosError(error);
      const status =
        error instanceof RateLimitError
          ? 429
          : axiosErr?.response?.status;
      const reason =
        error instanceof Error ? error.message : "error desconocido";
      logger.warn(`PDF falló para ${doc.id}: ${reason}`);
      return this.fail(doc, reason, status, this.maxRetries);
    }
  }

  private fail(
    doc: DocumentRecord,
    reason: string,
    lastStatus: number | undefined,
    attempts: number
  ): PdfDownloadResult {
    const failure: FailedPdf = {
      documentId: doc.id,
      reason,
      attempts,
      lastStatus,
      scrapedAt: new Date().toISOString(),
      pdfUrl: doc.pdfUrl,
      pdfUuid: doc.pdfUuid,
    };
    return { ok: false, failure };
  }

  private async fetchPdf(
    doc: DocumentRecord,
    postUrl?: string,
    viewState?: string,
    extraFormFields?: Record<string, string>
  ): Promise<AxiosResponse<ArrayBuffer>> {
    if (doc.pdfAction && postUrl && viewState) {
      const body = encodeForm({
        [doc.pdfAction.formId]: doc.pdfAction.formId,
        [doc.pdfAction.sourceId]: doc.pdfAction.sourceId,
        param_uuid: doc.pdfAction.paramUuid,
        "javax.faces.ViewState": viewState,
        ...(extraFormFields ?? {}),
      });
      return this.http.downloadBinary(postUrl, {
        method: "POST",
        data: body,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: postUrl,
        },
      });
    }

    if (!doc.pdfUrl) {
      throw new Error(`Documento ${doc.id} sin URL/acción de PDF`);
    }

    return this.http.downloadBinary(doc.pdfUrl, {
      headers: { Referer: doc.pdfUrl },
    });
  }
}
