import path from "path";
import { scrape } from "./scraper";
import { logger } from "./logger";
import { ScrapeOptions, SiteId } from "./types";

function printHelp(): void {
  console.log(`
scraper-challenge — scraper HTTP (TypeScript) para portales JSF peruanos

Uso:
  npm run scrape -- --site <pj|oefa> [opciones]

Sitios:
  pj     Jurisprudencia PJ (requiere VPN a Perú)
         https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml
  oefa   Repositorio Digital OEFA (sin VPN)
         https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml

Opciones:
  --site <pj|oefa>       Sitio a scrapear (default: oefa)
  --max-pages <n>        Máximo de páginas (<n> = entero ≥ 1; omitir = sin tope)
  --max-docs <n>         Máximo de documentos (<n> = entero ≥ 1; omitir = sin tope)
  --pdfs                 Descargar PDFs (default: sí)
  --delay <ms>           Delay entre requests en ms (<ms> = entero ≥ 0; default: 800)
  --retries <n>          Reintentos ante 429/errores (<n> = entero ≥ 1; default: 5)
  --out <dir>            Directorio de salida (default: output/<site>-<timestamp>)
  --filter key=value     Filtro de búsqueda (repetible)
  --help                 Mostrar esta ayuda

Ejemplos:
  # Demo OEFA sin VPN: 1 página + 2 docs + PDFs
  npm run scrape -- --site oefa --max-pages 1 --max-docs 2

  # PJ con VPN: primeras 3 páginas + PDFs
  npm run scrape -- --site pj --max-pages 3 --delay 1200
`);
}

function parseArgs(argv: string[]): ScrapeOptions & { help?: boolean } {
  const args = [...argv];
  let site: SiteId = "oefa";
  let maxPages: number | undefined;
  let maxDocuments: number | undefined;
  let downloadPdfs = true;
  let delayMs = 800;
  let maxRetries = 5;
  let outputDir = "";
  const filters: Record<string, string> = {};
  let help = false;

  while (args.length > 0) {
    const token = args.shift()!;
    switch (token) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--site":
        site = (args.shift() as SiteId) ?? "oefa";
        break;
      case "--max-pages":
        maxPages = Number.parseInt(args.shift() ?? "", 10);
        break;
      case "--max-docs":
        maxDocuments = Number.parseInt(args.shift() ?? "", 10);
        break;
      case "--pdfs":
        downloadPdfs = true;
        break;
      case "--delay":
        delayMs = Number.parseInt(args.shift() ?? "", 10);
        break;
      case "--retries":
        maxRetries = Number.parseInt(args.shift() ?? "", 10);
        break;
      case "--out":
        outputDir = args.shift() ?? "";
        break;
      case "--filter": {
        const raw = args.shift() ?? "";
        const eq = raw.indexOf("=");
        if (eq > 0) {
          filters[raw.slice(0, eq)] = raw.slice(eq + 1);
        }
        break;
      }
      default:
        logger.warn(`Argumento desconocido ignorado: ${token}`);
    }
  }

  if (!outputDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    outputDir = path.join("output", `${site}-${stamp}`);
  }

  return {
    site,
    maxPages: Number.isFinite(maxPages) ? maxPages : undefined,
    maxDocuments: Number.isFinite(maxDocuments) ? maxDocuments : undefined,
    downloadPdfs,
    delayMs: Number.isFinite(delayMs) ? delayMs : 800,
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : 5,
    outputDir,
    filters,
    help,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.site !== "pj" && options.site !== "oefa") {
    console.error(`Sitio inválido: ${String(options.site)}. Usa pj u oefa.`);
    process.exitCode = 1;
    return;
  }

  logger.info("Iniciando scraper", {
    site: options.site,
    maxPages: options.maxPages ?? "∞",
    maxDocuments: options.maxDocuments ?? "∞",
    downloadPdfs: options.downloadPdfs,
    outputDir: options.outputDir,
  });

  try {
    await scrape(options);
  } catch (error) {
    logger.error(
      error instanceof Error ? error.message : "Error desconocido",
      error
    );
    process.exitCode = 1;
  }
}

void main();
