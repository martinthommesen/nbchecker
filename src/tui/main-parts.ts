/** The renderables of the main and help screens, built once. */
import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { helpText } from "./help.ts";
import { lines, paint } from "./paint.ts";
import { addAll, pane, paneGap, text } from "./panes.ts";
import { theme } from "./theme.ts";

const boxHeight = 3;
/** The input keeps room for a domain however long the hint beside it is. */
const inputLeast = 20;

const buildHeader = (renderer: CliRenderer) => {
  const row = new BoxRenderable(renderer, {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    height: boxHeight,
    justifyContent: "space-between",
  });
  const title = text(renderer);
  title.flexShrink = 0;
  const badgeBox = pane(renderer, { flexGrow: 0 });
  // On a narrow screen the badge is cut, not the name.
  badgeBox.flexShrink = 1;
  badgeBox.overflow = "hidden";
  const badge = text(renderer);
  badge.wrapMode = "none";
  badgeBox.add(badge);
  addAll(row, [title, badgeBox]);
  return { badge, row, title };
};

const buildInput = (renderer: CliRenderer) => {
  const box = pane(renderer, {
    color: theme.accent,
    flexGrow: 0,
    title: "Domain or IP",
  });
  box.flexDirection = "row";
  box.height = boxHeight;
  box.flexShrink = 0;
  const prompt = new TextRenderable(renderer, {
    content: lines([[paint("› ", { fg: theme.accent })]]),
    flexShrink: 0,
  });
  const input = new InputRenderable(renderer, {
    backgroundColor: theme.background,
    cursorColor: theme.text,
    flexGrow: 1,
    focusedBackgroundColor: theme.background,
    focusedTextColor: theme.text,
    placeholder: "a domain, URL or IP address",
    placeholderColor: theme.faint,
    textColor: theme.text,
  });
  input.minWidth = inputLeast;
  // On a narrow screen the hint is cut, not what was typed.
  const hint = text(renderer);
  hint.wrapMode = "none";
  hint.flexShrink = 1;
  hint.overflow = "hidden";
  addAll(box, [prompt, input, hint]);
  return { box, hint, input };
};

const buildResults = (renderer: CliRenderer) => {
  // The results give up their height first, so the keys below stay on screen.
  const row = new BoxRenderable(renderer, {
    columnGap: paneGap,
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    overflow: "hidden",
  });
  const resolvers = pane(renderer, { title: "Resolvers" });
  resolvers.flexShrink = 1;
  resolvers.overflow = "hidden";
  const head = text(renderer);
  head.flexShrink = 0;
  const scroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
  });
  const table = text(renderer);
  scroll.add(table);
  addAll(resolvers, [head, scroll]);
  const details = pane(renderer, { flexGrow: 0, title: "Details" });
  details.overflow = "hidden";
  const detailsBody = text(renderer);
  details.add(detailsBody);
  addAll(row, [resolvers, details]);
  return { details, detailsBody, head, row, scroll, table };
};

const buildHelp = (renderer: CliRenderer) => {
  const box = pane(renderer, { title: "Help" });
  box.visible = false;
  box.flexShrink = 1;
  box.minHeight = 0;
  const scroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
  });
  const body = text(renderer);
  scroll.add(body);
  box.add(scroll);
  body.content = helpText();
  return { box, scroll };
};

export { buildHeader, buildHelp, buildInput, buildResults };
