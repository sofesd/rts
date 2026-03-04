# Returned To Sender - Email Reminder System Setup Guide

## Overview

This guide walks you through setting up the automated email reminder system for the "Returned To Sender" app. The system sends users email notifications when their time-based notes are ready to open.

**Architecture:**
- **Backend**: Supabase Edge Function (TypeScript/Deno)
- **Database**: Supabase PostgreSQL with RLS policies
- **Email Provider**: Resend
- **Scheduler**: Supabase Database Webhooks + Cloud Functions (runs every minute)

---

## Prerequisites

- Supabase account (https://supabase.com)
- Resend account (https://resend.com)
- Node.js 18+ and Supabase CLI installed
- Git for version control

### Installation

```bash
# Install Supabase CLI
npm install -g @supabase/cli

# Install Resend CLI (optional, for testing)
npm install resend
```

---

## Step 1: Set Up Supabase Project

### 1.1 Create a Supabase Project

1. Go to https://supabase.com and sign in
2. Click "New Project"
3. Fill in project details:
   - **Name**: `returned-to-sender`
   - **Database Password**: Generate a strong password
   - **Region**: Choose closest to your users
4. Wait for project to initialize
5. Copy your project details:
   - **Project URL**: `Settings > API > Project URL`
   - **Service Role Key**: `Settings > API > service_role` (KEEP SECRET!)
   - **Anon Key**: `Settings > API > anon` (safe for frontend)

### 1.2 Initialize Local Supabase Project

```bash
cd ~/Desktop/ReturnedToSender

# Initialize Supabase
supabase init

# Link to your remote project
supabase link --project-ref your-project-ref

# Link your database password when prompted
```

### 1.3 Apply Database Migrations

```bash
# Push migrations to your remote database
supabase db push

# Or manually execute the SQL from migrations/001_create_tables.sql in Supabase SQL Editor
```

---

## Step 2: Configure Resend

### 2.1 Create Resend Account

1. Sign up at https://resend.com
2. Go to API Keys: https://resend.com/api-keys
3. Create a new API key
4. Copy the API key (format: `re_xxxxx...`)

### 2.2 Verify Sender Email

1. Go to https://resend.com/domains
2. Add your domain or use a subdomain
3. Follow DNS verification instructions
4. Or use Resend's trial domain `onboarding@resend.dev` initially (emails will have "via resend.dev" note)

**For production:**
- Verify `noreply@yourdomain.com` or your preferred sender email
- Add SPF, DKIM, and DMARC records as instructed

---

## Step 3: Deploy Edge Function

### 3.1 Create Edge Function Directory Structure

```bash
mkdir -p supabase/functions/send-note-reminders
cd supabase/functions/send-note-reminders
```

The file `supabase/functions/send-note-reminders/index.ts` is already created.

### 3.2 Configure Function

Create `supabase/functions/send-note-reminders/.env` (local):

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
RESEND_API_KEY=re_your_api_key
CRON_SECRET=your_secure_token
```

### 3.3 Deploy Edge Function

```bash
# From project root
supabase functions deploy send-note-reminders

# Verify deployment
supabase functions list
```

---

## Step 4: Set Up Cron Scheduling

### Option A: Using Supabase Database Webhooks + Cloud Function (Recommended)

This setup uses a timer service to call your edge function every minute.

#### 4.1 Create a Cloud Function Scheduler

You'll need an external cron service. Popular options:

**Option A1: Using EasyCron (Free)**
1. Go to https://www.easycron.com
2. Create account
3. Add new cron job:
   - **URL**: `https://your-project.supabase.co/functions/v1/send-note-reminders`
   - **Schedule**: Every minute (`*/1 * * * *`)
   - **HTTP Headers**:
     - `Authorization: Bearer your_cron_secret`
   - **HTTP Method**: POST
4. Test the cron job

**Option A2: Using Upstash Cron (Free tier with limits)**
1. Go to https://upstash.com
2. Create account and navigate to Cron
3. Create new cron job:
   - **Function**: API endpoint to `https://your-project.supabase.co/functions/v1/send-note-reminders`
   - **Schedule**: `* * * * *` (every minute)
   - **Headers**:
     - `Authorization: Bearer your_cron_secret`
   - **Body**: `{}`
4. Save and enable

**Option A3: Using GitHub Actions (Most reliable for free tier)**

Create `.github/workflows/send-note-reminders.yml`:

```yaml
name: Send Note Reminders

on:
  schedule:
    - cron: '*/1 * * * *'  # Every minute
  workflow_dispatch:  # Manual trigger

jobs:
  send-reminders:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger reminder function
        run: |
          curl -X POST \
            https://your-project.supabase.co/functions/v1/send-note-reminders \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json" \
            -d '{}'
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

Add secret to GitHub:
1. Go to `Settings > Secrets and variables > Actions`
2. Click `New repository secret`
3. Name: `CRON_SECRET`
4. Value: Your secure CRON_SECRET token

---

## Step 5: Configure Environment Variables

### 5.1 Update Supabase Secrets

In Supabase dashboard:

1. Go to `Settings > Edge Functions > Secrets`
2. Add each variable:

```
RESEND_API_KEY = re_your_api_key_here
CRON_SECRET = your_secure_token_here
SUPABASE_URL = https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY = your_service_role_key_here
```

**CRITICAL SECURITY NOTE:**
- Never commit actual keys to git
- Use `.env.local` for local development (add to `.gitignore`)
- Always use Supabase dashboard or CLI secrets for production

---

## Step 6: Update Frontend Integration

### 6.1 Update Note Creation Logic

In your frontend app (`c:\Users\sofia\Desktop\CODING\UNREAD1.html`), update the `saveNote()` function:

```javascript
saveNote() {
    if (!this.newNote.title || !this.newNote.body) return;
    
    const note = {
        id: Date.now(),
        ...this.newNote,
        dateCreated: new Date().toISOString(),
        isLocked: this.newNote.category === 'Future Date',
        isRead: false,
        isPinned: false,
        // Add these fields for email reminders:
        category: this.mapCategoryToDb(this.newNote.category),
        unlock_at: this.newNote.unlockDate,
        unlock_mood: this.newNote.unlockMood,
        email_sent: false
    };
    
    // Save to localStorage for now (or sync with Supabase)
    this.notes.unshift(note);
    localStorage.setItem('unread_notes', JSON.stringify(this.notes));
    this.view = 'home';
},

mapCategoryToDb(category) {
    const mapping = {
        'Future Date': 'time',
        'Mood-Based': 'mood',
        'Achievement / Event': 'achievement',
        'Reflection': 'reflection'
    };
    return mapping[category] || category;
}
```

### 6.2 Sync Notes with Supabase (Optional)

For automatic email reminders to work, notes should be stored in Supabase:

```javascript
async sendNoteToSupabase(note) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    
    const response = await fetch(
        `${supabaseUrl}/rest/v1/notes`,
        {
            method: 'POST',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${sessionToken}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                user_id: this.user.id,
                title: note.title,
                body: note.body,
                category: note.category,
                unlock_at: note.unlock_at,
                unlock_mood: note.unlock_mood,
                is_locked: note.isLocked,
                is_read: note.isRead,
                is_pinned: note.isPinned
            })
        }
    );
    
    if (!response.ok) {
        console.error('Failed to save note to Supabase');
        return false;
    }
    
    return true;
}
```

---

## Step 7: Testing

### 7.1 Test Edge Function Locally

```bash
# Start local Supabase
supabase start

# In another terminal, test the function
curl -X POST http://localhost:54321/functions/v1/send-note-reminders \
  -H "Authorization: Bearer test_token" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 7.2 Test in Database

1. Go to Supabase SQL Editor
2. Create a test user:

```sql
insert into public.users (email, name, email_verified)
values ('test@example.com', 'Test User', true);
```

3. Create a test note with unlock_at in the past:

```sql
insert into public.notes (
  user_id, 
  title, 
  body, 
  category, 
  unlock_at,
  is_locked,
  email_sent
) values (
  (select id from public.users where email = 'test@example.com' limit 1),
  'Test Note',
  'This is a test note',
  'time',
  now() - interval '1 minute',
  true,
  false
);
```

4. Manually trigger your cron job
5. Check email inbox and Supabase logs

### 7.3 Verify Email Sending

```bash
# Check Resend logs
curl https://api.resend.com/emails \
  -H 'Authorization: Bearer re_your_key' \
  -H 'Content-Type: application/json'
```

---

## Step 8: Monitoring & Troubleshooting

### 8.1 View Edge Function Logs

```bash
# Using Supabase CLI
supabase functions list
supabase functions logs send-note-reminders

# Or in Supabase dashboard:
# Functions > send-note-reminders > Logs tab
```

### 8.2 Common Issues

**Issue: "RESEND_API_KEY not set"**
- Solution: Add the secret in Supabase Settings > Edge Functions > Secrets

**Issue: "Unauthorized" errors from cron**
- Solution: Verify CRON_SECRET matches between edge function and cron service

**Issue: Emails not sending**
1. Check that FROM_EMAIL is verified in Resend
2. Verify user.email_verified is true in database
3. Check that notes.category = 'time'
4. Verify notes.unlock_at <= current time
5. Check notes.email_sent = false

**Issue: Duplicate emails**
- This shouldn't happen if email_sent flag updates properly
- Check function logs for update failures
- Manually set email_sent = true if needed:
  ```sql
  update public.notes set email_sent = true where id = 'note-id';
  ```

---

## Step 9: Production Deployment Checklist

- [ ] All environment variables set in Supabase secrets
- [ ] Resend domain verified (not using trial domain)
- [ ] Cron job scheduled and tested
- [ ] Database migrations applied
- [ ] RLS policies verified (Settings > Auth > Policies)
- [ ] Edge function tested with real data
- [ ] Error logging/monitoring in place (Sentry, DataDog, etc.)
- [ ] Backup plan if email service fails
- [ ] Rate limiting configured (if needed)

---

## Security Best Practices

1. **Never expose secrets:**
   - RESEND_API_KEY
   - SUPABASE_SERVICE_ROLE_KEY
   - CRON_SECRET

2. **Use environment variables:**
   - Store in Supabase secrets, not in code
   - Use different keys for dev/prod

3. **Validate input:**
   - The edge function validates user.email_verified
   - Only sends to notes with category = 'time'
   - Only sends to notes with email_sent = false

4. **Log errors securely:**
   - Don't log sensitive data
   - Use structured logging
   - Set up alerts for failures

5. **Rate limiting:**
   - Resend has built-in rate limits
   - Consider per-user limits if needed

---

## Maintenance

### Regular Tasks

1. **Monitor email delivery:**
   - Check Resend dashboard for bounces
   - Track unsubscribes
   - Monitor send failures

2. **Database maintenance:**
   - Archive old deleted notes
   - Monitor database size
   - Optimize slow queries

3. **Update dependencies:**
   - Keep Deno stdlib updated
   - Update Resend API if needed
   - Review security advisories

### Scaling Considerations

As you grow:
1. Move to larger cron intervals if needed (e.g., every 5 minutes)
2. Consider batch processing if volume exceeds 1000+ emails/minute
3. Add queue system (Bull, RabbitMQ) for retry logic
4. Separate read/write database replicas

---

## Support

For issues or questions:
- Supabase Docs: https://supabase.com/docs
- Resend Docs: https://resend.com/docs
- Edge Functions Guide: https://supabase.com/docs/guides/functions

---

**Last Updated**: February 19, 2026
**Version**: 1.0
