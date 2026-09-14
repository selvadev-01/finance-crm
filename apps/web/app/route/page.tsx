import type { Metadata } from "next";

import { FieldRoute } from "./field-route";

export const metadata: Metadata = { title: "Today’s route · Rasi" };

/** The Junior's home (US-040), on the offline engine. */
export default function RoutePage() {
  return <FieldRoute />;
}
