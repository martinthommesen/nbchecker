/** Set by the release build with `--define NBCHECKER_VERSION='"1.2.3"'`. */
declare const NBCHECKER_VERSION: string | undefined;

/** Development builds get a version that still reads well after a "v". */
const buildVersion = (): string => {
  if (typeof NBCHECKER_VERSION === "string") {
    return NBCHECKER_VERSION;
  }
  return "0.0.0-dev";
};

export const version: string = buildVersion();
