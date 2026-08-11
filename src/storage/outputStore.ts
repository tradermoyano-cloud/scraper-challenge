import fs from "fs";
import path from "path";
import { DocumentRecord, FailedPdf, ScrapeSummary } from "../types";

export class OutputStore {
  readonly root: string;
  readonly pdfDir: string;
  private readonly documentsPath: string;
  private readonly failedPath: string;
  private readonly summaryPath: string;

  constructor(outputDir: string) {
    this.root = path.resolve(outputDir);
    this.pdfDir = path.join(this.root, "pdfs");
    this.documentsPath = path.join(this.root, "documents.jsonl");
    this.failedPath = path.join(this.root, "failed-pdfs.json");
    this.summaryPath = path.join(this.root, "summary.json");

    fs.mkdirSync(this.pdfDir, { recursive: true });
    if (!fs.existsSync(this.documentsPath)) {
      fs.writeFileSync(this.documentsPath, "", "utf8");
    }
  }

  appendDocument(doc: DocumentRecord): void {
    fs.appendFileSync(this.documentsPath, `${JSON.stringify(doc)}\n`, "utf8");
  }

  writeFailedPdfs(failures: FailedPdf[]): void {
    fs.writeFileSync(this.failedPath, JSON.stringify(failures, null, 2), "utf8");
  }

  writeSummary(summary: ScrapeSummary): void {
    fs.writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2), "utf8");
  }

  pdfPathFor(filename: string): string {
    return path.join(this.pdfDir, filename);
  }

  existsPdf(filename: string): boolean {
    return fs.existsSync(this.pdfPathFor(filename));
  }

  writePdf(filename: string, data: Buffer): string {
    const full = this.pdfPathFor(filename);
    fs.writeFileSync(full, data);
    return full;
  }
}
