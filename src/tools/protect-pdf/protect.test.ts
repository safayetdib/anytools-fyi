import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makePdf } from "../../../tests/fixtures/pdf";
import { IN, OUT } from "../../lib/pdf/qpdf";
import { nodeQpdf } from "../../lib/pdf/qpdf-node.test-helper";
import { passwordProblem } from "./password";
import { protectPdf, protectedName } from "./protect";

describe("passwordProblem", () => {
  it("needs a password, typed the same twice", () => {
    expect(passwordProblem("", "")).toBe("empty");
    expect(passwordProblem("secret", "secrte")).toBe("mismatch");
    expect(passwordProblem("x".repeat(128), "x".repeat(128))).toBe("long");
    expect(passwordProblem("গোপন কথা 1", "গোপন কথা 1")).toBeNull();
  });
});

describe("protectPdf", () => {
  it("locks the file with AES-256: it opens only with the password", async () => {
    const locked = await protectPdf(nodeQpdf, await makePdf([200, 300], 400), "sécret ১২৩");
    await expect(PDFDocument.load(locked)).rejects.toThrow(/encrypted/);
    expect((await nodeQpdf(["--show-encryption", "--password=sécret ১২৩", IN], locked)).code).toBe(0);
    expect((await nodeQpdf(["--password=wrong", "--decrypt", IN, OUT], locked)).output).toBeNull();
    const opened = await nodeQpdf(["--password=sécret ১২৩", "--decrypt", IN, OUT], locked);
    expect((await PDFDocument.load(opened.output as Uint8Array)).getPageCount()).toBe(2);
  });

  it("doesn't make the file bigger, though the lock adds a little", async () => {
    const bytes = await makePdf(Array.from({ length: 40 }, (_, index) => 200 + index));
    expect((await protectPdf(nodeQpdf, bytes, "secret")).length).toBeLessThan(bytes.length);
  });

  it("refuses a file that already needs a password, and one that isn't a PDF", async () => {
    const locked = await protectPdf(nodeQpdf, await makePdf([200], 200), "first");
    await expect(protectPdf(nodeQpdf, locked, "second")).rejects.toMatchObject({ code: "locked" });
    await expect(protectPdf(nodeQpdf, new Uint8Array([1, 2, 3]), "x")).rejects.toMatchObject({ code: "unreadable" });
    await expect(protectPdf(nodeQpdf, await makePdf([200], 200), "")).rejects.toMatchObject({ code: "password" });
  });

  it("names the result like other tools", () => {
    expect(protectedName("report.PDF")).toBe("report_protected.pdf");
  });
});
