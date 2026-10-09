/** Explicit host-to-origin map for domains retained after the Mizu rename. */
export function legacyRedirectTarget(hostHeader: string, current: URL, mappings: string | undefined): URL | null {
  const host = hostHeader.split(":")[0].toLowerCase();
  if (!host || !mappings) return null;
  for (const entry of mappings.split(",")) {
    const split = entry.indexOf("=");
    if (split < 1) continue;
    const oldHost = entry.slice(0, split).trim().toLowerCase();
    if (oldHost !== host) continue;
    try {
      const origin = new URL(entry.slice(split + 1).trim());
      if (origin.protocol !== "https:" && origin.protocol !== "http:") return null;
      if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return null;
      return new URL(`${current.pathname}${current.search}`, origin);
    } catch { return null; }
  }
  return null;
}
