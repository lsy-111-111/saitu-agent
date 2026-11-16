/** Explicit build/runtime choice; historical tasks without a field use single. */
export function parseDetailLayoutV7(value) {
  if (value !== "single" && value !== "parallel-2") throw new Error("invalid_v7_detail_layout");
  return value;
}
export function readConfiguredDetailLayoutV7(environment) {
  const raw = environment === undefined ? process.env.SAITU_V7_DETAIL_LAYOUT : environment.SAITU_V7_DETAIL_LAYOUT;
  return parseDetailLayoutV7(raw === undefined ? "single" : raw);
}
