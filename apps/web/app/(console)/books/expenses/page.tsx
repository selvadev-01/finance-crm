import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { Expenses } from "./expenses";

export const metadata: Metadata = { title: "Expenses · Rasi" };

/** Books · expenses (ADR-0018, US-101). Admins and above. */
export default async function ExpensesPage({
  searchParams,
}: PageProps<"/books/expenses">) {
  const params = await searchParams;
  return (
    <Expenses
      initial={readListParams(params, ["categoryId", "status", "paidFrom"])}
      // `?action=record` comes from the overview's quick actions.
      startRecording={params.action === "record"}
    />
  );
}
