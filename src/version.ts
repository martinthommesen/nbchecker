/** Set by the release build with `--define NBCHECKER_VERSION='"1.2.3"'`. */
declare const NBCHECKER_VERSION: string | undefined;

const buildVersion = (): string => {
  if (typeof NBCHECKER_VERSION === "string") {
    return NBCHECKER_VERSION;
  }
  return "dev";
};

export const version: string = buildVersion();
