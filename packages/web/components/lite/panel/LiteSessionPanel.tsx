// The right panel of a Lite session: its changes and its task. Wave 3 fills
// it; until then it draws the panel frame with a placeholder.
import { LiteRightPanel } from "../LiteRightPanel";

export function LiteSessionPanel({ sessionId }: { sessionId: string }) {
  return (
    <LiteRightPanel title="Changes">
      <div className="p-4" data-session={sessionId}>
        <div data-lite-placeholder="">Changes land in wave 3</div>
      </div>
    </LiteRightPanel>
  );
}
