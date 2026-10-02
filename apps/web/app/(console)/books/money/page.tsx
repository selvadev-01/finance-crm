import type { Metadata } from "next";

import { MoneyMovements } from "./money";

export const metadata: Metadata = {
  title: "Capital, contra, receipts & drawings · Rasi",
};

const ACTIONS = ["transfer", "income", "drawing"] as const;

/**
 * Books (ADR-0018): capital, bank transfers, other income and owner drawings.
 * Admin+.
 */
export default async function MoneyPage({
  searchParams,
}: PageProps<"/books/money">) {
  const { action } = await searchParams;
  // `?action=…` comes from the overview's quick actions, and `capital` from
  // the disburse dialog when cash-in-hand is short.
  return (
    <MoneyMovements
      startAction={ACTIONS.find((each) => each === action)}
      startCapital={action === "capital"}
    />
  );
}
