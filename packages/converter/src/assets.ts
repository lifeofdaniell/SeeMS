import path from "path";

const RESPONSIVE_VARIANT_RE = /-p-(?:\d+(?:x\d+q\d+)?)(?=\.[^.]+$)/i;

export function isResponsiveImageVariant(filePath: string): boolean {
  return RESPONSIVE_VARIANT_RE.test(path.basename(filePath));
}

export function toOriginalImageCandidate(filePath: string): string {
  return filePath.replace(RESPONSIVE_VARIANT_RE, "");
}

export function normalizeAssetUrl(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

export function normalizePublicAssetPath(src: string): string {
  if (!src || /^(https?:)?\/\//i.test(src) || src.startsWith("data:")) {
    return src;
  }

  let normalized = normalizeAssetUrl(src).replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
  normalized = toOriginalImageCandidate(normalized);

  // Serve assets at Webflow's native root paths (/images/, /css/, …) so refs
  // baked into Webflow's JS resolve too. Strip any legacy /assets/ prefix.
  if (normalized.startsWith("/assets/")) {
    return normalized.replace(/^\/assets\//, "/").replace(/\/\.\.\//g, "/");
  }

  return `/${normalized.replace(/^\/+/, "")}`;
}

export function normalizeImageSeedPath(imageSrc: string): string {
  if (!imageSrc) return "";
  if (/^(https?:)?\/\//i.test(imageSrc) || imageSrc.startsWith("data:")) return imageSrc;

  const [pathPart] = imageSrc.split(/[?#]/);
  const decoded = normalizeAssetUrl(pathPart).replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
  const withoutLeadingSlash = decoded.replace(/^\/+/, "");
  const withoutAssetsPrefix = withoutLeadingSlash.replace(/^assets\/images\//, "images/");
  const imageIndex = withoutAssetsPrefix.indexOf("images/");
  const imagePath = imageIndex >= 0 ? withoutAssetsPrefix.slice(imageIndex) : `images/${path.basename(withoutAssetsPrefix)}`;

  return `/${toOriginalImageCandidate(imagePath)}`;
}

export function mediaLookupKeys(value: string): string[] {
  if (!value) return [];

  const decoded = normalizeAssetUrl(value);
  const withoutLeadingSlash = decoded.replace(/^\/+/, "");
  const withoutAssetsPrefix = withoutLeadingSlash.replace(/^assets\/images\//, "images/");
  const withoutImagesPrefix = withoutAssetsPrefix.replace(/^images\//, "");
  const original = toOriginalImageCandidate(withoutImagesPrefix);
  const basename = path.basename(original);
  const basenameHyphenated = basename.replace(/\s+/g, "-");

  return Array.from(new Set([
    decoded,
    withoutLeadingSlash,
    withoutAssetsPrefix,
    withoutImagesPrefix,
    original,
    basename,
    basenameHyphenated,
    `/images/${withoutImagesPrefix}`,
    `images/${withoutImagesPrefix}`,
    `/images/${original}`,
    `images/${original}`,
    `/assets/images/${withoutImagesPrefix}`,
    `assets/images/${withoutImagesPrefix}`,
    `/assets/images/${original}`,
    `assets/images/${original}`,
  ]));
}

export function isLikelyImagePath(value: string): boolean {
  return /\.(?:jpe?g|png|gif|webp|avif|svg)(?:[?#].*)?$/i.test(value);
}
