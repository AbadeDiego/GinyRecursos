import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const invoiceText = "Nota fiscal 12345";
const invoiceName = "Nota fiscal - João.pdf";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGfkAAAAASUVORK5CYII=", "base64");

function invoicePdf() {
  const stream = content => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 540] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 540] /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream(`BT /F1 20 Tf 25 500 Td (${invoiceText}) Tj ET`),
    stream("0.3 g 50 400 100 60 re f"),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return String(offset).padStart(10, "0");
  });
  return Buffer.from(pdf + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map(offset => `${offset} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`);
}

// Run after building. Use the same Playwright setup as scholarships-ui.test.mjs.
test("Anexos de lançamento no navegador: prévia, cópia, download e visualização no celular", { timeout: 90000 }, async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const dir = mkdtempSync(join(tmpdir(), "giny-expense-documents-"));
  const appDir = join(dir, "app");
  const origin = "http://127.0.0.1:4328";
  const email = "anexos@example.test";
  const password = randomUUID();
  let server, browser;

  try {
    cpSync(".next/standalone", appDir, { recursive: true });
    cpSync(".next/static", join(appDir, ".next/static"), { recursive: true });
    for (const folder of ["public", "server", "lib"]) cpSync(folder, join(appDir, folder), { recursive: true });
    server = spawn(process.execPath, [join(appDir, "server.js")], {
      cwd: appDir,
      env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: "4328",
        APP_ORIGIN: origin, DATABASE_PATH: join(dir, "db.sqlite"), ADMIN_EMAIL: email, ADMIN_NAME: "Documentos QA", ADMIN_PASSWORD: password },
      stdio: "ignore",
    });
    let ready = false;
    for (let index = 0; index < 100 && server.exitCode === null; index++) {
      try {
        if ((await fetch(origin + "/api/health", { signal: AbortSignal.timeout(1000) })).ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(100);
    }
    assert.ok(ready, "Servidor standalone indisponível");

    let cookie = "";
    async function post(path, data, files) {
      const headers = { origin, cookie, "idempotency-key": randomUUID() };
      let body;
      if (files) {
        body = new FormData();
        body.set("data", JSON.stringify(data));
        for (const [kind, [content, name]] of Object.entries(files)) body.set(kind, new Blob([content]), name);
      } else {
        headers["content-type"] = "application/json";
        body = JSON.stringify(data);
      }
      const response = await fetch(origin + "/api/" + path, { method: "POST", headers, body });
      assert.ok(response.ok, await response.clone().text());
      if (path === "auth/login") cookie = response.headers.get("set-cookie").split(";")[0];
      return response.json();
    }

    await post("auth/login", { email, password });
    const company = await post("companies", { name: "Empresa QA", short: "QA", cnpj: "123", city: "Recife", state: "PE", responsible: "QA", email, phone: "123" });
    const project = await post("projects", { companyId: company.id, name: "Projeto com anexos", code: "QA-1", agency: "Fundação", startDate: "2026-01-01", endDate: "2026-12-31", approved: 5000, counterpart: 0, installments: 1 });
    const rubric = "Material de Consumo";
    const activity = await post("schedule", { projectId: project.id, rubric, activity: "Compra de insumos", month: "Janeiro", year: 2026, value: 1000 });
    const pdf = invoicePdf();
    await post("expenses", { projectId: project.id, scheduleId: activity.id, supplier: "Fornecedor QA", description: "Compra com anexos", rubric, value: 100, date: "2026-01-12" },
      { invoice: [pdf, invoiceName], payment: [png, "Comprovante.png"] });

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ["--no-sandbox", "--disable-gpu", "--no-zygote"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    await context.addCookies([{ name: "subvencao_session", value: cookie.split("=")[1], url: origin }]);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole("button", { name: /^Lançamentos\b/ }).click();
    const rubricList = page.locator(".rubric-document-group");
    await rubricList.locator("summary").click();

    const previewButton = rubricList.getByRole("button", { name: `Visualizar ${invoiceName}` });
    const preview = page.getByRole("dialog", { name: invoiceName });
    await previewButton.click();
    await preview.getByText("Página 1 de 2").waitFor();
    const text = preview.locator(".textLayer").getByText(invoiceText, { exact: true });
    await text.waitFor();
    const bounds = await text.boundingBox();
    await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2, { steps: 12 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.getSelection().toString().trim()), invoiceText);
    await page.keyboard.press("ControlOrMeta+c");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), invoiceText);

    await preview.getByRole("button", { name: "Próxima página" }).click();
    await preview.getByText("Página 2 de 2").waitFor();
    await preview.getByText("Esta página não contém texto selecionável.").waitFor();
    await preview.getByRole("button", { name: "Aumentar zoom" }).click();
    await preview.getByText("125%", { exact: true }).waitFor();
    const downloaded = page.waitForEvent("download");
    await preview.getByRole("link", { name: "Baixar" }).click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), invoiceName);
    assert.deepEqual(readFileSync(await download.path()), pdf);

    await page.keyboard.press("Escape");
    await preview.waitFor({ state: "hidden" });
    assert.equal(await previewButton.evaluate(button => document.activeElement === button), true);
    await rubricList.getByRole("button", { name: "Visualizar Comprovante.png" }).click();
    const imagePreview = page.getByRole("dialog", { name: "Comprovante.png" });
    await imagePreview.getByRole("img").waitFor();
    await page.waitForFunction(() => document.querySelector("dialog img")?.naturalWidth > 0);
    await imagePreview.getByRole("button", { name: "Fechar visualização" }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await rubricList.getByRole("button", { name: "Abrir lançamento" }).click();
    const details = page.getByRole("dialog", { name: "Detalhes da despesa" });
    await details.getByRole("button", { name: `Visualizar ${invoiceName}` }).click();
    await preview.getByText("Selecione o texto no PDF para copiar.").waitFor();
    const mobileBounds = await preview.boundingBox();
    assert.ok(mobileBounds.width <= 390 && mobileBounds.height <= 844);
    await preview.getByRole("button", { name: "Fechar visualização" }).click();
    await details.getByRole("button", { name: "Editar lançamento" }).click();
    await page.getByRole("button", { name: "Editar documentos" }).click();
    await page.getByRole("dialog", { name: "Documentos comprobatórios" })
      .getByRole("button", { name: `Visualizar ${invoiceName}` }).click();
    await preview.getByText("Página 1 de 2").waitFor();
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (server?.exitCode === null) await new Promise(resolve => { server.once("exit", resolve); server.kill("SIGTERM"); });
    rmSync(dir, { recursive: true, force: true });
  }
});
