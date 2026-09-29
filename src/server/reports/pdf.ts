import "server-only";

import { chromium } from "playwright-core";

import { env } from "@/server/env";

// Server-side PDF generation: report HTML → headless Chromium → PDF (approved architecture).
// The HTML is self-contained (inline CSS, no scripts, no network), so JavaScript is disabled
// and every request is refused.

export class PdfUnavailableError extends Error {}

export async function htmlToPdf(documentHtml: string, footerLabel: string): Promise<Buffer> {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: env().VO_CHROMIUM_EXECUTABLE });
  } catch (err) {
    throw new PdfUnavailableError(
      `PDF generation is unavailable: Chromium could not be started (${(err as Error).message.split("\n")[0]}). ` +
        "Install it with `npx playwright install chromium` or set VO_CHROMIUM_EXECUTABLE.",
    );
  }
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(documentHtml, { waitUntil: "load" });
    const footer = footerLabel.replace(/[&<>"']/g, "");
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "14mm", bottom: "18mm", left: "14mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7px;color:#64748b;padding:0 14mm;display:flex;justify-content:space-between"><span>Cardaxia · Value Office · ${footer}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }
}
