// Lite's new session: the composer as the page's centre (T3 Code's draft
// hero). The person says what to do, picks where and with what, and sends;
// the session starts through the one web spawn route (lib/spawnSession:
// the stub row and the first bubble paint at once, the create and the send
// ride the dispatch outbox) and Lite opens it under its stub id, which the
// session page swaps for the real id when it lands.
//
// The text box is its own component holding its own text, so a keystroke
// re-renders the box and nothing around it (the pickers, the page); its
// textarea is ComposerTextarea, which holds React's text node still
// (lib/holdTextareaTextNode). components/lite/__tests__/
// liteNewSessionTyping.mount.test.tsx holds it to the composer's budget.
import "./thread.css";
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { ArrowUp, Bot, ChevronDown, Cpu, Monitor } from "lucide-react";
import { AGENT_MODEL_CONFIG, findModelOption, modelAgentKey, type ConvexAgentType } from "@codecast/shared/contracts";
import { useInboxStore } from "../../../store/inboxStore";
import { useWatchEffect } from "../../../hooks/useWatchEffect";
import { useDefaultAgentType, usePinnedPickerOptions } from "../../../hooks/usePinnedAgents";
import { useSessionMachines } from "../../../hooks/useSessionMachines";
import { spawnSessionWithPrompt } from "../../../lib/spawnSession";
import { liteSessionPath } from "../../../lib/inboxRouting";
import { fromConvexAgentType } from "@codecast/shared/contracts";
import { ComposerTextarea } from "../../ComposerShell";
import { ProjectPathPicker } from "../../ProjectPathPicker";
import { ModelEffortRows } from "../../ModelEffortPicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";

type Launch = { agentType: ConvexAgentType; projectPath: string; model: string; machine: string | null };

export function LiteNewSession() {
  const navigate = useNavigate();
  const defaultAgent = useDefaultAgentType();
  const [agentType, setAgentType] = useState<ConvexAgentType>(defaultAgent);
  // The folder the person worked in last, until they pick another.
  const [projectPath, setProjectPath] = useState<string>(() => useInboxStore.getState().recentProjects?.[0]?.path ?? "");
  const [model, setModel] = useState("default");
  const [machine, setMachine] = useState<string | null>(null);
  const launch = useRef<Launch>({ agentType, projectPath, model, machine });
  launch.current = { agentType, projectPath, model, machine };

  const submit = useCallback((prompt: string) => {
    const l = launch.current;
    const { stubId } = spawnSessionWithPrompt({
      prompt,
      agentType: l.agentType,
      projectPath: l.projectPath || undefined,
      model: l.model !== "default" ? l.model : undefined,
      targetDeviceId: l.machine ?? undefined,
      failureLabel: "Failed to start a Lite session",
    });
    navigate(liteSessionPath(stubId));
  }, [navigate]);

  const hosted = usePinnedPickerOptions(fromConvexAgentType(agentType)).find((o) => o.convexType === agentType)?.hosted ?? false;
  const foot = useMemo(() => (
    <>
      <AgentPick value={agentType} onChange={(a) => { setAgentType(a); setModel("default"); }} />
      <ModelPick agentType={agentType} value={model} onChange={setModel} />
      {!hosted && <MachinePick value={machine} onChange={setMachine} />}
      {!hosted && (
        <div className="lt-hero-path">
          <ProjectPathPicker value={projectPath} onChange={setProjectPath} placeholder="Folder" />
        </div>
      )}
    </>
  ), [agentType, model, machine, projectPath, hosted]);

  return (
    <div className="lt-hero">
      <h1>What should we work on?</h1>
      <LiteHeroInput onSubmit={submit} foot={foot} />
    </div>
  );
}

/** The box: its text, Enter to send, the send button. `foot` is the pickers'
 *  row, built by the page, so typing never rebuilds it. */
export const LiteHeroInput = memo(function LiteHeroInput({ onSubmit, foot }: { onSubmit: (prompt: string) => void; foot?: ReactNode }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Lite's new-session key lands here (LiteShortcuts navigates to /lite);
  // every arrival focuses the box.
  const locationKey = useLocation().key;
  useWatchEffect(() => {
    ref.current?.focus();
  }, [locationKey]);
  const canSend = text.trim().length > 0;
  const send = () => {
    const prompt = text.trim();
    if (!prompt) return;
    setText("");
    onSubmit(prompt);
  };
  return (
    <form className="lt-hero-card" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <ComposerTextarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Ask the agent to do something"
        aria-label="What should the agent do"
        autoFocus
      />
      <div className="lt-hero-foot">
        {foot}
        <button type="submit" className="lt-send" disabled={!canSend} aria-label="Start session">
          <ArrowUp aria-hidden />
        </button>
      </div>
    </form>
  );
});

function AgentPick({ value, onChange }: { value: ConvexAgentType; onChange: (a: ConvexAgentType) => void }) {
  const options = usePinnedPickerOptions(fromConvexAgentType(value));
  const current = options.find((o) => o.convexType === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="lt-pick" aria-label={`Agent: ${current?.label ?? value}`}>
          <Bot aria-hidden />
          <span>{current?.label ?? value}</span>
          <ChevronDown aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-lite="" className="lt-menu">
        {options.map((o) => (
          <DropdownMenuItem key={o.id} className="lt-menu-item" onSelect={() => onChange(o.convexType)}>
            <span className="flex-1">{o.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelPick({ agentType, value, onChange }: { agentType: string; value: string; onChange: (m: string) => void }) {
  if (!AGENT_MODEL_CONFIG[modelAgentKey(agentType)]) return null;
  const label = value === "default" ? "Default model" : findModelOption(agentType, value)?.label ?? value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="lt-pick" aria-label={`Model: ${label}`}>
          <Cpu aria-hidden />
          <span>{label}</span>
          <ChevronDown aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-1rem)]">
        <ModelEffortRows agentType={agentType} modelKey={value} effort={null} midSession={false} part="model" onSelect={(sel) => { if (sel.model) onChange(sel.model); }} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MachinePick({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const machines = useSessionMachines();
  if (machines.length < 2) return null;
  const name = (d: { label?: string; hostname?: string; bot_name?: string | null; device_id: string }) => d.bot_name || d.label || d.hostname || d.device_id.slice(0, 8);
  const current = machines.find((d) => d.device_id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="lt-pick" aria-label={`Machine: ${current ? name(current) : "Any"}`}>
          <Monitor aria-hidden />
          <span>{current ? name(current) : "Any machine"}</span>
          <ChevronDown aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-lite="" className="lt-menu">
        <DropdownMenuItem className="lt-menu-item" onSelect={() => onChange(null)}>Any machine</DropdownMenuItem>
        {machines.map((d) => (
          <DropdownMenuItem key={d.device_id} className="lt-menu-item" onSelect={() => onChange(d.device_id)}>
            <span className="flex-1 truncate">{name(d)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
