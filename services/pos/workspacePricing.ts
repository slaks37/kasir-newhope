import { ModuleAccessError } from "./modules";
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const id = (v: any) => typeof v === "string" && v.length > 0 && v.length <= 128;
const price = (v: any) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= 999999999 &&
  Math.abs(v * 100 - Math.round(v * 100)) < 0.001;
export function validateWorkspaceOptions(p: any) {
  const variants = p.variants ?? [],
    groups = p.modifierGroups ?? [];
  if (
    !Array.isArray(variants) ||
    !Array.isArray(groups) ||
    variants.length > 100 ||
    groups.length > 30 ||
    new Set(variants.map((v: any) => v?.id)).size !== variants.length ||
    new Set(groups.map((g: any) => g?.id)).size !== groups.length ||
    variants.some(
      (v: any) => !v || !id(v.id) || !id(v.name) || !price(v.priceExtra),
    )
  )
    throw new ModuleAccessError(400, "INVALID_CATALOG_OPTIONS");
  for (const g of groups)
    if (
      !g ||
      !id(g.id) ||
      !id(g.name) ||
      typeof g.required !== "boolean" ||
      !Array.isArray(g.options) ||
      !g.options.length ||
      g.options.length > 100 ||
      new Set(g.options.map((o: any) => o?.id)).size !== g.options.length ||
      g.options.some(
        (o: any) => !o || !id(o.id) || !id(o.name) || !price(o.price),
      ) ||
      (g.minSelect !== undefined &&
        (!Number.isInteger(g.minSelect) ||
          g.minSelect < 0 ||
          g.minSelect > g.options.length)) ||
      (g.maxSelect !== undefined &&
        (!Number.isInteger(g.maxSelect) ||
          g.maxSelect < 1 ||
          g.maxSelect > g.options.length)) ||
      (g.minSelect !== undefined &&
        g.maxSelect !== undefined &&
        g.minSelect > g.maxSelect)
    )
      throw new ModuleAccessError(400, "INVALID_CATALOG_OPTIONS");
}
export function priceWorkspaceSelection(product: any, input: any) {
  const p = product.workspace_payload || {};
  validateWorkspaceOptions(p);
  const variants = p.variants ?? [],
    groups = p.modifierGroups ?? [];
  const variant =
    input.variantId === undefined
      ? null
      : variants.find((v: any) => v.id === input.variantId);
  if (input.variantId !== undefined && !variant)
    throw new ModuleAccessError(409, "VARIANT_CHANGED_REVIEW_REQUIRED");
  const selections = input.selectedModifiers ?? [];
  if (
    !Array.isArray(selections) ||
    selections.length > 100 ||
    selections.some((s: any) => !s || !id(s.groupId) || !id(s.optionId)) ||
    new Set(selections.map((s: any) => s.groupId + "\0" + s.optionId)).size !==
      selections.length
  )
    throw new ModuleAccessError(400, "INVALID_MODIFIER_SELECTION");
  const modifiers = selections.map((s: any) => {
    const group = groups.find((g: any) => g.id === s.groupId),
      option = group?.options.find((o: any) => o.id === s.optionId);
    if (!option)
      throw new ModuleAccessError(409, "MODIFIER_CHANGED_REVIEW_REQUIRED");
    return {
      groupId: group.id,
      groupName: group.name,
      optionId: option.id,
      optionName: option.name,
      price: option.price,
    };
  });
  for (const g of groups) {
    const count = modifiers.filter((m: any) => m.groupId === g.id).length;
    const min = Math.max(g.required ? 1 : 0, g.minSelect ?? 0),
      max = g.maxSelect ?? g.options.length;
    if (count < min || count > max)
      throw new ModuleAccessError(409, "MODIFIER_COUNT_REVIEW_REQUIRED");
  }
  return {
    catalogRevision: Number(product.workspace_revision),
    productName: product.name,
    variant: variant
      ? { id: variant.id, name: variant.name, priceExtra: variant.priceExtra }
      : null,
    modifiers,
    unitPrice: money(
      Number(product.price) +
        (variant?.priceExtra ?? 0) +
        modifiers.reduce((n: number, m: any) => n + m.price, 0),
    ),
  };
}
