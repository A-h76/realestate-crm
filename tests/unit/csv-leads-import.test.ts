import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLeadCsv } from "../../src/lib/csv/leads";

const HEADER = "firstName,lastName,email,phone,source";

function csv(...rows: string[]) {
  return [HEADER, ...rows].join("\n");
}

describe("parseLeadCsv — US phone numbers are normalized on the way in", () => {
  it("stores the canonical E.164 form whatever spelling the file used", () => {
    const result = parseLeadCsv(
      csv(
        "Brianna,Whitfield,b@demo.example,(415) 555-0123,ZILLOW",
        "Marcus,Delgado,m@demo.example,312-555-0188,WEB_FORM",
        "Danielle,Okonkwo,d@demo.example,+1 480 555 0173,OPEN_HOUSE",
      ),
    );
    assert.deepEqual(result.invalid, []);
    assert.deepEqual(
      result.valid.map((r) => r.phone),
      ["+14155550123", "+13125550188", "+14805550173"],
    );
  });

  it("defaults whatsappNumber to the canonical phone, not the raw text", () => {
    const result = parseLeadCsv(csv("Brianna,Whitfield,b@demo.example,(415) 555-0123,ZILLOW"));
    assert.equal(result.valid[0].whatsappNumber, "+14155550123");
  });
});

describe("parseLeadCsv — invalid phone numbers are reported, never stored as typed", () => {
  it("rejects the row and names the field and the offending value", () => {
    const result = parseLeadCsv(csv("Bad,Row,bad@demo.example,555,ZILLOW"));
    assert.equal(result.valid.length, 0);
    assert.equal(result.invalid.length, 1);
    assert.equal(result.invalid[0].field, "phone");
    assert.match(result.invalid[0].message, /555/);
    assert.match(result.invalid[0].message, /valid|incomplete|recognizable/i);
  });

  it("reports an incomplete number rather than half-normalizing it", () => {
    const result = parseLeadCsv(csv("Short,Number,s@demo.example,415555012,ZILLOW"));
    assert.equal(result.valid.length, 0);
    assert.equal(result.invalid[0].field, "phone");
  });

  it("keeps good rows and reports only the bad ones", () => {
    const result = parseLeadCsv(
      csv(
        "Good,One,g1@demo.example,(415) 555-0123,ZILLOW",
        "Bad,One,b1@demo.example,n/a,ZILLOW",
        "Good,Two,g2@demo.example,312-555-0188,ZILLOW",
      ),
    );
    assert.equal(result.valid.length, 2);
    assert.equal(result.invalid.length, 1);
    assert.equal(result.invalid[0].row, 3, "row number points at the real line in the file");
  });

  it("accepts a row with no phone column value at all", () => {
    const result = parseLeadCsv(csv("No,Phone,np@demo.example,,REFERRAL"));
    assert.deepEqual(result.invalid, []);
    assert.equal(result.valid[0].phone, undefined);
  });
});

describe("parseLeadCsv — in-file duplicate detection", () => {
  it("flags two rows that are the same person written differently", () => {
    const result = parseLeadCsv(
      csv("Brianna,Whitfield,,(415) 555-0123,ZILLOW", "B,Whitfield,,415-555-0123,ZILLOW"),
    );
    assert.deepEqual(result.duplicatesInFile, [3]);
    assert.equal(result.valid.length, 1);
    assert.equal(result.invalid[0].field, "duplicate");
  });

  it("does not flag two different numbers as duplicates", () => {
    const result = parseLeadCsv(
      csv("A,One,,(415) 555-0123,ZILLOW", "B,Two,,(415) 555-0124,ZILLOW"),
    );
    assert.deepEqual(result.duplicatesInFile, []);
    assert.equal(result.valid.length, 2);
  });
});

describe("parseLeadCsv — unknown lead sources are rejected", () => {
  it("rejects values outside the source list", () => {
    for (const source of ["NOT_A_SOURCE", "zillow2"]) {
      const result = parseLeadCsv(csv(`X,Y,x@demo.example,(415) 555-0123,${source}`));
      assert.equal(result.valid.length, 0, source);
      assert.equal(result.invalid[0].field, "source", source);
    }
  });

  it("accepts the US sources", () => {
    for (const source of ["ZILLOW", "REALTOR_COM", "HOMES_COM", "WEB_FORM", "OPEN_HOUSE", "SIGN_CALL", "AGENT_REFERRAL"]) {
      const result = parseLeadCsv(csv(`X,Y,,(415) 555-0123,${source}`));
      assert.deepEqual(result.invalid, [], source);
      assert.equal(result.valid[0].source, source);
    }
  });
});
