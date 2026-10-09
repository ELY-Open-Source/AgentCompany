import { describe, expect, test } from "vitest";
import { scanFileContent } from "../../src/main/services/files/file-object-store";

const MIB = 1024 * 1024;

describe("the file scan", () => {
  test("checks the whole file, not just its first MiB, including a secret that straddles a window edge", () => {
    const padding = "x".repeat(3 * MIB);
    expect(scanFileContent("notes.txt", Buffer.from(`${padding}\nAKIAABCDEFGHIJKLMNOP\n`)).state).toBe("blocked");
    const straddling = Buffer.concat([Buffer.alloc(MIB - 10, "y"), Buffer.from("-----BEGIN RSA PRIVATE KEY-----")]);
    expect(scanFileContent("key.txt", straddling).labels).toContain("dlp:private-key");
    expect(scanFileContent("eicar.txt", Buffer.from(`${padding}X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`)).labels).toContain("av:eicar");
  });

  test("no pattern match can stretch past the window overlap", () => {
    const edge = Buffer.concat([Buffer.alloc(MIB - 20, "z"), Buffer.from(`password:${"\n".repeat(5000)}${"A".repeat(32)}`)]);
    // Whitespace between a key name and its value is bounded; a value 5,000 lines away is not that key's value.
    expect(scanFileContent("far.txt", edge).labels).not.toContain("dlp:credential");
    const long = Buffer.concat([Buffer.alloc(MIB - 10, "z"), Buffer.from(` ghp_${"a".repeat(9000)} `)]);
    expect(scanFileContent("token.txt", long).labels).toContain("dlp:github-token");
    expect(scanFileContent("plan.md", Buffer.from("# Plan")).labels).toContain("scan:whole-file");
  });

  test("a window cut does not invent a word boundary", () => {
    const inWord = Buffer.concat([Buffer.alloc(MIB - 4, "z"), Buffer.from("NOT_AKIAABCDEFGHIJKLMNOP\n")]);
    expect(scanFileContent("a.txt", inWord).state).toBe("approved");
    const alone = Buffer.concat([Buffer.alloc(MIB - 1, "z"), Buffer.from(" AKIAABCDEFGHIJKLMNOP\n")]);
    expect(scanFileContent("b.txt", alone).state).toBe("blocked");
    // The far edge too: a longer word whose first 20 characters end exactly at a window's last byte is not a key.
    const atTail = Buffer.concat([Buffer.alloc(MIB + 4096 - 20, "z"), Buffer.from(" AKIAABCDEFGHIJKLMNOPZ\n")]);
    expect(scanFileContent("c.txt", atTail).state).toBe("approved");
    const atOwnEnd = Buffer.concat([Buffer.alloc(MIB - 20, "z"), Buffer.from(" AKIAABCDEFGHIJKLMNOPZ\n")]);
    expect(scanFileContent("d.txt", atOwnEnd).state).toBe("approved");
  });

  test("a container whose contents are compressed or encoded is labelled as not inspected inside", () => {
    expect(scanFileContent("report.docx", Buffer.from("PK\u0003\u0004rest")).labels).toContain("scan:contents-not-inspected");
    expect(scanFileContent("deck.pdf", Buffer.from("%PDF-1.7 ...")).labels).toContain("scan:contents-not-inspected");
    expect(scanFileContent("archive.gz", Buffer.from([0x1f, 0x8b, 0x08, 0x00])).labels).toContain("scan:contents-not-inspected");
    expect(scanFileContent("photo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])).labels).toContain("scan:contents-not-inspected");
    expect(scanFileContent("plan.md", Buffer.from("# Plan")).labels).not.toContain("scan:contents-not-inspected");
  });
});
