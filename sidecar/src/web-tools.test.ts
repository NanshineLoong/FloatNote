import { describe, expect, it, vi } from "vitest";
import { assertPublicWebUrl, createWebTools, htmlToReadableText } from "./web-tools.js";

describe("assertPublicWebUrl", () => {
  it("accepts a public https URL", async () => {
    await expect(assertPublicWebUrl("https://example.com/a", async () => ["93.184.216.34"]))
      .resolves.toMatchObject({ hostname: "example.com", protocol: "https:" });
  });

  it.each([
    ["file:///etc/passwd", "仅支持"],
    ["http://user:pass@example.com", "凭据"],
    ["http://127.0.0.1", "非公网"],
    ["http://169.254.169.254/latest", "非公网"],
    ["http://10.0.0.1", "非公网"],
    ["http://[::1]", "非公网"],
  ])("rejects unsafe URL %s", async (url, message) => {
    await expect(assertPublicWebUrl(url, async (host) => [host.replace(/[\[\]]/g, "")]))
      .rejects.toThrow(message);
  });
});

describe("htmlToReadableText", () => {
  it("removes scripts and keeps title and readable text", () => {
    expect(htmlToReadableText("<title>Page</title><script>evil()</script><main><h1>Hello</h1><p>World</p></main>"))
      .toEqual({ title: "Page", text: "Hello\nWorld" });
  });
});

describe("web tools", () => {
  it("returns bounded search results from the injected adapter", async () => {
    const tools = createWebTools({
      lookup: async () => ["93.184.216.34"],
      search: async () => [{ title: "A", url: "https://a.example", snippet: "S" }],
      fetch: vi.fn(),
    });
    const tool = tools.find((candidate) => candidate.name === "web_search")!;
    const result = await (tool as any).execute("id", { query: "floatnote", count: 3 });
    expect(result.content[0].text).toContain("https://a.example");
    expect(result.content[0].text).toContain("不可信外部资料");
  });

  it("revalidates and rejects a redirect to a private address", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }));
    const tools = createWebTools({
      lookup: async (host) => [host === "example.com" ? "93.184.216.34" : "127.0.0.1"],
      search: async () => [],
      fetch: fetchMock,
    });
    const tool = tools.find((candidate) => candidate.name === "web_fetch")!;
    await expect((tool as any).execute("id", { url: "https://example.com" })).rejects.toThrow(/非公网/);
  });
});
