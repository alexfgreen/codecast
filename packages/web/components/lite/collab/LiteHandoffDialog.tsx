// Hand a Lite session to a teammate: pick a person, add a note if there is
// something to say, Hand off. It is the classic composer's hand-off
// (OwnersBadge HandoffPicker) laid out as a dialog: the same roster (the
// session team's members once listOwnerCandidates lands, the store's roster
// until then), the same one write (useOwners handoffTo, which sets the owner
// line through the store's reparentOrgSession and draws the transcript marker
// at once) and the same "stay an owner" choice. The note rides the
// teammate's notification, their banner and the marker.
import "./collab.css";
import { useState } from "react";
import { Command } from "cmdk";
import { Check, Search } from "lucide-react";
import { useOwnersFromStore } from "../../OwnersBadge";
import { pickRoster, useOwnerCandidates } from "../../../hooks/useOwners";
import { useEventListener } from "../../../hooks/useEventListener";
import { liteHandoffPeople, liteNamesLabel } from "../../../lib/lite/collabPeople";
import { isMac } from "../../../shortcuts";
import { KeyCap } from "../../KeyCap";
import { LiteAvatar } from "../LiteSidebarRows";
import { LiteDialog } from "./LiteDialog";
import { LiteFaces } from "./LiteFaces";

const PRESENCE_WORD = { active: "Online", busy: "Busy", idle: "Idle", away: "Away", offline: "" } as const;
const CAPTURE = { capture: true };

export function LiteHandoffDialog({ sessionId, title, onClose }: { sessionId: string; title: string; onClose: () => void }) {
  const owners = useOwnersFromStore(sessionId);
  const meId = owners.currentUser?._id ? String(owners.currentUser._id) : null;
  const serverRoster = useOwnerCandidates(sessionId, owners.currentUser);
  // Mounted only while open, so these are read fresh on each render.
  const people = liteHandoffPeople(pickRoster(serverRoster, owners.selectable), meId, owners.ownerIds);
  const current = owners.ownerList.map((id) => {
    const d = owners.displayFor(id);
    return { id, name: d.name, image: d.image ?? null };
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [keepSelf, setKeepSelf] = useState(false);
  const pickedName = people.find((p) => p.id === picked)?.name ?? null;
  const iOwn = !!meId && owners.ownerIds.has(meId);

  const handOff = () => {
    if (!picked) return;
    // Optimistic all the way: the owner line, the marker and the toast land
    // from the store; the dialog closes on the press.
    void owners.handoffTo(picked, note, { keepSelf: iOwn && keepSelf });
    onClose();
  };
  // ⌘↵ hands off from anywhere in the dialog, the note included.
  useEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && picked) {
      e.preventDefault();
      e.stopPropagation();
      handOff();
    }
  }, document, CAPTURE);

  return (
    <LiteDialog title="Hand to a teammate" subject={title} onClose={onClose}>
      {current.length > 0 && (
        <div className="lt-menu-owners" style={{ padding: "0 16px 10px" }}>
          <LiteFaces faces={current} size={18} />
          <span title={liteNamesLabel(current.map((o) => o.name))}>
            {current.length === 1 ? "Owner" : "Owners"}: {liteNamesLabel(current.map((o) => o.name))}
          </span>
        </div>
      )}
      <Command
        loop
        label="Teammates"
        className="flex min-h-0 flex-1 flex-col"
        filter={(value, search) => (value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)}
      >
        <div className="lt-dialog-search">
          <Search aria-hidden />
          <Command.Input autoFocus placeholder="Find a teammate" />
        </div>
        <Command.List>
          <Command.Empty>{people.length === 0 ? "No teammates on this session's team" : "Nobody matches"}</Command.Empty>
          {people.map((p) => (
            <Command.Item key={p.id} value={`${p.name} ${p.id}`} onSelect={() => setPicked(p.id)} data-picked={picked === p.id ? "" : undefined}>
              <LiteAvatar name={p.name} image={p.image} size={20} />
              <span className="flex-1 truncate">{p.name}</span>
              {p.owner ? <span className="lt-meta">Owner</span> : PRESENCE_WORD[p.presence] ? <span className="lt-meta">{PRESENCE_WORD[p.presence]}</span> : null}
              {picked === p.id && <Check className="lt-picked" aria-hidden />}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
      <label className="lt-dialog-field">
        Note
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={pickedName ? `For ${pickedName.split(/\s+/)[0]}` : "Optional"} rows={2} />
      </label>
      <div className="lt-dialog-foot">
        {iOwn ? (
          <label className="lt-dialog-check">
            <input type="checkbox" checked={keepSelf} onChange={(e) => setKeepSelf(e.target.checked)} />
            Stay an owner
          </label>
        ) : null}
        <button type="button" className="lt-btn-primary" disabled={!picked} onClick={handOff}>
          <span>{pickedName ? `Hand to ${pickedName.split(/\s+/)[0]}` : "Hand off"}</span>
          {picked && (
            <span className="inline-flex items-center gap-0.5" aria-hidden>
              <KeyCap size="xs" tone="onAccent">{isMac ? "⌘" : "Ctrl"}</KeyCap>
              <KeyCap size="xs" tone="onAccent">↵</KeyCap>
            </span>
          )}
        </button>
      </div>
    </LiteDialog>
  );
}
