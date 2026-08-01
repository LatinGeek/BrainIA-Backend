export const FINANCIAL_CATEGORIES = {
  expense: [
    "Food / Delivery",
    "Food / Groceries",
    "Subscriptions",
    "Bills / Utilities",
    "Transport",
    "Shopping",
    "Health",
    "Home",
    "Entertainment",
    "Going Out",
  ],
  income: [
    "Salary",
    "Freelance / Client",
    "Business",
    "Refund",
    "Investments",
    "Interest",
    "Gift",
    "Other Income",
  ],
} as const;

export type FinancialCategoryKind = keyof typeof FINANCIAL_CATEGORIES;
