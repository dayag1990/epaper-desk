// The one renderer, imported from the same source files the server uses.
export { renderPage, defaultSpan, defaultRatio, packedSpans, type RenderedPage } from "@epaper/layout/src/render.js";
export { paperCss } from "@epaper/layout/src/css.js";
export { domFill, domFrames, domReady } from "@epaper/layout/src/dom.js";
export { fitBodySize, fitLabel, fitState, lowResCheck, lowResText, type FitState } from "@epaper/layout/src/fit.js";
export { pxToPt, ptToPx, round } from "@epaper/layout/src/units.js";
export type { Template } from "@epaper/layout/src/template.js";
