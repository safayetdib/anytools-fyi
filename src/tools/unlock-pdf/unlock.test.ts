import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makePdf } from "../../../tests/fixtures/pdf";
import { IN, OUT } from "../../lib/pdf/qpdf";
import { nodeQpdf } from "../../lib/pdf/qpdf-node.test-helper";
import { protectPdf } from "../protect-pdf/protect";
import { readPasswords } from "./passwords";
import { unlockPdf, unlockedName } from "./unlock";

describe("unlockPdf", () => {
  it("removes an open password, given the right one", async () => {
    const locked = await protectPdf(nodeQpdf, await makePdf([200, 300], 400), "গোপন 42");
    const open = await unlockPdf(nodeQpdf, locked, "গোপন 42");
    expect((await PDFDocument.load(open)).getPageCount()).toBe(2);
  });

  it("doesn't make the file bigger than it was before it was locked", async () => {
    const bytes = await makePdf(Array.from({ length: 40 }, (_, index) => 200 + index));
    const open = await unlockPdf(nodeQpdf, await protectPdf(nodeQpdf, bytes, "secret"), "secret");
    expect(open.length).toBeLessThan(bytes.length);
  });

  it("says when the password is wrong or missing", async () => {
    const locked = await protectPdf(nodeQpdf, await makePdf([200], 200), "right");
    await expect(unlockPdf(nodeQpdf, locked, "wrong")).rejects.toMatchObject({ code: "password" });
    await expect(unlockPdf(nodeQpdf, locked)).rejects.toMatchObject({ code: "needsPassword" });
  });

  it("removes print and copy restrictions without a password", async () => {
    const restricted = await nodeQpdf(["--encrypt", "--user-password=", "--owner-password=owner", "--bits=256", "--print=none", "--extract=n", "--", IN, OUT], await makePdf([200], 200));
    const open = await unlockPdf(nodeQpdf, restricted.output as Uint8Array);
    expect((await PDFDocument.load(open)).getPageCount()).toBe(1);
  });

  it("tells a file without protection from one that isn't a PDF", async () => {
    await expect(unlockPdf(nodeQpdf, await makePdf([200], 200))).rejects.toMatchObject({ code: "notLocked" });
    await expect(unlockPdf(nodeQpdf, new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("readPasswords and unlockedName", () => {
  it("reads one password for each file", () => {
    expect(readPasswords('["a", 3, ""]')).toEqual(["a", "", ""]);
    expect(readPasswords("nope")).toEqual([]);
  });

  it("names the result like other tools", () => {
    expect(unlockedName("report.pdf")).toBe("report_unlocked.pdf");
  });
});
