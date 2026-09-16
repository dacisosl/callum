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

// <link rel="..."> 태그에서 href를 꺼냅니다. og 태그가 없는 사이트의 대표 이미지와 아이콘을 찾는 데 씁니다.
function getLinkHref(html: string, rels: string[]) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const rel of rels) {
    for (const tag of tags) {
      const relValue = tag.match(/\brel=["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (!relValue || !relValue.split(/\s+/).includes(rel)) continue;
      const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
      if (href) return decodeHtml(href.trim());
    }
  }
  return "";
}

// JSON-LD 안의 image 값. 문자열일 수도, 객체나 배열일 수도 있습니다.
function getJsonLdImage(html: string) {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { continue; }
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (typeof node === "string") continue;
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (!node || typeof node !== "object") continue;
      const image = (node as Record<string, unknown>).image;
      if (typeof image === "string" && image) return image;
      if (Array.isArray(image) && typeof image[0] === "string") return image[0];
      if (image && typeof image === "object") {
        const url = (image as Record<string, unknown>).url;
        if (typeof url === "string" && url) return url;
      }
      stack.push(...Object.values(node as Record<string, unknown>));
    }
  }
  return "";
}

// 본문에서 쓸 만한 첫 이미지. 추적 픽셀과 아이콘은 건너뜁니다.
function getFirstImage(html: string) {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of tags.slice(0, 40)) {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src || src.startsWith("data:")) continue;
    if (/sprite|icon|logo-?mark|pixel|blank|spacer|1x1/i.test(src)) continue;
    const width = Number(tag.match(/\bwidth=["']?(\d+)/i)?.[1] ?? 0);
    const height = Number(tag.match(/\bheight=["']?(\d+)/i)?.[1] ?? 0);
    if ((width && width < 120) || (height && height < 120)) continue;
    return decodeHtml(src.trim());
  }
  return "";
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
    // 많은 사이트가 낯선 user-agent를 막습니다. 일반 브라우저와 같은 헤더로 요청합니다.
    const response = await fetch(target, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
      },
      signal: AbortSignal.timeout(12_000),
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
    const imageCandidate =
      getMeta(html, ["og:image:secure_url", "og:image:url", "og:image", "twitter:image:src", "twitter:image"]) ||
      getLinkHref(html, ["image_src"]) ||
      getMeta(html, ["itemprop:image"]) ||
      getJsonLdImage(html) ||
      getFirstImage(html);
    const image = absoluteUrl(imageCandidate, target);
    // 대표 이미지가 없는 사이트도 카드가 비어 보이지 않도록 아이콘을 함께 내려 줍니다.
    const icon =
      absoluteUrl(getLinkHref(html, ["apple-touch-icon", "apple-touch-icon-precomposed", "icon", "shortcut icon"]), target) ||
      absoluteUrl("/favicon.ico", target);
    const siteName =
      getMeta(html, ["og:site_name"]) || target.hostname.replace(/^www\./, "");

    return NextResponse.json({
      url: target.toString(),
      title: title.slice(0, 180),
      description: description.slice(0, 320),
      image,
      icon,
      siteName: siteName.slice(0, 80),
    });
  } catch (error) {
    // 사이트가 막았거나 응답이 늦은 경우입니다. 링크 자체는 그대로 쓸 수 있게 돌려줍니다.
    const reason = error instanceof Error && /HTTP 4\d\d/.test(error.message)
      ? "이 사이트가 미리보기 요청을 거절했습니다."
      : "미리보기를 불러오지 못했습니다.";
    return NextResponse.json({
      url: target.toString(),
      title: target.hostname.replace(/^www\./, ""),
      description: `${reason} 링크는 그대로 저장됩니다.`,
      icon: absoluteUrl("/favicon.ico", target),
      siteName: target.hostname.replace(/^www\./, ""),
    });
  }
}
