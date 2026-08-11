import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectHasNextPage, parsePjResultHtml } from "./pjParse";
import * as cheerio from "cheerio";

const FIXTURE = `
<div id="formBuscador:repeat:0:j_idt455" class="rf-p">
  <div class="rf-p-hdr"><span>Apelación</span><span>036284-2025</span></div>
  <div class="rf-p-b">
    <span class="txtbold">Pretensión:</span><span>Acción de Amparo</span>
    <span class="txtbold">Tipo Resolución:</span><span>Ejecutoria Suprema</span>
    <span class="txtbold">Fecha Resolución:</span><span>31/07/2026</span>
    <span class="txtbold">Sala:</span><span>Quinta Sala</span>
    <div>
      <span class="txtbold">Sumilla:</span>
      <div>Declara infundado el recurso de apelación.</div>
    </div>
    <span class="txtbold">Materia:</span><span>Constitucional</span>
    <a href="/jurisprudenciaweb/ServletDescarga?uuid=abc-123">PDF</a>
  </div>
</div>
<div id="formBuscador:data1" class="rf-ds">
  <span class="rf-ds-btn rf-ds-btn-next">»</span>
</div>
`;

const FIXTURE_LAST_PAGE = `
<div id="formBuscador:repeat:0:j_idt455" class="rf-p">
  <div class="rf-p-hdr"><span>Casación</span><span>1-2020</span></div>
  <div class="rf-p-b">
    <span class="txtbold">Sumilla:</span><span>Texto breve</span>
  </div>
</div>
<div id="formBuscador:data1" class="rf-ds">
  <span class="rf-ds-btn rf-ds-btn-next rf-ds-dis">»</span>
</div>
`;

describe("parsePjResultHtml", () => {
  it("extrae campos, sumilla anidada y labels extra", () => {
    const page = parsePjResultHtml(FIXTURE, 1, "2026-08-10T00:00:00.000Z");
    assert.equal(page.documents.length, 1);
    const doc = page.documents[0];
    assert.equal(doc.fields.expediente, "036284-2025");
    assert.equal(doc.fields.pretension, "Acción de Amparo");
    assert.equal(doc.fields.sumilla, "Declara infundado el recurso de apelación.");
    assert.equal(doc.fields.materia, "Constitucional");
    assert.equal(doc.pdfUuid, "abc-123");
    assert.equal(page.hasNextPage, true);
  });

  it("detecta fin de paginación por rf-ds-dis", () => {
    const page = parsePjResultHtml(FIXTURE_LAST_PAGE, 3);
    assert.equal(page.hasNextPage, false);
    assert.equal(page.documents[0].fields.sumilla, "Texto breve");
  });
});

describe("detectHasNextPage", () => {
  it("fallback por tamaño de página si no hay scroller", () => {
    const $ = cheerio.load("<div>sin scroller</div>");
    assert.equal(detectHasNextPage($, 10), true);
    assert.equal(detectHasNextPage($, 3), false);
  });
});
