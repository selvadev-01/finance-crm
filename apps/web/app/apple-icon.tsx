import { brandMark } from "./brand-mark";

/** The home-screen icon on iPhone and iPad, which ignore the manifest's icons. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return brandMark(size.width);
}
