/**
 * Spanish display labels for the canonical financial category keys. Mirrors the
 * mobile `formatCategoryLabel` table so retrieval text, model prompts and the
 * app all speak about categories with the same words.
 */
export const CATEGORY_LABELS_ES: Record<string, string> = {
  "food / delivery": "Comida / Delivery",
  "food / groceries": "Comida / Supermercado",
  subscriptions: "Suscripciones",
  "bills / utilities": "Cuentas / Servicios",
  transport: "Transporte",
  shopping: "Compras",
  health: "Salud",
  home: "Hogar",
  entertainment: "Entretenimiento",
  "going out": "Salidas",
  food: "Comida",
  finances: "Finanzas",
  income: "Ingresos",
  salary: "Sueldo",
  "freelance / client": "Freelance / Clientes",
  business: "Negocio",
  refund: "Reembolso",
  investments: "Inversiones",
  interest: "Intereses",
  gift: "Regalo",
  "other income": "Otros ingresos",
};

export function categoryLabelEs(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  if (!cleaned) return "Sin categoría";
  const normalized = cleaned.toLowerCase();
  if (normalized === "uncategorized" || normalized === "unknown" || normalized === "other") return "Sin categoría";
  return CATEGORY_LABELS_ES[normalized] ?? cleaned;
}

export const KIND_LABELS_ES: Record<string, string> = {
  expense: "gasto",
  income: "ingreso",
  transfer: "transferencia",
};
