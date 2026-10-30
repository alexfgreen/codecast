// One changed file's diff, opened under its row in the changes tab. Drawn by
// the shared Pierre renderer (DiffView), which follows light and dark. A
// click in the gutter opens a shared, @mentionable comment thread under that
// line (useLiteLineComments), and the session's existing line threads on the
// file show under their lines.
import { DiffView, FilePatchDiff } from "../../DiffView";
import type { PanelFile } from "../../../lib/lite/panelModel";
import { useLiteLineComments } from "../comments/useLiteLineComments";

/** Rows a file shows before its "show more": long enough that most diffs
 *  open whole, short enough that a generated file does not. */
const MAX_LINES = 400;

export function LiteFileDiff({ file, sessionId }: { file: PanelFile; sessionId?: string }) {
  const comments = useLiteLineComments(sessionId, file.path);
  const shared = {
    fileName: file.path,
    showLineNumbers: true,
    wrap: true,
    maxLines: MAX_LINES,
    ...comments,
  };
  if (file.hunks?.length) return <DiffView {...shared} hunks={file.hunks} />;
  if (file.patch) return <FilePatchDiff {...shared} patch={file.patch} />;
  return <div className="lt-file-none">No text changes</div>;
}
