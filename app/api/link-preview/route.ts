import { NextRequest, NextResponse } from "next/server";

const MAX_HTML_LENGTH = 600_000;

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function getMeta(html: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
        "i",
      ),
    ];
    for (const pattern of patterns) {
      const value = html.match(pattern)?.[1];
      if (value) return decodeHtml(value.trim());
    }
  }
  return "";
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function absoluteUrl(value: string, base: URL) {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url")?.trim();
  if (!rawUrl) {
    return NextResponse.json({ error: "주소를 입력해 주세요." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "올바른 주소가 아닙니다." }, { status: 400 });
  }

  if (!["http:", "https:"].includes(target.protocol) || isPrivateHostname(target.hostname)) {
    return NextResponse.json({ error: "이 주소는 미리 볼 수 없습니다." }, { status: 400 });
  }

  try {
    const response = await fetch(target, {
      redirect: "follow",
      headers: {
        "user-agent": "PillarLinkPreview/1.0",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return NextResponse.json({
        url: target.toString(),
        title: target.hostname.replace(/^www\./, ""),
        description: "",
        siteName: target.hostname.replace(/^www\./, ""),
      });
    }

    const html = (await response.text()).slice(0, MAX_HTML_LENGTH);
    const title =
      getMeta(html, ["og:title", "twitter:title"]) ||
      decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "") ||
      target.hostname.replace(/^www\./, "");
    const description = getMeta(html, [
      "og:description",
      "twitter:description",
      "description",
    ]);
    const image = absoluteUrl(getMeta(html, ["og:image", "twitter:image"]), target);
    const siteName =
      getMeta(html, ["og:site_name"]) || target.hostname.replace(/^www\./, "");

    return NextResponse.json({
      url: target.toString(),
      title: title.slice(0, 180),
      description: description.slice(0, 320),
      image,
      siteName: siteName.slice(0, 80),
    });
  } catch {
    return NextResponse.json({
      url: target.toString(),
      title: target.hostname.replace(/^www\./, ""),
      description: "미리보기를 불러오지 못했습니다. 원래 링크는 그대로 저장됩니다.",
      siteName: target.hostname.replace(/^www\./, ""),
    });
  }
}
