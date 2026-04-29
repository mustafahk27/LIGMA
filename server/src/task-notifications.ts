import { query } from './db.js';
import { sendTaskAssignmentEmail, sendTaskStatusEmail } from './mailer.js';

export type TaskKind = 'action_item' | 'open_question';
export type TaskStatus = 'open' | 'inprogress' | 'completed' | 'closed';

export interface TaskTodo {
  id: string;
  text: string;
  status: string;
  kind?: string | null;
  assigneeId?: string | null;
  response?: string | null;
}

export interface TaskNotificationEvent {
  event_type: 'task_assigned' | 'task_status_changed';
  payload: Record<string, unknown>;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
}

interface RoomRow {
  name: string;
}

function normalizeStatus(status: string | undefined | null): TaskStatus {
  switch (status) {
    case 'in_progress':
    case 'inprogress':
      return 'inprogress';
    case 'completed':
    case 'closed':
    case 'open':
      return status;
    default:
      return 'open';
  }
}

function normalizeKind(kind: string | undefined | null, intent: string | null | undefined): TaskKind {
  if (kind === 'open_question' || kind === 'action_item') return kind;
  return intent === 'open_question' ? 'open_question' : 'action_item';
}

async function getUser(userId: string | null | undefined): Promise<UserRow | null> {
  if (!userId) return null;
  const result = await query<UserRow>(
    `SELECT id, name, email FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

async function getRoomName(roomId: string): Promise<string> {
  const result = await query<RoomRow>(
    `SELECT name FROM rooms WHERE id = $1`,
    [roomId]
  );
  return result.rows[0]?.name ?? 'a room';
}

function stableResponse(response: string | null | undefined): string {
  return (response ?? '').trim();
}

export async function collectTaskNotifications({
  roomId,
  actorId,
  nodeId,
  nodeAuthorId,
  nodeContent,
  nodeIntent,
  beforeTodos,
  afterTodos,
}: {
  roomId: string;
  actorId: string;
  nodeId: string;
  nodeAuthorId: string | null | undefined;
  nodeContent: string;
  nodeIntent: string | null | undefined;
  beforeTodos: TaskTodo[];
  afterTodos: TaskTodo[];
}): Promise<TaskNotificationEvent[]> {
  if (afterTodos.length === 0) return [];

  const roomName = await getRoomName(roomId);
  const actor = await getUser(actorId);
  const author = await getUser(nodeAuthorId);

  const beforeById = new Map(beforeTodos.map((todo) => [todo.id, todo]));
  const events: TaskNotificationEvent[] = [];

  for (const todo of afterTodos) {
    const before = beforeById.get(todo.id);
    const status = normalizeStatus(todo.status);
    const previousStatus = normalizeStatus(before?.status);
    const kind = normalizeKind(todo.kind, nodeIntent);
    const assigneeId = todo.assigneeId ?? null;
    const previousAssigneeId = before?.assigneeId ?? null;
    const response = stableResponse(todo.response);

    if (assigneeId && assigneeId !== previousAssigneeId) {
      const assignee = await getUser(assigneeId);
      if (assignee?.email) {
        void sendTaskAssignmentEmail({
          toEmail: assignee.email,
          assigneeName: assignee.name,
          roomName,
          taskText: todo.text,
          taskKind: kind,
          assignedBy: actor?.name ?? 'Someone',
          status,
        }).catch((err) => console.error('[mailer] Failed to send task assignment email:', err));
      }

      events.push({
        event_type: 'task_assigned',
        payload: {
          nodeId,
          taskId: todo.id,
          taskText: todo.text,
          taskKind: kind,
          roomName,
          assigneeId,
          assigneeName: assignee?.name ?? null,
          assignedById: actorId,
          assignedByName: actor?.name ?? null,
        },
      });
    }

    if (before && status !== previousStatus) {
      if (author?.email) {
        void sendTaskStatusEmail({
          toEmail: author.email,
          authorName: author.name,
          roomName,
          taskText: todo.text,
          taskKind: kind,
          updatedBy: actor?.name ?? 'Someone',
          status,
          response: kind === 'open_question' ? response : '',
        }).catch((err) => console.error('[mailer] Failed to send task status email:', err));
      }

      events.push({
        event_type: 'task_status_changed',
        payload: {
          nodeId,
          taskId: todo.id,
          taskText: todo.text,
          taskKind: kind,
          roomName,
          status,
          previousStatus,
          response: kind === 'open_question' ? response : '',
          authorId: nodeAuthorId ?? null,
          authorName: author?.name ?? null,
          updatedById: actorId,
          updatedByName: actor?.name ?? null,
          nodeContent,
        },
      });
    }
  }

  return events;
}