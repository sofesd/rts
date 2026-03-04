import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import cron from 'node-cron';

dotenv.config();

// Initialize clients
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Authenticate requests
function authenticateRequest(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }

  if (authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

interface NoteWithUser {
  id: string;
  user_id: string;
  title: string;
  unlock_at: string;
  category: string;
  email_sent: boolean;
  users: {
    email: string;
    name: string;
    email_verified: boolean;
  };
}

async function sendNoteReminders() {
  try {
    console.log('Starting note reminder job...');

    // Query for notes ready to send
    const now = new Date().toISOString();

    const { data: readyNotes, error: queryError } = await supabase
      .from('notes')
      .select(
        `
        id,
        user_id,
        title,
        unlock_at,
        category,
        email_sent,
        users:user_id (
          email,
          name,
          email_verified
        )
      `
      )
      .eq('category', 'time')
      .eq('email_sent', false)
      .lte('unlock_at', now);

    if (queryError) {
      console.error('Database query error:', queryError);
      return { success: false, error: queryError.message };
    }

    // Filter to only verified users
    const verifiedNotes = (readyNotes || []).filter((note: any) => {
      return note.users && note.users.email_verified === true;
    }) as NoteWithUser[];

    console.log(`Found ${verifiedNotes.length} notes ready to send`);

    let successCount = 0;
    let failureCount = 0;

    // Process each note
    for (const note of verifiedNotes) {
      try {
        if (!note.users || !note.users.email) {
          console.warn(`Skipping note ${note.id}: invalid user data`);
          failureCount++;
          continue;
        }

        // Generate email
        const emailHtml = generateEmailHtml(note.users.name, note.title);

        // Send via Resend
        const { data: sendData, error: sendError } = await resend.emails.send({
          from: 'noreply@returned-to-sender.com',
          to: note.users.email,
          subject: 'Your note on Returned To Sender is ready to open',
          html: emailHtml,
          reply_to: 'support@returned-to-sender.com',
        });

        if (sendError) {
          console.error(`Failed to send email for note ${note.id}:`, sendError);
          failureCount++;
          continue;
        }

        // Update database
        const { error: updateError } = await supabase
          .from('notes')
          .update({ email_sent: true })
          .eq('id', note.id);

        if (updateError) {
          console.error(`Failed to update note ${note.id}:`, updateError);
          failureCount++;
          continue;
        }

        console.log(
          `Successfully sent reminder for note ${note.id} to ${note.users.email}`
        );
        successCount++;
      } catch (error) {
        console.error(`Error processing note ${note.id}:`, error);
        failureCount++;
      }
    }

    return {
      success: true,
      timestamp: new Date().toISOString(),
      notesProcessed: verifiedNotes.length,
      successCount,
      failureCount,
    };
  } catch (error) {
    console.error('Critical error in reminder job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function generateEmailHtml(userName: string, noteTitle: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #a855f7 0%, #6366f1 100%); color: white; padding: 30px; border-radius: 8px; text-align: center; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #f9fafb; padding: 30px; border-radius: 8px; }
        .content p { margin: 15px 0; }
        .note-title { background: white; padding: 15px; border-left: 4px solid #a855f7; border-radius: 4px; font-weight: 600; margin: 20px 0; }
        .cta-button { display: inline-block; background: #a855f7; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Returned To Sender</h1>
          <p>Your Message is Ready</p>
        </div>
        
        <div class="content">
          <p>Hi ${escapeHtml(userName)},</p>
          
          <p>A note you wrote titled:</p>
          <div class="note-title">"${escapeHtml(noteTitle)}"</div>
          <p>is now ready to open.</p>
          
          <p>Visit <strong>Returned To Sender</strong> to read your message and unlock what your past self wanted to tell you.</p>
          
          <center>
            <a href="https://returned-to-sender.com" class="cta-button">Open Your Note</a>
          </center>
          
          <p style="margin-top: 40px; font-size: 14px; color: #666;">
            <em>Write now. Open later.</em>
          </p>
        </div>
        
        <div class="footer">
          <p>© 2026 Returned To Sender. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Manual trigger endpoint (for testing)
app.post('/send-reminders', authenticateRequest, async (req, res) => {
  const result = await sendNoteReminders();
  const statusCode = result.success ? 200 : 500;
  res.status(statusCode).json(result);
});

// Start server
app.listen(PORT, () => {
  console.log(`Reminder service listening on port ${PORT}`);
});

// Schedule cron job
// Runs every minute
cron.schedule('* * * * *', async () => {
  console.log('[CRON] Executing sendNoteReminders...');
  const result = await sendNoteReminders();
  console.log('[CRON] Result:', result);
});

console.log('Cron scheduler initialized. Running every minute.');
