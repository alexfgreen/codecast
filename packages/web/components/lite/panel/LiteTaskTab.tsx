// The session panel's task tab: the task this session works, as a compact
// card that can move it. Its status, who holds it (handing it to a teammate
// is picking them), how far its subtasks are, its brief folded away, and the
// way to the full task page. Paints from the session row's snapshot of the
// task, then from the live row once the detail feed lands it.
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useInboxStore, type TaskRef } from "../../../store/inboxStore";
import { useTaskRow } from "../../../hooks/useThreadPreviews";
import { useSyncTaskDetail } from "../../../hooks/useSyncTasks";
import { useOrgRoles } from "../../../hooks/useOrgRoles";
import { resolveAssigneeInfo } from "../../../lib/liveEntities";
import { subtaskTally } from "../../../lib/subtaskTally";
import { taskFacePath } from "../../../lib/workUnit";
import { TaskStatusPicker } from "../../tasks/TaskStatusPicker";
import { AssigneeSelect } from "../../AssigneeSelect";
import { MessageMarkdown } from "../../conversation/markdown";
import "./panel.css";

export function LiteTaskTab({ task: ref }: { task: TaskRef }) {
  useSyncTaskDetail(ref._id);
  const row = useTaskRow(ref._id);
  const task = { ...ref, ...(row ?? {}) };
  // The raw fields an optimistic write moves, read on their own: the row's
  // wake signature covers what a card shows, not the assignee's id.
  const assignee = useInboxStore((s) => (s.tasks[ref._id] as { assignee?: string } | undefined)?.assignee ?? null);
  const statusId = useInboxStore((s) => (s.tasks[ref._id] as { status_id?: string } | undefined)?.status_id ?? null);
  const tally = useInboxStore((s) => subtaskTally(ref._id, s.tasks as Parameters<typeof subtaskTally>[1]));
  const teamMembers = useInboxStore((s) => s.teamMembers);
  const currentUser = useInboxStore((s) => s.currentUser);
  const { roles } = useOrgRoles();
  const assigneeInfo = resolveAssigneeInfo(assignee, row?.assignee_info, teamMembers, currentUser, roles);
  const description = (row?.description ?? "").trim();
  const [done, total] = tally ? tally.split("/").map(Number) : [0, 0];

  return (
    <div className="lt-task">
      <div className="lt-task-head">
        <span className="lt-task-title">{task.title}</span>
        {task.short_id && <span className="lt-task-id">{task.short_id}</span>}
      </div>
      <div className="lt-task-props">
        <TaskStatusPicker task={{ ...task, status_id: statusId }} />
        <AssigneeSelect
          value={assignee}
          valueInfo={assigneeInfo}
          teamMembers={teamMembers}
          currentUser={currentUser}
          onChange={(id) => {
            if (task.short_id) void useInboxStore.getState().updateTask(task.short_id, { assignee: (id ?? null) as string });
          }}
        />
      </div>
      {total > 0 && (
        <div className="lt-task-line">
          <span>Subtasks</span>
          <span className="lt-task-tally">{done}/{total}</span>
          <span className="lt-task-bar" aria-hidden>
            <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </span>
        </div>
      )}
      {description && (
        <details className="lt-task-desc">
          <summary>Description</summary>
          <div className="lt-task-md">
            <MessageMarkdown content={description} />
          </div>
        </details>
      )}
      <Link href={taskFacePath(task)} className="lt-btn self-start">
        Open task in classic
        <ArrowUpRight aria-hidden />
      </Link>
    </div>
  );
}
