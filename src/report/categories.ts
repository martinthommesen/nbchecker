/** What filters block, in the order and words every output uses for it. */
import type { Category } from "../check/filters.ts";

interface CategoryLabels {
  /** Above a category's rows in the text output and the table. */
  readonly heading: string;
  /** In the details pane, which says what each row is. */
  readonly name: string;
  /** Above the connection screen's shorter list of filters. */
  readonly shortHeading: string;
}

/** The order categories are shown in: the most important first. */
export const categoryOrder: readonly Category[] = ["security", "family", "ads"];

export const categoryLabels: Record<Category, CategoryLabels> = {
  ads: {
    heading: "ADS AND TRACKERS",
    name: "ads and trackers",
    shortHeading: "ADS AND TRACKERS",
  },
  family: {
    heading: "FAMILY · SECURITY + ADULT CONTENT",
    name: "family",
    shortHeading: "FAMILY",
  },
  security: {
    heading: "SECURITY · MALWARE, PHISHING",
    name: "security",
    shortHeading: "SECURITY",
  },
};

/**
 * Groups `items` under their categories' headings, in category order,
 * leaving out categories with none.
 */
export const byCategory = <T, R>(
  items: readonly T[],
  categoryOf: (item: T) => Category,
  row: (item: T) => R
): { readonly rows: R[]; readonly title: string }[] =>
  categoryOrder
    .map((category) => ({
      rows: items
        .filter((item) => categoryOf(item) === category)
        .map((item) => row(item)),
      title: categoryLabels[category].heading,
    }))
    .filter((g) => g.rows.length > 0);
