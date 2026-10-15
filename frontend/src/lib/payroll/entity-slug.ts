/** Potongan nama file dari nama entitas: huruf kecil, huruf/angka dipisah "-". */
export function entitySlug(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `base` + `-<slug entitas>` bila entitas diketahui (nama file ekspor). */
export function withEntitySlug(base: string, entityName: string | null | undefined): string {
  const slug = entitySlug(entityName);
  return slug ? `${base}-${slug}` : base;
}
