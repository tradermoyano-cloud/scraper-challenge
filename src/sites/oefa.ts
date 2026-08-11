import * as cheerio from "cheerio";
import { HttpClient } from "../http/client";
import {
  encodeForm,
  extractPartialUpdate,
  extractViewState,
  parseMojarraAction,
} from "../jsf/helpers";
import { logger } from "../logger";
import { DocumentRecord, PageResult } from "../types";

const BASE = "https://publico.oefa.gob.pe";
const PAGE_URL = `${BASE}/repdig/consulta/consultaTfa.xhtml`;
const FORM = "listarDetalleInfraccionRAAForm";
const TABLE = `${FORM}:dt`;

export interface OefaSession {
  viewState: string;
  totalRecords?: number;
  totalPages?: number;
}

function cellText($: cheerio.CheerioAPI, cellIndex: number, $row: cheerio.Cheerio<any>): string {
  const cell = $row.find("td").eq(cellIndex);
  return cell
    .clone()
    .find("script")
    .remove()
    .end()
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

export class OefaScraper {
  private viewState = "";
  private totalRecords?: number;
  private totalPages?: number;

  constructor(private readonly http: HttpClient) {}

  getViewState(): string {
    return this.viewState;
  }

  getPageUrl(): string {
    return PAGE_URL;
  }

  getExtraFormFields(): Record<string, string> {
    return {
      [`${FORM}:txtNroexp`]: "",
      [`${FORM}:j_idt21`]: "",
      [`${FORM}:j_idt25`]: "",
      [`${FORM}:idsector`]: "",
      [`${FORM}:j_idt34`]: "",
      [`${FORM}:dt_scrollState`]: "0,0",
    };
  }

  async init(): Promise<OefaSession> {
    logger.info("OEFA: abriendo consultaTfa.xhtml");
    const res = await this.http.get(PAGE_URL);
    if (res.status >= 400) {
      throw new Error(`OEFA inicio falló con HTTP ${res.status}`);
    }
    const vs = extractViewState(res.data);
    if (!vs) throw new Error("OEFA: no se encontró ViewState inicial");
    this.viewState = vs;
    return { viewState: vs };
  }

  async search(filters: Record<string, string> = {}): Promise<PageResult> {
    const body = encodeForm({
      "javax.faces.partial.ajax": "true",
      "javax.faces.source": `${FORM}:btnBuscar`,
      "javax.faces.partial.execute": "@all",
      "javax.faces.partial.render": `${FORM}:pgLista ${FORM}:txtNroexp`,
      [`${FORM}:btnBuscar`]: `${FORM}:btnBuscar`,
      [FORM]: FORM,
      [`${FORM}:txtNroexp`]: filters.expediente ?? "",
      [`${FORM}:j_idt21`]: filters.administrado ?? "",
      [`${FORM}:j_idt25`]: filters.unidad ?? "",
      [`${FORM}:idsector`]: filters.sector ?? "",
      [`${FORM}:j_idt34`]: filters.resolucion ?? "",
      [`${FORM}:dt_scrollState`]: "0,0",
      "javax.faces.ViewState": this.viewState,
    });

    logger.info("OEFA: enviando búsqueda AJAX");
    const res = await this.http.post(PAGE_URL, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Faces-Request": "partial/ajax",
        "X-Requested-With": "XMLHttpRequest",
        Referer: PAGE_URL,
      },
    });

    if (res.status >= 400) {
      throw new Error(`OEFA búsqueda falló con HTTP ${res.status}`);
    }

    const newVs = extractViewState(res.data);
    if (newVs) this.viewState = newVs;

    const html = extractPartialUpdate(res.data, `${FORM}:pgLista`);
    const page = this.parsePage(html, 1);
    this.totalRecords = page.totalRecords ?? this.totalRecords;
    this.totalPages = page.totalPages ?? this.totalPages;
    return {
      ...page,
      totalRecords: this.totalRecords,
      totalPages: this.totalPages,
    };
  }

  async goToPage(pageNumber: number, rows = 10): Promise<PageResult> {
    const first = (pageNumber - 1) * rows;
    const body = encodeForm({
      "javax.faces.partial.ajax": "true",
      "javax.faces.source": TABLE,
      "javax.faces.partial.execute": TABLE,
      "javax.faces.partial.render": TABLE,
      "javax.faces.behavior.event": "page",
      "javax.faces.partial.event": "page",
      [TABLE]: TABLE,
      [`${TABLE}_pagination`]: "true",
      [`${TABLE}_first`]: String(first),
      [`${TABLE}_rows`]: String(rows),
      [`${TABLE}_skipChildren`]: "true",
      [`${TABLE}_encodeFeature`]: "true",
      [FORM]: FORM,
      ...this.getExtraFormFields(),
      "javax.faces.ViewState": this.viewState,
    });

    logger.info(`OEFA: paginando a página ${pageNumber}`);
    const res = await this.http.post(PAGE_URL, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Faces-Request": "partial/ajax",
        "X-Requested-With": "XMLHttpRequest",
        Referer: PAGE_URL,
      },
    });

    if (res.status >= 400) {
      throw new Error(`OEFA paginación falló con HTTP ${res.status}`);
    }

    const newVs = extractViewState(res.data);
    if (newVs) this.viewState = newVs;

    const html = extractPartialUpdate(res.data, TABLE);
    const page = this.parsePage(html, pageNumber);
    return {
      ...page,
      totalRecords: this.totalRecords ?? page.totalRecords,
      totalPages: this.totalPages ?? page.totalPages,
      hasNextPage:
        this.totalPages !== undefined
          ? pageNumber < this.totalPages
          : page.hasNextPage,
    };
  }

  private parsePage(html: string, currentPage: number): PageResult {
    // Las respuestas AJAX de paginación a veces traen solo <tr> sueltos.
    // Cheerio los descarta si no van dentro de <table>.
    const normalized = /<tr[\s>]/i.test(html) && !/<table[\s>]/i.test(html)
      ? `<table><tbody>${html}</tbody></table>`
      : html;
    const $ = cheerio.load(normalized);
    const documents: DocumentRecord[] = [];

    $("tr[data-ri]").each((_, row) => {
      const $row = $(row);
      const cells = $row.find("td");
      if (cells.length < 6) return;

      const nro = cellText($, 0, $row);
      const expediente = cellText($, 1, $row);
      const administrado = cellText($, 2, $row);
      const unidad = cellText($, 3, $row);
      const sector = cellText($, 4, $row);
      const resolucion = cellText($, 5, $row);

      const onclick = $row.find("a[onclick*='mojarra.jsfcljs']").attr("onclick") ?? "";
      const action = parseMojarraAction(onclick);

      const indexOnPage = Number.parseInt($row.attr("data-ri") ?? "0", 10);
      const id = action?.paramUuid ?? `${resolucion || expediente || nro}-${indexOnPage}`;

      documents.push({
        site: "oefa",
        id,
        page: currentPage,
        indexOnPage,
        fields: {
          nro,
          expediente,
          administrado,
          unidad,
          sector,
          resolucion,
        },
        pdfUuid: action?.paramUuid,
        pdfAction: action
          ? {
              formId: action.formId,
              sourceId: action.sourceId,
              paramUuid: action.paramUuid,
            }
          : undefined,
        scrapedAt: new Date().toISOString(),
      });
    });

    const paginatorText =
      $(".ui-paginator-current").first().text() ||
      html.match(/Página\s+(\d+)\s+de\s+(\d+)\s+\((\d+)\s+registros\)/)?.[0] ||
      "";

    let totalPages: number | undefined;
    let totalRecords: number | undefined;
    const meta = paginatorText.match(
      /Página\s+(\d+)\s+de\s+(\d+)\s+\((\d+)\s+registros\)/i
    );
    if (meta) {
      totalPages = Number.parseInt(meta[2], 10);
      totalRecords = Number.parseInt(meta[3], 10);
    } else {
      const scriptMeta = html.match(/rowCount:(\d+)/);
      const rowsMeta = html.match(/rows:(\d+)/);
      if (scriptMeta) {
        totalRecords = Number.parseInt(scriptMeta[1], 10);
        const rows = rowsMeta ? Number.parseInt(rowsMeta[1], 10) : 10;
        totalPages = Math.max(1, Math.ceil(totalRecords / rows));
      }
    }

    // En respuestas parciales de paginación solo vienen filas; asumir más páginas
    // si hay exactamente 10 filas y no conocemos el total.
    const hasNextPage =
      totalPages !== undefined
        ? currentPage < totalPages
        : documents.length >= 10;

    return {
      documents,
      hasNextPage,
      totalRecords,
      currentPage,
      totalPages,
    };
  }
}
