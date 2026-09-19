import { ImageResponse } from "next/og";

import { BRAND_ON_TEAL, BRAND_TEAL } from "./brand-colours";

/** The installed app's icon: the console's brand mark, a white "R" on teal. */

/**
 * The teal fills the whole square, so the same image serves as a maskable
 * icon: the "R" sits well inside the 80% safe zone a launcher may crop to.
 */
export function brandMark(size: number): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND_TEAL,
        color: BRAND_ON_TEAL,
        fontSize: Math.round(size * 0.5),
        fontWeight: 600,
      }}
    >
      R
    </div>,
    { width: size, height: size },
  );
}
