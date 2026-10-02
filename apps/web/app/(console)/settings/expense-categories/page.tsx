import type { Metadata } from "next";

import { ExpenseCategories } from "./expense-categories";

export const metadata: Metadata = { title: "Expense types · Rasi" };

/** Books (ADR-0018): what the business spends on. Admin+ read; Super Admin manages. */
export default function ExpenseCategoriesPage() {
  return <ExpenseCategories />;
}
