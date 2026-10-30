// The composer under Lite's thread: the app's own MessageInput, reused whole
// (drafts, mentions, uploads, slash commands, send, stop and the typing
// budget come with it), wired the way the Threads card wires it
// (SessionInlineThread): the session's live fields, Escape to interrupt, the
// permission mode, and the agent, model and effort control in its status row.
//
// What docks around it follows the classic conversation: a pending tool
// permission replaces it (PermissionStack), a `cast decide` ask docks above
// it. A teammate's session that the team can see takes a message from the
// viewer as themselves; a session the viewer can only read has no composer.
import "./thread.css";
import { useCallback, useMemo } from "react";
import type { Id } from "@codecast/convex/convex/_generated/dataModel";
import { useShallow } from "zustand/react/shallow";
import { useInboxStore } from "../../../store/inboxStore";
import { composerAgentStatus, useManagedSessionFields, useSessionEscape } from "../../../hooks/useSessionComposerControls";
import { usePermissionModeSwitch } from "../../../hooks/usePermissionModeSwitch";
import { usePendingPermissions } from "../../../hooks/useSyncPendingPermissions";
import { usePendingDecisionItems } from "../../../hooks/useDecisionQueue";
import { animatedHideSession } from "../../../store/undoActions";
import { useLiteSessionAccess } from "../../../lib/lite/threadAccess";
import type { ConversationData } from "../../conversation/types";
import { MessageInput } from "../../MessageInput";
import { HeaderModelControl } from "../../SessionControlMenu";
import { PermissionStack, PERMISSION_SKIP_TOOLS } from "../../PermissionCard";
import { LiteDecisionCard } from "./LiteDecisionCard";

export function LiteComposer({ sessionId }: { sessionId: string }) {
  const access = useLiteSessionAccess(sessionId);
  // Primitives off the row, so a heartbeat re-renders nothing here.
  const meta = useInboxStore(useShallow((s) => {
    const row = (s.sessions[sessionId] ?? s.conversations[sessionId]) as Record<string, any> | undefined;
    const conv = s.conversations[sessionId] as Record<string, any> | undefined;
    return {
      agentType: (row?.agent_type as string | undefined) ?? undefined,
      model: (row?.model as string | undefined) ?? undefined,
      effort: (row?.effort as string | undefined) ?? undefined,
      messageCount: (row?.message_count as number | undefined) ?? undefined,
      status: ((conv?.status ?? row?.status) as string | undefined) ?? "active",
      sessionKey: (row?.session_id as string | undefined) ?? undefined,
    };
  }));
  const managed = useManagedSessionFields(sessionId);
  const active = meta.status === "active";
  const mode = managed?.permission_mode || "default";
  const convCommand = useInboxStore((s) => s.convCommand);
  const modeConversation = useMemo(() => ({ _id: sessionId, status: meta.status } as unknown as ConversationData), [sessionId, meta.status]);
  const { handleCycleMode, modeSwitching, handleEnableBypass } = usePermissionModeSwitch({
    effectiveMode: mode,
    conversation: modeConversation,
    effectiveIsOwner: access.isOwner,
    convexConvId: sessionId as Id<"conversations">,
    convCommand,
  });
  const sendEscape = useSessionEscape(sessionId, { active, isOwner: access.isOwner });
  const onEscape = useCallback(() => { sendEscape(); }, [sendEscape]);
  const stash = useMemo(() => (access.isOwner ? () => animatedHideSession(sessionId, "stash") : undefined), [access.isOwner, sessionId]);
  // The draft the server holds, read once: MessageInput seeds from it on mount.
  const initialDraft = useMemo(() => (useInboxStore.getState().conversations[sessionId] as { draft_message?: string } | undefined)?.draft_message, [sessionId]);

  const permissionsRaw = usePendingPermissions(sessionId);
  const permissions = useMemo(() => (permissionsRaw ?? []).filter((p: any) => !PERMISSION_SKIP_TOOLS.has(p.tool_name)), [permissionsRaw]);
  const decisions = usePendingDecisionItems(sessionId);
  const decision = decisions[0] ?? null;

  const sessionControl = useMemo(() => (
    <HeaderModelControl
      variant="composer"
      conversationId={sessionId}
      agentType={meta.agentType}
      model={meta.model}
      effort={meta.effort}
      messageCount={meta.messageCount}
      canEdit={access.isOwner}
    />
  ), [sessionId, meta.agentType, meta.model, meta.effort, meta.messageCount, access.isOwner]);

  if (!access.canSend) {
    return (
      <div className="lt-composer">
        <div className="lt-readonly">Read only</div>
      </div>
    );
  }

  return (
    <div className="lt-composer">
      {decision && <LiteDecisionCard key={decision.key} item={decision} more={decisions.length - 1} />}
      {permissions.length > 0 ? (
        <PermissionStack
          permissions={permissions as any}
          onAllowAll={(meta.agentType ?? "claude_code") === "claude_code" && access.isOwner && active && mode !== "bypassPermissions" ? handleEnableBypass : undefined}
        />
      ) : (
        <MessageInput
          key={sessionId}
          conversationId={sessionId}
          sessionId={meta.sessionKey}
          agentType={meta.agentType}
          status={meta.status}
          inline
          embedded
          initialDraft={initialDraft}
          agentStatus={composerAgentStatus(managed?.agent_status, { active, disconnected: managed?.is_connected === false })}
          deliveryStatus={managed?.agent_status}
          pendingPermissionsCount={permissions.length}
          permissionMode={mode}
          permissionModePending={modeSwitching}
          onCycleMode={access.isOwner ? handleCycleMode : undefined}
          onSendEscape={access.isOwner ? onEscape : undefined}
          onSendAndDismiss={stash}
          sessionControl={sessionControl}
          composerPlaceholder={access.isOwner ? undefined : `Message ${access.ownerFirstName ? `${access.ownerFirstName}'s` : "their"} agent`}
          autoFocusInput
        />
      )}
    </div>
  );
}
