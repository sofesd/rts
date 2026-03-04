import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NoteWithUser {
  id: string;
  user_id: string;
  title: string;
  unlock_at: string;
  category: string;
  email_sent: boolean;
  user: {
    email: string;
    name: string;
    email_verified: boolean;
  };
}

interface ResendEmailRequest {
  from: string;
  to: string;
  subject: string;
  html: string;
  reply_to?: string;
}

interface ResendEmailResponse {
  id: string;
  from: string;
  to: string;
  created_at: string;
  error?: {
    message: string;
  };
}

async function sendEmailViaResend(emailData: ResendEmailRequest): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  
  if (!resendApiKey) {
    console.error("RESEND_API_KEY environment variable is not set");
    return { success: false, error: "Missing RESEND_API_KEY" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify(emailData),
    });

    const data: ResendEmailResponse = await response.json();

    if (!response.ok) {
      const errorMessage = data.error?.message || "Unknown error";
      console.error(`Resend API error for ${emailData.to}:`, errorMessage);
      return { success: false, error: errorMessage };
    }

    console.log(`Email sent successfully to ${emailData.to}, message ID: ${data.id}`);
    return { success: true, messageId: data.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to send email to ${emailData.to}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

async function updateNoteEmailSent(supabase: any, noteId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("notes")
      .update({ email_sent: true })
      .eq("id", noteId);

    if (error) {
      console.error(`Failed to update email_sent for note ${noteId}:`, error);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error updating note ${noteId}:`, error);
    return false;
  }
}

async function getReadyNotes(supabase: any): Promise<NoteWithUser[]> {
  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("notes")
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
      .eq("category", "time")
      .eq("email_sent", false)
      .lte("unlock_at", now)
      .is("users.email_verified", false); // Only get notes from verified users - note the logic here

    if (error) {
      console.error("Database query error:", error);
      return [];
    }

    // Filter to ensure we only process notes from verified users
    const verifiedNotes = (data || []).filter((note: any) => {
      return note.users && note.users.email_verified === true;
    });

    return verifiedNotes as NoteWithUser[];
  } catch (error) {
    console.error("Error fetching ready notes:", error);
    return [];
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
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

serve(async (req: Request) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify request is from authorized cron scheduler
    const authHeader = req.headers.get("authorization");
    const expectedToken = Deno.env.get("CRON_SECRET");

    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      console.warn("Unauthorized cron request");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Starting note reminder job...");

    // Get all ready notes
    const readyNotes = await getReadyNotes(supabase);
    console.log(`Found ${readyNotes.length} notes ready to send`);

    let successCount = 0;
    let failureCount = 0;

    // Process each note
    for (const note of readyNotes) {
      try {
        // Validate note data
        if (!note.user || !note.user.email || !note.user.name) {
          console.warn(`Skipping note ${note.id}: invalid user data`);
          failureCount++;
          continue;
        }

        // Send email
        const emailResult = await sendEmailViaResend({
          from: "noreply@returned-to-sender.com",
          to: note.user.email,
          subject: "Your note on Returned To Sender is ready to open",
          html: generateEmailHtml(note.user.name, note.title),
          reply_to: "support@returned-to-sender.com",
        });

        if (emailResult.success) {
          // Update database to mark email as sent
          const updateSuccess = await updateNoteEmailSent(supabase, note.id);
          if (updateSuccess) {
            console.log(`Successfully processed note ${note.id} for user ${note.user_id}`);
            successCount++;
          } else {
            console.error(`Failed to update note ${note.id} after successful email send`);
            failureCount++;
          }
        } else {
          console.error(`Failed to send email for note ${note.id}: ${emailResult.error}`);
          failureCount++;
          // Do NOT update email_sent to retry later
        }
      } catch (error) {
        console.error(`Error processing note ${note.id}:`, error);
        failureCount++;
      }
    }

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      notesProcessed: readyNotes.length,
      successCount,
      failureCount,
      message: `Processed ${readyNotes.length} notes: ${successCount} succeeded, ${failureCount} failed`,
    };

    console.log("Job completed:", response);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Critical error in reminder job:", errorMessage);

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
