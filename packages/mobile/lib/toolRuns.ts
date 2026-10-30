// The tool-run folder lives in shared render code now, so the web folds a
// transcript the same way the phone does. This module keeps the phone's
// import path.
export { CARD_TOOLS, foldToolRuns, isFoldableToolCall, type RunMessage, type ToolRun } from '@codecast/shared/render';
