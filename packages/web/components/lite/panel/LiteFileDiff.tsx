// One changed file's diff, opened under its row in the changes tab. Drawn by
// the shared Pierre renderer (DiffView), which follows light and dark. Inert
// for now: the comment props pass straight through to DiffView, so line
// comments arrive by handing them in, with nothing here to change.
import type { ComponentProps } from "react";
import { DiffView, FilePatchDiff } from "../../DiffView";
import type { PanelFile } from "../../../lib/lite/panelModel";

type DiffViewProps = ComponentProps<typeof DiffView>;

/** Rows a file shows before its "show more": long enough that most diffs
 *  open whole, short enough that a generated file does not. */
const MAX_LINES = 400;

export function LiteFileDiff({ file, commentContext, onLineComment, lineThreads, renderLineThread }: {
  file: PanelFile;
  commentContext?: DiffViewProps["commentContext"];
  onLineComment?: DiffViewProps["onLineComment"];
  lineThreads?: DiffViewProps["lineThreads"];
  renderLineThread?: DiffViewProps["renderLineThread"];
}) {
  const shared = {
    fileName: file.path,
    showLineNumbers: true,
    wrap: true,
    maxLines: MAX_LINES,
    commentContext,
    onLineComment,
    lineThreads,
    renderLineThread,
  };
  if (file.hunks?.length) return <DiffView {...shared} hunks={file.hunks} />;
  if (file.patch) return <FilePatchDiff {...shared} patch={file.patch} />;
  return <div className="lt-file-none">No text changes</div>;
}
