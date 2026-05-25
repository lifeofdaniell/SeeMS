import path from "path";

export interface PageRouteInfo {
  sourcePath: string;
  pageId: string;
  route: string;
  outputPath: string;
}

export function htmlPathToPageId(htmlPath: string): string {
  const withoutExt = htmlPath.replace(/\.html$/i, "");
  return withoutExt.replace(/[\\/]/g, "-");
}

export function htmlPathToRoute(htmlPath: string): string {
  const normalized = htmlPath.replace(/\\/g, "/").replace(/\.html$/i, "");

  if (normalized === "index" || normalized.endsWith("/index")) {
    const parent = normalized.replace(/(^|\/)index$/, "");
    return parent ? `/${parent}` : "/";
  }

  return `/${normalized}`;
}

export function htmlPathToVuePath(htmlPath: string): string {
  return htmlPath.replace(/\.html$/i, ".vue");
}

export function getPageRouteInfo(htmlPath: string): PageRouteInfo {
  return {
    sourcePath: htmlPath,
    pageId: htmlPathToPageId(htmlPath),
    route: htmlPathToRoute(htmlPath),
    outputPath: path.posix.join("pages", htmlPathToVuePath(htmlPath).replace(/\\/g, "/"))
  };
}

export function routeToPageId(route: string): string {
  const normalized = route.replace(/^\/+|\/+$/g, "");
  return normalized ? normalized.replace(/\//g, "-") : "index";
}
