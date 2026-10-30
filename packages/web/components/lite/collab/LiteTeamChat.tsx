// The team's chat on Lite's team page: one room at a time, its messages and
// its composer, a thread opening over it on demand, and a small switcher in
// the page's top bar instead of a rail. It is the team chat's own room, not a
// copy: the rail the store holds (useChatRail, fed by the sync host), the
// room's page feeder (useChannelMessagesSync, a per-view query), the store's
// messages (useChannelMessages) and its send, edit, react and read actions.
// The parts are the chat page's (ChatMessageList, ChatComposer,
// ChatThreadPanel), so a line looks and behaves the same here as there.
import "./collab.css";
import "../../chat/chat.css";
import { useCallback, useState } from "react";
import { selectChannelReadMarker, useInboxStore } from "../../../store/inboxStore";
import type { ChatAttachment } from "../../../store/chatSlice";
import {
  useChannelMessages,
  useChannelMessagesSync,
  useChatMembers,
  useThreadMessages,
  useThreadSync,
} from "../../../hooks/useChatSync";
import { useWindowPresent } from "../../../hooks/usePagePresence";
import { useWatchEffect } from "../../../hooks/useWatchEffect";
import { holdChatFocus } from "../../../lib/chatFocus";
import { useCoarseNow } from "../../../hooks/useCoarseNow";
import { liteChannelOption } from "../../../lib/lite/collabTeam";
import type { LiteTeamChannels } from "../../../lib/lite/collabHooks";
import { ChatMessageList } from "../../chat/ChatMessageList";
import { ChatComposer } from "../../chat/ChatComposer";
import { ChatThreadPanel } from "../../chat/ChatThreadPanel";

const CLOCK_MS = 30_000;

export function LiteChannelSelect({ channels, channelId, onPick }: {
  channels: LiteTeamChannels["channels"];
  channelId: string | null;
  onPick: (id: string) => void;
}) {
  if (channels.length < 2 || !channelId) return null;
  return (
    <select className="lt-select" aria-label="Channel" value={channelId} onChange={(e) => onPick(e.target.value)}>
      {channels.map((c) => <option key={c.id} value={c.id}>{liteChannelOption(c)}</option>)}
    </select>
  );
}

type Room = NonNullable<LiteTeamChannels["channel"]>;

/** One room, live. Keyed by the room's id by its caller, so a switch starts
 *  the room fresh: its paging, its read rule and its thread. */
export function LiteTeamRoom({ room }: { room: Room }) {
  const channelId = room.id;
  const feed = useChannelMessagesSync(channelId);
  const messages = useChannelMessages(channelId, feed.floor);
  const { viewerId, handles } = useChatMembers();
  const now = useCoarseNow(CLOCK_MS);
  // Read only while a person is looking: the window focused, the newest line
  // on screen. The list reports each arrival at the bottom once (and again
  // only after the reader leaves it and comes back), the chat page's own
  // rule, so a line that lands while they read history stays unread. The
  // unread divider's rule is frozen at entry (ChatMessageList's note on why).
  const present = useWindowPresent();
  const markRead = useCallback(() => {
    if (!present || feed.unavailable) return;
    // The newest message in the room, replies included (app/chat's markRead).
    const state = useInboxStore.getState();
    state.markChannelRead(channelId, selectChannelReadMarker(state as Parameters<typeof selectChannelReadMarker>[0], channelId)?._id);
  }, [channelId, present, feed.unavailable]);
  // The room on screen: a line landing in it never toasts.
  useWatchEffect(() => (present ? holdChatFocus({ channelId }) : undefined), [present, channelId]);
  const [lastReadAt] = useState(() => room.lastReadAt);

  const [threadRootId, setThreadRootId] = useState<string | undefined>(undefined);
  useThreadSync(threadRootId);
  const thread = useThreadMessages(threadRootId);

  const send = useCallback((content: string, attachments?: ChatAttachment[], opts?: { syncLocalOnly?: boolean }) => {
    useInboxStore.getState().sendChatMessage(channelId, content, { attachments, syncLocalOnly: opts?.syncLocalOnly });
  }, [channelId]);
  const sendReply = useCallback((content: string, attachments?: ChatAttachment[], opts?: { broadcast?: boolean }) => {
    if (!threadRootId) return;
    useInboxStore.getState().sendChatMessage(channelId, content, { threadRootId, attachments, broadcast: opts?.broadcast });
  }, [channelId, threadRootId]);
  const react = useCallback((id: string, emoji: string) => useInboxStore.getState().toggleChatReaction(id, emoji), []);
  const edit = useCallback((id: string, content: string) => useInboxStore.getState().editChatMessage(id, content), []);
  const remove = useCallback((id: string) => useInboxStore.getState().deleteChatMessage(id), []);
  const retry = useCallback((id: string) => useInboxStore.getState().retryChatSend(id), []);

  if (feed.unavailable) {
    return (
      <div className="lt-content lt-empty">
        <div data-lite-placeholder="">#{room.name} is gone</div>
      </div>
    );
  }
  return (
    <div className="ch-shell lt-team-chat">
      <div className="ch-main">
        {feed.error && messages.length === 0 ? (
          <div className="lt-content lt-empty">
            <div className="flex items-center justify-center gap-3" data-lite-placeholder="">
              Couldn't load #{room.name}
              <button type="button" className="lt-btn" onClick={feed.retry}>Retry</button>
            </div>
          </div>
        ) : (
          <ChatMessageList
            messages={messages}
            lastReadAt={lastReadAt}
            viewerId={viewerId}
            channelId={channelId}
            permalinkChannelId={channelId}
            knownHandles={handles.known}
            selfHandles={handles.self}
            handleNames={handles.names}
            now={now}
            hasMoreAbove={feed.hasMoreAbove}
            isLoadingOlder={feed.isLoadingOlder}
            onLoadOlder={feed.loadOlder}
            onReachedBottom={markRead}
            canReportRead={present}
            onOpenThread={setThreadRootId}
            onReact={react}
            onEdit={edit}
            onDelete={remove}
            onRetrySend={retry}
          />
        )}
        <ChatComposer channelId={channelId} teamId={room.teamId} placeholder={`Message #${room.name}`} onSend={send} />
      </div>
      {threadRootId && (
        <ChatThreadPanel
          channelId={channelId}
          channelName={room.name}
          rootId={threadRootId}
          root={thread.root}
          replies={thread.replies}
          viewerId={viewerId}
          knownHandles={handles.known}
          selfHandles={handles.self}
          handleNames={handles.names}
          teamId={room.teamId}
          now={now}
          onClose={() => setThreadRootId(undefined)}
          onSend={sendReply}
          onReact={react}
          onEdit={edit}
          onDelete={remove}
          onRetrySend={retry}
        />
      )}
    </div>
  );
}
