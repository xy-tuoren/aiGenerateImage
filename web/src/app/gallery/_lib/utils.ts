export const normalizeMaterialUrl = (input: string) => {
  const raw = String(input || "").trim();
  if (!raw) return raw;
  if (!raw.startsWith("/material/")) return raw;
  const qPos = raw.indexOf("?");
  const base = qPos >= 0 ? raw.slice(0, qPos) : raw;
  const query = qPos >= 0 ? raw.slice(qPos) : "";
  const segs = base.split("/").map((seg, idx) => {
    if (idx <= 1) return seg; // "" + "material"
    try {
      return encodeURIComponent(decodeURIComponent(seg));
    } catch {
      return encodeURIComponent(seg);
    }
  });
  return `${segs.join("/")}${query}`;
};

export const getCostFromImageUrl = (imageUrl: string) => {
  try {
    const lastSegRaw = imageUrl.split("/").pop() || "";
    const lastSeg = lastSegRaw.split("?")[0]?.split("#")[0] || "";
    const decoded = decodeURIComponent(lastSeg);
    const base = decoded.replace(/\.[^.]+$/, "");
    const m = base.match(/-(\d+)$/);
    const cost = m?.[1] ?? "";
    return cost;
  } catch {
    return "";
  }
};

