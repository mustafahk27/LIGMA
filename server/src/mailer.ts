import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  family: 4,
  auth: {
    user: process.env['GMAIL_USER'],
    pass: process.env['GMAIL_APP_PASSWORD'],
  },
});

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

  await transporter.sendMail({
    from: `"LIGMA" <${process.env['GMAIL_USER']}>`,
    to: toEmail,
    subject: `${inviterName} invited you to "${roomName}" on LIGMA`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #0f0f0f; color: #e5e5e5; border-radius: 12px;">
        <h2 style="margin: 0 0 8px; font-size: 20px; color: #fff;">You're invited to collaborate</h2>
        <p style="margin: 0 0 24px; color: #a1a1aa; font-size: 14px;">
          <strong style="color: #e5e5e5;">${inviterName}</strong> invited you to join
          <strong style="color: #e5e5e5;">${roomName}</strong> as a <strong style="color: #e5e5e5;">${role}</strong>.
        </p>

        <a href="${inviteLink}"
           style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff;
                  text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
          Accept Invitation
        </a>

        <p style="margin: 24px 0 0; font-size: 12px; color: #52525b;">
          This invite expires in 48 hours. If you weren't expecting this, you can ignore this email.
        </p>
        <p style="margin: 8px 0 0; font-size: 12px; color: #52525b;">
          Or copy this link: <a href="${inviteLink}" style="color: #6366f1;">${inviteLink}</a>
        </p>
      </div>
    `,
  });
}
