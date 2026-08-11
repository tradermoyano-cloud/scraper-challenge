import * as cheerio from "cheerio";
import { DocumentRecord, PageResult } from "../types";

const FORM = "formBuscador";
const HOST = "https://jurisprudencia.pj.gob.pe";

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLabel(raw: string): string {
  return cleanText(raw)
    .replace(/[:：]\s*$/, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

type CheerioAPI = cheerio.CheerioAPI;
type CheerioEl = ReturnType<CheerioAPI>;

/** Valor asociado a un nodo `.txtbold` (hermano, contenedor o texto residual). */
export function valueAfterLabel(
  $: CheerioAPI,
  labelEl: Parameters<CheerioAPI>[0]
): string {
  const $label = $(labelEl);
  const next = $label.next();
  if (next.length) {
    const t = cleanText(next.text());
    if (t) return t;
  }

  const parent = $label.parent();
  if (parent.length) {
    const clone = parent.clone();
    clone.find(".txtbold").first().remove();
    const t = cleanText(clone.text());
    if (t) return t;
  }

  const labelText = cleanText($label.text());
  const inline = labelText.match(/^[^:：]+[:：]\s*(.+)$/);
  if (inline?.[1]) return cleanText(inline[1]);
  return "";
}

/** Mapa label→valor desde bloques `.txtbold` del cuerpo del panel. */
export function extractLabeledFields(
  $: CheerioAPI,
  body: CheerioEl
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of body.find(".txtbold").toArray()) {
    const rawLabel = cleanText($(el).text());
    if (!rawLabel) continue;
    // Si el label trae valor inline "Sumilla: texto", usar solo la clave.
    const keySource = rawLabel.includes(":") || rawLabel.includes("：")
      ? rawLabel.replace(/[:：].*$/, "")
      : rawLabel;
    const key = normalizeLabel(keySource);
    if (!key) continue;
    const value = valueAfterLabel($, el);
    if (value) out[key] = value;
  }
  return out;
}

function pick(map: Record<string, string>, ...aliases: string[]): string {
  for (const a of aliases) {
    const v = map[normalizeLabel(a)];
    if (v) return v;
  }
  return "";
}

/**
 * ¿Hay página siguiente en el DataScroller RichFaces?
 * Prioridad: botón next no deshabilitado; si no hay scroller, fallback por tamaño de página.
 */
export function detectHasNextPage(
  $: CheerioAPI,
  documentsOnPage: number,
  pageSizeFallback = 10
): boolean {
  const byId = $("[id='formBuscador:data1']");
  const scroller =
    byId.length > 0 ? byId : $("[id$=':data1'], .rf-ds").first();

  if (scroller.length) {
    const nextBtn = scroller.find(".rf-ds-btn-next").first();
    if (nextBtn.length) {
      const cls = nextBtn.attr("class") ?? "";
      const disabled =
        cls.includes("rf-ds-dis") ||
        nextBtn.is("[disabled]") ||
        nextBtn.attr("aria-disabled") === "true";
      return !disabled;
    }

    const active = scroller.find(".rf-ds-act").first();
    const pages = scroller
      .find(".rf-ds-nmb-btn")
      .toArray()
      .map((el) => Number.parseInt(cleanText($(el).text()), 10))
      .filter((n) => Number.isFinite(n));
    if (active.length && pages.length) {
      const current = Number.parseInt(cleanText(active.text()), 10);
      const max = Math.max(...pages);
      if (Number.isFinite(current) && Number.isFinite(max)) {
        return current < max;
      }
    }
  }

  // Fallback: sin señal de scroller, asumir más páginas solo si la página viene llena.
  return documentsOnPage >= pageSizeFallback;
}

/** Parsea HTML (página completa o fragmento merged) de resultados PJ. */
export function parsePjResultHtml(
  html: string,
  currentPage: number,
  scrapedAt = new Date().toISOString()
): PageResult {
  const $ = cheerio.load(html);
  const documents: DocumentRecord[] = [];

  const panels = $("[id]")
    .toArray()
    .filter((el) => {
      const id = $(el).attr("id") ?? "";
      return (
        id.startsWith(`${FORM}:repeat:`) &&
        (id.endsWith(":j_idt455") || id.includes(":j_idt"))
      );
    });

  const targets =
    panels.length > 0
      ? panels.filter((el) => {
          const id = $(el).attr("id") ?? "";
          return /:repeat:\d+:j_idt\d+$/.test(id);
        })
      : $("[id^='formBuscador:repeat:']")
          .toArray()
          .filter((el) => {
            const id = $(el).attr("id") ?? "";
            return /^formBuscador:repeat:\d+$/.test(id);
          });

  const seen = new Set<string>();
  for (const panel of targets) {
    const $panel = $(panel);
    const panelId = $panel.attr("id") ?? "";
    const indexMatch = panelId.match(/:repeat:(\d+)/);
    const indexOnPage = indexMatch ? Number.parseInt(indexMatch[1], 10) : 0;
    if (seen.has(String(indexOnPage))) continue;
    seen.add(String(indexOnPage));

    const headerSpans = $panel
      .find(".rf-p-hdr span")
      .toArray()
      .map((el) => cleanText($(el).text()))
      .filter(Boolean);

    const tipoRecurso = headerSpans[0] ?? "";
    const expediente = headerSpans[1] ?? "";

    const body = $panel.find(".rf-p-b").first();
    const labeled = extractLabeledFields($, body);

    const rawHref =
      $panel.find('a[href*="ServletDescarga"]').first().attr("href") ?? "";
    const pdfUrl = rawHref
      ? rawHref.startsWith("http")
        ? rawHref
        : `${HOST}${rawHref.startsWith("/") ? "" : "/"}${rawHref}`
      : undefined;
    const pdfUuid = pdfUrl?.match(/uuid=([^&]+)/)?.[1];

    const fields: Record<string, string> = {
      tipoRecurso,
      expediente,
      pretension: pick(labeled, "Pretensión", "Pretension"),
      tipoResolucion: pick(labeled, "Tipo Resolución", "Tipo Resolucion"),
      fechaResolucion: pick(labeled, "Fecha Resolución", "Fecha Resolucion"),
      sala: pick(labeled, "Sala"),
      sumilla: pick(labeled, "Sumilla"),
    };

    for (const [key, value] of Object.entries(labeled)) {
      const known = new Set([
        "pretension",
        "tipo resolucion",
        "fecha resolucion",
        "sala",
        "sumilla",
      ]);
      if (known.has(key)) continue;
      if (!(key in fields) && value) fields[key] = value;
    }

    if (!expediente && !tipoRecurso) {
      fields.rawText = cleanText($panel.text()).slice(0, 2000);
    }

    const id =
      pdfUuid ??
      `${expediente || tipoRecurso || "doc"}-p${currentPage}-${indexOnPage}`;

    documents.push({
      site: "pj",
      id,
      page: currentPage,
      indexOnPage,
      fields,
      pdfUrl,
      pdfUuid,
      scrapedAt,
    });
  }

  return {
    documents,
    hasNextPage: detectHasNextPage($, documents.length),
    currentPage,
  };
}
