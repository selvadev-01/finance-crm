import { config } from "@repo/eslint-config/base";
import { domainBoundaries } from "@repo/eslint-config/boundaries";

export default [...config, domainBoundaries];
