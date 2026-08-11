import { HttpClient } from "./http/client";
import { logger } from "./logger";
import { PdfDownloader } from "./pdf/downloader";
import { OefaScraper } from "./sites/oefa";
import { PjScraper } from "./sites/pj";
import { OutputStore } from "./storage/outputStore";
import {
  DocumentRecord,
  FailedPdf,
  ScrapeOptions,
  ScrapeSummary,
} from "./types";

function takeLimit(
  docs: DocumentRecord[],
  maxDocuments: number | undefined,
  already: number
): DocumentRecord[] {
  if (!maxDocuments) return docs;
  const remaining = maxDocuments - already;
  if (remaining <= 0) return [];
  return docs.slice(0, remaining);
}

function reachedLimit(
  options: ScrapeOptions,
  documentsExtracted: number,
  pagesScraped: number
): boolean {
  if (options.maxDocuments && documentsExtracted >= options.maxDocuments) {
    return true;
  }
  if (options.maxPages && pagesScraped >= options.maxPages) {
    return true;
  }
  return false;
}

async function persistBatch(
  docs: DocumentRecord[],
  store: OutputStore,
  options: ScrapeOptions,
  pdfDownloader: PdfDownloader,
  failures: FailedPdf[],
  oefa?: OefaScraper
): Promise<{ downloaded: number; skipped: number }> {
  let downloaded = 0;
  let skipped = 0;

  for (const doc of docs) {
    store.appendDocument(doc);

    if (!options.downloadPdfs) continue;
    if (!doc.pdfUrl && !doc.pdfAction) {
      failures.push({
        documentId: doc.id,
        reason: "sin enlace de PDF",
        attempts: 0,
        scrapedAt: new Date().toISOString(),
      });
      continue;
    }

    const result = await pdfDownloader.downloadForDocument(
      doc,
      oefa?.getPageUrl(),
      oefa?.getViewState(),
      oefa?.getExtraFormFields()
    );

    if (result.ok && result.skipped) skipped += 1;
    else if (result.ok) downloaded += 1;
    else if (result.failure) failures.push(result.failure);
  }

  return { downloaded, skipped };
}

/** Orquestador principal del scraper. */
export async function scrape(options: ScrapeOptions): Promise<ScrapeSummary> {
  const startedAt = new Date().toISOString();
  const store = new OutputStore(options.outputDir);
  const http = new HttpClient({
    delayMs: options.delayMs,
    maxRetries: options.maxRetries,
  });
  const pdfDownloader = new PdfDownloader(http, store, options.maxRetries);
  const failures: FailedPdf[] = [];

  let pagesScraped = 0;
  let documentsExtracted = 0;
  let pdfsDownloaded = 0;
  let pdfsSkipped = 0;

  switch (options.site) {
    case "oefa": {
      const site = new OefaScraper(http);
      await site.init();
      let page = await site.search(options.filters ?? {});

      while (true) {
        pagesScraped += 1;
        const batch = takeLimit(
          page.documents,
          options.maxDocuments,
          documentsExtracted
        );
        const stats = await persistBatch(
          batch,
          store,
          options,
          pdfDownloader,
          failures,
          site
        );
        documentsExtracted += batch.length;
        pdfsDownloaded += stats.downloaded;
        pdfsSkipped += stats.skipped;

        logger.info(
          `OEFA p.${page.currentPage}/${page.totalPages ?? "?"} docs=${batch.length} acum=${documentsExtracted}`
        );

        if (reachedLimit(options, documentsExtracted, pagesScraped)) break;
        if (!page.hasNextPage) break;
        page = await site.goToPage(page.currentPage + 1);
      }
      break;
    }
    case "pj": {
      const site = new PjScraper(http);
      await site.init();
      let page = await site.search(options.filters ?? {});

      while (true) {
        pagesScraped += 1;
        const batch = takeLimit(
          page.documents,
          options.maxDocuments,
          documentsExtracted
        );
        const stats = await persistBatch(
          batch,
          store,
          options,
          pdfDownloader,
          failures
        );
        documentsExtracted += batch.length;
        pdfsDownloaded += stats.downloaded;
        pdfsSkipped += stats.skipped;

        logger.info(
          `PJ p.${page.currentPage} docs=${batch.length} acum=${documentsExtracted}`
        );

        if (reachedLimit(options, documentsExtracted, pagesScraped)) break;
        if (!page.hasNextPage) break;
        page = await site.goToPage(page.currentPage + 1);
      }
      break;
    }
    default: {
      const _exhaustive: never = options.site;
      throw new Error(`Sitio no soportado: ${String(_exhaustive)}`);
    }
  }

  store.writeFailedPdfs(failures);
  const summary: ScrapeSummary = {
    site: options.site,
    startedAt,
    finishedAt: new Date().toISOString(),
    pagesScraped,
    documentsExtracted,
    pdfsDownloaded,
    pdfsFailed: failures.length,
    pdfsSkipped,
  };
  store.writeSummary(summary);
  logger.info("Listo", summary);
  return summary;
}
