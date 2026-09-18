/**
 * Lists ask for up to 200 rows, the API's page limit (api-design.md#pagination)
 * — far above the number of sectors or lines a business runs. Where a list can
 * exceed it, the screen pages with the cursor rather than showing a silently
 * partial list.
 */
export const LIST_LIMIT = 200;
