import { brandMark } from "../../brand-mark";

/** The two sizes an installable web app needs; both built at compile time. */
const SIZES = ["192", "512"] as const;

export const dynamicParams = false;

export function generateStaticParams() {
  return SIZES.map((size) => ({ size }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size } = await params;
  return brandMark(Number(size));
}
