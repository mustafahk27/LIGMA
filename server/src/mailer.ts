const EMAILJS_SERVICE_ID = process.env['EMAILJS_SERVICE_ID'] ?? '';
const EMAILJS_TEMPLATE_ID = process.env['EMAILJS_TEMPLATE_ID'] ?? '';
const EMAILJS_TASK_TEMPLATE_ID = process.env['EMAILJS_TASK_TEMPLATE_ID'] ?? EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env['EMAILJS_PUBLIC_KEY'] ?? '';
const EMAILJS_PRIVATE_KEY = process.env['EMAILJS_PRIVATE_KEY'] ?? '';
const FRONTEND_URL = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';

async function sendEmail({
  toEmail,
  templateId,
  templateParams,
}: {
  toEmail: string;
  templateId: string;
  templateParams: Record<string, string>;
}): Promise<void> {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: templateId,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: {
        to_email: toEmail,
        ...templateParams,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS error ${res.status}: ${text}`);
  }
}

export async function sendInviteEmail({
  toEmail,
  inviterName,
  roomName,
  role,
  token,
}: {
  toEmail: string;
  inviterName: string;
  roomName: string;
  role: string;
  token: string;
}): Promise<void> {
  const inviteLink = `${FRONTEND_URL}/invite/${token}`;
  await sendEmail({
    toEmail,
    templateId: EMAILJS_TEMPLATE_ID,
    templateParams: {
      inviter_name: inviterName,
      room_name: roomName,
      role,
      invite_link: inviteLink,
    },
  });
}

export async function sendTaskAssignmentEmail({
  toEmail,
  assigneeName,
  roomName,
  taskText,
  taskKind,
  assignedBy,
  status,
}: {
  toEmail: string;
  assigneeName: string;
  roomName: string;
  taskText: string;
  taskKind: string;
  assignedBy: string;
  status: string;
}): Promise<void> {
  await sendEmail({
    toEmail,
    templateId: EMAILJS_TASK_TEMPLATE_ID,
    templateParams: {
      assignee_name: assigneeName,
      room_name: roomName,
      task_text: taskText,
      task_kind: taskKind,
      task_status: status,
      assigned_by: assignedBy,
      notification_type: 'assignment',
    },
  });
}

export async function sendTaskStatusEmail({
  toEmail,
  authorName,
  roomName,
  taskText,
  taskKind,
  updatedBy,
  status,
  response,
}: {
  toEmail: string;
  authorName: string;
  roomName: string;
  taskText: string;
  taskKind: string;
  updatedBy: string;
  status: string;
  response: string;
}): Promise<void> {
  await sendEmail({
    toEmail,
    templateId: EMAILJS_TASK_TEMPLATE_ID,
    templateParams: {
      author_name: authorName,
      room_name: roomName,
      task_text: taskText,
      task_kind: taskKind,
      task_status: status,
      updated_by: updatedBy,
      task_response: response,
      notification_type: 'status_change',
    },
  });
}
