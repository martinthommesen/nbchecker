/** Building blocks shared by the screen's parts: panes, scrolling and text. */
import {
  BoxRenderable,
  type CliRenderer,
  type Renderable,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { lines } from "./paint.ts";
import { theme } from "./theme.ts";

/** Border and padding on each side of a pane. */
const paneChrome = 4;
const rootPadding = 2;
const paneGap = 2;
/** A pane around one line of text: the line and a border above and below. */
const linePaneHeight = 3;

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

/** Scrolls what doesn't fit, and gives up its height before what's around it. */
const scrollBox = (renderer: CliRenderer) =>
  new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
  });

const text = (renderer: CliRenderer) =>
  new TextRenderable(renderer, {
    content: lines([]),
    fg: theme.text,
    wrapMode: "word",
  });

const addAll = (parent: BoxRenderable, children: readonly Renderable[]) => {
  for (const child of children) {
    parent.add(child);
  }
};

/** Adds a text to `box`, for what the box shows. */
const bodyOf = (renderer: CliRenderer, box: BoxRenderable) => {
  const body = text(renderer);
  box.add(body);
  return body;
};

/** The terminal size every part of the screen is drawn for. */
interface Layout {
  /** Wide enough to set panes side by side, such as the details pane. */
  readonly wide: boolean;
  readonly width: number;
}

/** The width inside the screen's padding. */
const inner = (width: number): number => width - rootPadding;

export type { Layout };
export {
  addAll,
  bodyOf,
  column,
  inner,
  linePaneHeight,
  pane,
  paneChrome,
  paneGap,
  rootPadding,
  scrollBox,
  text,
};
