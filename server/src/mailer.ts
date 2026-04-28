const EMAILJS_SERVICE_ID = process.env['EMAILJS_SERVICE_ID'] ?? '';
const EMAILJS_TEMPLATE_ID = process.env['EMAILJS_TEMPLATE_ID'] ?? '';
const EMAILJS_PUBLIC_KEY = process.env['EMAILJS_PUBLIC_KEY'] ?? '';
const EMAILJS_PRIVATE_KEY = process.env['EMAILJS_PRIVATE_KEY'] ?? '';
const FRONTEND_URL = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';

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

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: {
        to_email: toEmail,
        inviter_name: inviterName,
        room_name: roomName,
        role,
        invite_link: inviteLink,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS error ${res.status}: ${text}`);
  }
}
