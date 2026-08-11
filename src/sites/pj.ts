import { HttpClient } from "../http/client";
import { encodeForm, extractViewState, mergePartialUpdates } from "../jsf/helpers";
import { logger } from "../logger";
import { PageResult } from "../types";
import { parsePjResultHtml } from "./pjParse";

const HOST = "https://jurisprudencia.pj.gob.pe";
const INICIO = `${HOST}/jurisprudenciaweb/faces/page/inicio.xhtml`;
const RESULTADO = `${HOST}/jurisprudenciaweb/faces/page/resultado.xhtml`;
const FORM = "formBuscador";
const SCROLLER = `${FORM}:data1`;

/**
 * Scraper del portal Jurisprudencia Nacional Sistematizada (PJ Perú).
 *
 * El portal usa JSF + RichFaces. Flujo:
 * 1) GET inicio.xhtml → cookies + ViewState
 * 2) POST formBuscador → redirect 302 a resultado.xhtml
 * 3) Parsear paneles RichFaces (formBuscador:repeat:N:...)
 * 4) Paginación AJAX vía DataScroller formBuscador:data1
 * 5) PDFs por URL directa /ServletDescarga?uuid=...
 *
 * Requiere VPN a Perú (sin ella suele responder HTTP 403).
 */
export class PjScraper {
  private viewState = "";
  private activeUrl = RESULTADO;

  constructor(private readonly http: HttpClient) {}

  getViewState(): string {
    return this.viewState;
  }

  async init(): Promise<void> {
    logger.info("PJ: abriendo inicio.xhtml");
    const res = await this.http.get(INICIO, { maxRedirects: 5 });
    if (res.status === 403) {
      throw new Error(
        "PJ respondió 403 Forbidden. Activa una VPN a Perú e inténtalo de nuevo."
      );
    }
    if (res.status >= 400) {
      throw new Error(`PJ inicio falló con HTTP ${res.status}`);
    }
    const vs = extractViewState(res.data);
    if (!vs) {
      throw new Error(
        "PJ: no se encontró ViewState. Posible soft-block o HTML inesperado."
      );
    }
    this.viewState = vs;
  }

  async search(filters: Record<string, string> = {}): Promise<PageResult> {
    const body = encodeForm({
      [FORM]: FORM,
      [`${FORM}:buCorte`]: filters.corte ?? "1",
      [`${FORM}:buDistrito`]: filters.distrito ?? "0",
      [`${FORM}:buEspecialidad`]: filters.especialidad ?? "0",
      [`${FORM}:buSala`]: filters.sala ?? "0",
      [`${FORM}:buAnio`]: filters.anio ?? "",
      [`${FORM}:txtBusqueda`]: filters.q ?? "",
      [`${FORM}:tabpanel-value`]: "general",
      forward: "buscar",
      busqueda: "especializada",
      [`${FORM}:j_idt34`]: "21",
      [`${FORM}:j_idt35`]: "DESC",
      [`${FORM}:j_idt36`]: "Principal",
      [`${FORM}:j_idt37`]: "1",
      [`${FORM}:j_idt31`]: "",
      "javax.faces.ViewState": this.viewState,
    });

    logger.info("PJ: enviando búsqueda (POST inicio.xhtml)");
    const res = await this.http.post(INICIO, body, {
      maxRedirects: 0,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: INICIO,
      },
      validateStatus: () => true,
    });

    // Axios con maxRedirects:0 aún puede devolver 302.
    let html = res.data as string;
    const locationHeader = res.headers.location as string | undefined;

    if (res.status >= 300 && res.status < 400 && locationHeader) {
      const upgraded = locationHeader.replace(/^http:\/\//i, "https://");
      const absolute = upgraded.startsWith("http")
        ? upgraded
        : `${HOST}${upgraded.startsWith("/") ? "" : "/"}${upgraded}`;
      this.activeUrl = absolute.split("?")[0].split(";")[0];
      logger.info(`PJ: siguiendo redirect a ${this.activeUrl}`);
      const follow = await this.http.get(absolute, {
        headers: { Referer: INICIO },
      });
      if (follow.status === 403) {
        throw new Error(
          "PJ respondió 403 en resultado.xhtml. Se requiere VPN a Perú."
        );
      }
      if (follow.status >= 400) {
        throw new Error(`PJ resultado falló con HTTP ${follow.status}`);
      }
      html = follow.data;
    } else if (res.status === 403) {
      throw new Error(
        "PJ respondió 403 Forbidden. Activa una VPN a Perú e inténtalo de nuevo."
      );
    } else if (res.status >= 400) {
      throw new Error(`PJ búsqueda falló con HTTP ${res.status}`);
    } else {
      this.activeUrl = RESULTADO;
    }

    const vs = extractViewState(html);
    if (vs) this.viewState = vs;
    return parsePjResultHtml(html, 1);
  }

  async goToPage(pageNumber: number): Promise<PageResult> {
    const body = encodeForm({
      "javax.faces.partial.ajax": "true",
      "javax.faces.source": SCROLLER,
      "javax.faces.partial.execute": SCROLLER,
      "javax.faces.partial.render": `${SCROLLER} ${FORM}:panel`,
      "javax.faces.behavior.event": "action",
      "org.richfaces.ajax.component": SCROLLER,
      [FORM]: FORM,
      [SCROLLER]: SCROLLER,
      [`${SCROLLER}:page`]: String(pageNumber),
      "javax.faces.ViewState": this.viewState,
    });

    logger.info(`PJ: paginación AJAX → página ${pageNumber}`);
    const res = await this.http.post(this.activeUrl, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Faces-Request": "partial/ajax",
        "X-Requested-With": "XMLHttpRequest",
        Referer: this.activeUrl,
      },
    });

    if (res.status === 429) {
      throw new Error("HTTP 429 en paginación PJ");
    }
    if (res.status >= 400) {
      throw new Error(`PJ paginación falló con HTTP ${res.status}`);
    }

    // Soft-block típico: 200 con partial-response vacío.
    const data = String(res.data);
    if (data.length < 80 || !data.includes("partial-response")) {
      throw new Error(
        "PJ devolvió respuesta AJAX vacía (posible soft-block por ViewState)."
      );
    }

    const vs =
      data.match(/id="javax\.faces\.ViewState"[^>]*value="([^"]+)"/)?.[1] ??
      extractViewState(data);
    if (vs) this.viewState = vs;

    const html = mergePartialUpdates(data);
    return parsePjResultHtml(html, pageNumber);
  }
}
