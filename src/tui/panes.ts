/** Building blocks shared by the screens: bordered panes and text. */
import {
  BoxRenderable,
  type CliRenderer,
  type InputRenderable,
  type ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { lines } from "./paint.ts";
import { theme } from "./theme.ts";

/** Border and padding on each side of a pane. */
const paneChrome = 4;
const rootPadding = 2;
const paneGap = 2;

interface PaneLook {
  readonly color?: string;
  readonly flexGrow?: number;
  readonly title?: string;
}

const pane = (renderer: CliRenderer, look: PaneLook = {}) => {
  const box = new BoxRenderable(renderer, {
    border: true,
    borderColor: theme.border,
    borderStyle: "rounded",
    flexDirection: "column",
    flexGrow: look.flexGrow ?? 1,
    flexShrink: 0,
    paddingX: 1,
  });
  if (look.title !== undefined) {
    box.title = ` ${look.title} `;
    box.titleColor = look.color ?? theme.dim;
  }
  return box;
};

const column = (renderer: CliRenderer, flexGrow: number) =>
  new BoxRenderable(renderer, {
    flexBasis: 0,
    flexDirection: "column",
    flexGrow,
    gap: 1,
  });

const text = (renderer: CliRenderer) =>
  new TextRenderable(renderer, {
    content: lines([]),
    fg: theme.text,
    wrapMode: "word",
  });

const addAll = (
  parent: BoxRenderable | ScrollBoxRenderable,
  children: readonly (
    | BoxRenderable
    | InputRenderable
    | ScrollBoxRenderable
    | TextRenderable
  )[]
) => {
  for (const child of children) {
    parent.add(child);
  }
};

const bodyOf = (renderer: CliRenderer, box: BoxRenderable) => {
  const body = text(renderer);
  box.add(body);
  return body;
};

interface Layout {
  readonly wide: boolean;
  readonly width: number;
}

/** The width inside the screen's padding. */
const inner = (width: number): number => width - rootPadding;

export type { Layout, PaneLook };
export {
  addAll,
  bodyOf,
  column,
  inner,
  pane,
  paneChrome,
  paneGap,
  rootPadding,
  text,
};
