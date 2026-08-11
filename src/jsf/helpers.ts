import * as cheerio from "cheerio";

/** Extrae javax.faces.ViewState desde HTML o XML parcial. */
export function extractViewState(html: string): string | null {
  const $ = cheerio.load(html, { xml: false });
  const fromInput = $('input[name="javax.faces.ViewState"]').attr("value");
  if (fromInput) return fromInput;

  const cdata = html.match(
    /id="j_id1:javax\.faces\.ViewState:0"[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/
  );
  if (cdata?.[1]) return cdata[1];

  const generic = html.match(
    /javax\.faces\.ViewState[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>/
  );
  if (generic?.[1]) return generic[1];

  const attr = html.match(
    /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/
  );
  return attr?.[1] ?? null;
}

/** Convierte un objeto en body application/x-www-form-urlencoded. */
export function encodeForm(
  fields: Record<string, string | number | boolean | undefined | null>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  return params.toString();
}

/**
 * Extrae el HTML de un <update id="..."> de una partial-response JSF.
 * Si no hay match, retorna el cuerpo completo.
 */
export function extractPartialUpdate(
  partialXml: string,
  updateId?: string
): string {
  if (updateId) {
    const escaped = updateId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `<update id="${escaped}"><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></update>`
    );
    const match = partialXml.match(re);
    if (match?.[1]) return match[1];
  }

  const any = partialXml.match(
    /<update id="[^"]+"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/
  );
  return any?.[1] ?? partialXml;
}

/** Une todos los bloques CDATA de updates en un solo HTML. */
export function mergePartialUpdates(partialXml: string): string {
  const chunks: string[] = [];
  const re =
    /<update id="[^"]+"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(partialXml)) !== null) {
    chunks.push(match[1]);
  }
  return chunks.length > 0 ? chunks.join("\n") : partialXml;
}

export interface MojarraAction {
  formId: string;
  sourceId: string;
  paramUuid: string;
}

/** Parsea onclick mojarra.jsfcljs(...) usado por OEFA para PDFs. */
export function parseMojarraAction(onclick: string): MojarraAction | null {
  const match = onclick.match(
    /mojarra\.jsfcljs\(document\.getElementById\('([^']+)'\),\{'([^']+)':'([^']+)','param_uuid':'([^']+)'\}/
  );
  if (!match) return null;
  return {
    formId: match[1],
    sourceId: match[2],
    paramUuid: match[4],
  };
}

/**
 * Normaliza para comparar etiquetas de forma tolerante a mayúsculas,
 * tildes y decoración visual del portal (p. ej. la etiqueta real
 * "-- Todos --" debe emparejar con la entrada de usuario "Todos").
 */
function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resuelve el valor de un <select> aceptando código numérico tal cual, o
 * una etiqueta (case/tilde-insensitive) mapeada a su código. Si la
 * etiqueta no está en el mapa, la deja pasar sin cambios (permite seguir
 * usando códigos crudos que aún no se mapearon).
 */
export function resolveByLabel(
  raw: string | undefined,
  labelToCode: Record<string, string>
): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  if (/^\d+$/.test(t)) return t;
  return labelToCode[normalizeLabel(t)] ?? t;
}

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Como resolveByLabel, pero resuelve contra una lista real {value,label}
 * (p. ej. un mapa interno nombre→código) en vez de un mapa fijo escrito a
 * mano. Si hay etiquetas duplicadas en la lista (ocurre en catálogos grandes
 * con nombres repetidos, p. ej. "SALA CIVIL"), se resuelve la primera
 * coincidencia; usa el código numérico para desambiguar con certeza.
 */
export function resolveFromOptions(
  raw: string | undefined,
  options: FilterOption[],
  fallback: string
): string {
  const t = (raw ?? "").trim();
  if (!t) return fallback;
  if (/^\d+$/.test(t)) return t;
  const key = normalizeLabel(t);
  const match = options.find((o) => normalizeLabel(o.label) === key);
  return match?.value ?? fallback;
}

export function sanitizeFilename(value: string, maxLength = 120): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (cleaned || "documento").slice(0, maxLength);
}
