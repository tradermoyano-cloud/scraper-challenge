import { HttpClient } from "../http/client";
import {
  encodeForm,
  extractViewState,
  FilterOption,
  mergePartialUpdates,
  resolveFromOptions,
} from "../jsf/helpers";
import { logger } from "../logger";
import { PageResult } from "../types";
import pjDistritoData from "./data/pj-distrito.json";
import pjEspecialidadData from "./data/pj-especialidad.json";
import pjNivelData from "./data/pj-nivel.json";
import pjOrganoData from "./data/pj-organo.json";
import pjTipoRecursoData from "./data/pj-tipo-recurso.json";
import pjTipoResolucionData from "./data/pj-tipo-resolucion.json";
import { parsePjResultHtml } from "./pjParse";

const HOST = "https://jurisprudencia.pj.gob.pe";
const INICIO = `${HOST}/jurisprudenciaweb/faces/page/inicio.xhtml`;
const RESULTADO = `${HOST}/jurisprudenciaweb/faces/page/resultado.xhtml`;
const FORM = "formBuscador";
const SCROLLER = `${FORM}:data1`;

/**
 * Mapas internos nombre→código (listas planas únicas). El CLI acepta
 * etiquetas del portal; estos mapas producen el código del POST.
 */
const PJ_NIVEL = pjNivelData as FilterOption[];
const PJ_DISTRITO = pjDistritoData as FilterOption[];
const PJ_ESPECIALIDAD = pjEspecialidadData as FilterOption[];
const PJ_ORGANO = pjOrganoData as FilterOption[];
const PJ_TIPO_RECURSO = pjTipoRecursoData as FilterOption[];
const PJ_TIPO_RESOLUCION = pjTipoResolucionData as FilterOption[];

export function resolvePjCorte(raw?: string): string {
  return resolveFromOptions(raw, PJ_NIVEL, "1");
}

export function resolvePjDistrito(raw?: string): string {
  return resolveFromOptions(raw, PJ_DISTRITO, "0");
}

export function resolvePjEspecialidad(raw?: string): string {
  return resolveFromOptions(raw, PJ_ESPECIALIDAD, "0");
}

/** Órgano Jurisdiccional (campo buSala del portal). */
export function resolvePjOrgano(raw?: string): string {
  return resolveFromOptions(raw, PJ_ORGANO, "0");
}

/** Tipo de recurso (`buTipoRecurso`). */
export function resolvePjTipoRecurso(raw?: string): string {
  return resolveFromOptions(raw, PJ_TIPO_RECURSO, "0");
}

/** Tipo de resolución (`buTipoResolucion`). */
export function resolvePjTipoResolucion(raw?: string): string {
  return resolveFromOptions(raw, PJ_TIPO_RESOLUCION, "0");
}

/**
 * Campos del formulario derivados de `--filter`, con las claves reales del
 * POST. `organo` es el nombre canónico (etiqueta real "Órgano
 * Jurisdiccional"); `sala` se acepta como alias retrocompatible.
 */
export function buildPjFilterFields(
  filters: Record<string, string> = {}
): Record<string, string> {
  const corte = resolvePjCorte(filters.corte);
  const distrito = resolvePjDistrito(filters.distrito);
  const especialidad = resolvePjEspecialidad(filters.especialidad);
  const organo = resolvePjOrgano(filters.organo ?? filters.sala);

  return {
    [`${FORM}:buCorte`]: corte,
    [`${FORM}:buDistrito`]: distrito,
    [`${FORM}:buEspecialidad`]: especialidad,
    [`${FORM}:buSala`]: organo,
    [`${FORM}:buAnio`]: filters.anio ?? "",
    [`${FORM}:buNroExpediente`]: filters.expediente ?? "",
    [`${FORM}:txtBusqueda`]: filters.q ?? "",
    [`${FORM}:buTipoRecurso`]: resolvePjTipoRecurso(filters.tipoRecurso),
    [`${FORM}:buTipoResolucion`]: resolvePjTipoResolucion(filters.tipoResolucion),
  };
}

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

  /**
   * Reproduce el valueChange AJAX real que dispara el portal al elegir
   * corte/distrito/especialidad. Necesario: el POST de búsqueda directo con
   * un distrito/especialidad no-default fue rechazado en pruebas reales con
   * `formBuscador:buDistrito: Validation Error: Value is not valid` — JSF
   * valida el valor enviado contra las opciones vigentes en el servidor, y
   * esas opciones solo se actualizan vía este AJAX. Sin encadenar esto,
   * distrito/especialidad/órgano distintos del default fallan en silencio
   * (0 resultados).
   */
  private async applyCascadeSelection(
    corte: string,
    distrito: string,
    especialidad: string
  ): Promise<void> {
    if (corte !== "1") {
      await this.ajaxValueChange("buCorte", { buCorte: corte });
    }
    if (distrito !== "0") {
      await this.ajaxValueChange("buDistrito", { buCorte: corte, buDistrito: distrito });
    }
    if (especialidad !== "0") {
      await this.ajaxValueChange("buEspecialidad", {
        buCorte: corte,
        buDistrito: distrito,
        buEspecialidad: especialidad,
      });
    }
  }

  private async ajaxValueChange(
    sourceField: string,
    fieldValues: Record<string, string>
  ): Promise<void> {
    const body = encodeForm({
      [FORM]: FORM,
      [`${FORM}:buCorte`]: "1",
      [`${FORM}:buDistrito`]: "0",
      [`${FORM}:buEspecialidad`]: "0",
      [`${FORM}:buSala`]: "0",
      [`${FORM}:buAnio`]: "",
      [`${FORM}:buNroExpediente`]: "",
      [`${FORM}:txtBusqueda`]: "",
      [`${FORM}:buTipoRecurso`]: "0",
      ...Object.fromEntries(Object.entries(fieldValues).map(([k, v]) => [`${FORM}:${k}`, v])),
      "javax.faces.partial.ajax": "true",
      "javax.faces.source": `${FORM}:${sourceField}`,
      "javax.faces.partial.execute": "@all",
      "javax.faces.partial.render": "@all",
      "javax.faces.behavior.event": "valueChange",
      "org.richfaces.ajax.component": `${FORM}:${sourceField}`,
      "javax.faces.ViewState": this.viewState,
    });

    logger.info(`PJ: valueChange AJAX de cascada (${sourceField})`);
    const res = await this.http.post(INICIO, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Faces-Request": "partial/ajax",
        "X-Requested-With": "XMLHttpRequest",
        Referer: INICIO,
      },
    });

    const raw = String(res.data);
    if (res.status >= 400 || raw.length < 80 || !raw.includes("partial-response")) {
      throw new Error(`PJ: valueChange de cascada (${sourceField}) falló con HTTP ${res.status}`);
    }
    const vs = extractViewState(raw);
    if (vs) this.viewState = vs;
  }

  async search(filters: Record<string, string> = {}): Promise<PageResult> {
    const corte = resolvePjCorte(filters.corte);
    const distrito = resolvePjDistrito(filters.distrito);
    const especialidad = resolvePjEspecialidad(filters.especialidad);
    await this.applyCascadeSelection(corte, distrito, especialidad);

    const body = encodeForm({
      [FORM]: FORM,
      ...buildPjFilterFields({ ...filters, corte, distrito, especialidad }),
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
