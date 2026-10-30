// The composer under Lite's thread: the app's own MessageInput, reused whole
// (drafts, mentions, uploads, slash commands, send, stop and the typing
// budget come with it), wired the way the Threads card wires it
// (SessionInlineThread): the session's live fields, Escape to interrupt, the
// permission mode, and the agent, model and effort control in its status row.
//
// What docks around it follows the classic conversation: a pending tool
// permission replaces it (PermissionStack), a `cast decide` ask docks above
// it. A teammate's session that the team can see takes a message from the
// viewer as themselves; a share-link reader gets the collaboration composer
// (it asks the owner for a send grant, and sends once granted); a session the
// viewer can only read has one quiet line; until the client knows which of
// these the viewer is, nothing that sends is drawn.
//
// On a phone the composer rests as one line (MessageInput's own resting
// pill) until it is tapped; wider, it is the full box.
//
// While it draws its text box, the composer is reachable from outside it
// (lib/lite/composerHandle): the header's "Message another agent…" adds a
// reference to the box through MessageInput's own populate hook, after any
// draft already there, and puts the caret at its end.
//
// While it draws its box it also says who is in it (LiteComposerPresence):
// the compose:<id> presence row the classic composer writes, so a teammate's
// header (Lite's typing chip, classic's strip) sees the viewer typing here.
import "./thread.css";
import { memo, useCallback, useMemo, useRef } from "react";
import type { Id } from "@codecast/convex/convex/_generated/dataModel";
import { useConvexAuth } from "convex/react";
import { useShallow } from "zustand/react/shallow";
import { withoutSecrets } from "@codecast/shared/contracts/secretShapes";
import { isConvexId, useInboxStore } from "../../../store/inboxStore";
import { useDocPresence } from "../../../hooks/useDocPresence";
import { composeDocId } from "../../../lib/composerPresence";
import { useLiteLayout } from "../../../lib/lite/liteLayout";
import { composerAgentStatus, useManagedSessionFields, useSessionEscape } from "../../../hooks/useSessionComposerControls";
import { usePermissionModeSwitch } from "../../../hooks/usePermissionModeSwitch";
import { usePendingPermissions } from "../../../hooks/useSyncPendingPermissions";
import { usePendingDecisionItems } from "../../../hooks/useDecisionQueue";
import { animatedHideSession } from "../../../store/undoActions";
import { useLiteSessionAccess } from "../../../lib/lite/threadAccess";
import { registerLiteComposerHandle } from "../../../lib/lite/composerHandle";
import { useWatchEffect } from "../../../hooks/useWatchEffect";
import type { ConversationData } from "../../conversation/types";
import { MessageInput } from "../../MessageInput";
import { HeaderModelControl } from "../../SessionControlMenu";
import { PermissionStack, PERMISSION_SKIP_TOOLS } from "../../PermissionCard";
import { NonOwnerMessageInput } from "../../conversation/sessionControls";
import { LiteDecisionCard } from "./LiteDecisionCard";

export function LiteComposer({ sessionId }: { sessionId: string }) {
  const access = useLiteSessionAccess(sessionId);
  const { isPhone } = useLiteLayout();
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

  // The handle others fill the box through, held while the box is drawn.
  const populateRef = useRef<((text: string, opts?: { append?: boolean }) => void) | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drawsBox = access.known && !access.shared && access.canSend && permissions.length === 0;
  useWatchEffect(() => {
    if (!drawsBox) return;
    // The caret at the end, after MessageInput's own select-all lands.
    const focusBox = () => {
      const el = boxRef.current?.querySelector("textarea");
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
    return registerLiteComposerHandle(sessionId, {
      populate: (text) => {
        // After the draft already in the box, never over it; the text keeps
        // its trailing space, so the person types straight on.
        const el = boxRef.current?.querySelector("textarea");
        if (el) {
          const draft = el.value.replace(/\s+$/, "");
          populateRef.current?.(draft ? `${draft}\n\n${text}` : text);
        } else {
          // No box drawn (the phone's resting line): MessageInput's own
          // append keeps whatever draft it holds.
          populateRef.current?.(text, { append: true });
        }
        setTimeout(focusBox, 0);
      },
      focus: focusBox,
    });
  }, [sessionId, drawsBox]);

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

  if (!access.known) return null;
  if (access.shared) {
    return (
      <div className="lt-composer">
        <LiteSharedComposer sessionId={sessionId} />
      </div>
    );
  }
  if (!access.canSend) {
    return (
      <div className="lt-composer">
        <div className="lt-readonly">Read only</div>
      </div>
    );
  }

  return (
    <div className="lt-composer" ref={boxRef}>
      {decision && <LiteDecisionCard key={decision.key} item={decision} more={decisions.length - 1} />}
      {drawsBox && <LiteComposerPresence sessionId={sessionId} announce={!access.isOwner} />}
      {permissions.length > 0 ? (
        <PermissionStack
          permissions={permissions as any}
          onAllowAll={(meta.agentType ?? "claude_code") === "claude_code" && access.isOwner && active && mode !== "bypassPermissions" ? handleEnableBypass : undefined}
        />
      ) : (
        <MessageInput
          // The stub's id survives its real id's arrival as the row's
          // session_id (classic keys the composer the same way), so the
          // handoff keeps the box, its caret and its draft.
          key={meta.sessionKey ?? sessionId}
          conversationId={sessionId}
          sessionId={meta.sessionKey}
          agentType={meta.agentType}
          status={meta.status}
          inline={!isPhone}
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
          onPopulateInput={populateRef}
          composerPlaceholder={access.isOwner ? undefined : `Message ${access.ownerFirstName ? `${access.ownerFirstName}'s` : "their"} agent`}
          // A blocking ask takes focus first, so its digits answer.
          autoFocusInput={!decision?.blocking}
        />
      )}
    </div>
  );
}

/**
 * This box's presence on the session: the same compose:<id> row the classic
 * composers write (CollabComposer's useComposerPresence), with the draft as
 * the store holds it (the box writes it through on its own pause, never per
 * key) and any credential in it masked. The owner announces once someone
 * else is in the box; a teammate typing into the owner's session announces
 * at once (`announce`), as the classic collaborator's box does. Draws
 * nothing: the header's typing chip shows the others.
 */
const LiteComposerPresence = memo(function LiteComposerPresence({ sessionId, announce }: { sessionId: string; announce: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const draft = useInboxStore((s) => (s.drafts[sessionId] as { draft_message?: string } | undefined)?.draft_message ?? "");
  const preview = useMemo(() => withoutSecrets(draft), [draft]);
  useDocPresence({
    docId: composeDocId(sessionId),
    draftText: preview,
    enabled: isAuthenticated && isConvexId(sessionId),
    forceBroadcast: announce,
  });
  return null;
});

/** A share-link reader's composer: the classic collaboration composer, fed
 *  the few conversation fields it reads (never the whole row, which every
 *  transcript flush rewrites). */
function LiteSharedComposer({ sessionId }: { sessionId: string }) {
  const fields = useInboxStore(useShallow((s) => {
    const c = s.conversations[sessionId] as Record<string, any> | undefined;
    return { user: c?.user, share_token: c?.share_token, standing_role_id: c?.standing_role_id, acting_user_id: c?.acting_user_id, status: c?.status };
  }));
  const conversation = useMemo(() => ({ _id: sessionId, ...fields }) as unknown as ConversationData, [sessionId, fields]);
  return <NonOwnerMessageInput conversation={conversation} />;
}
