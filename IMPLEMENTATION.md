# Email Reminder System - Complete Implementation Guide

## Overview

This document explains how to integrate the automated email reminder system into your "Returned To Sender" app. The system consists of:

1. **Frontend**: Web app (HTML/Alpine.js) running on client
2. **Database**: Supabase PostgreSQL with notes and users tables
3. **Backend**: Either Supabase Edge Functions OR Node.js server
4. **Scheduler**: Cron job (runs every minute)
5. **Email Provider**: Resend API

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        RETURNED TO SENDER APP                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────┐                ┌──────────────────┐ │
│  │  Frontend / Browser    │                │   localStorage  │ │
│  │  (HTML/Alpine.js)      │──────Register──│  (User data)     │ │
│  │                        │  Create Notes  └──────────────────┘ │
│  └───────────┬────────────┘                                     │
│              │                                                  │
│              │ Write Note                                       │
│              │ (title, unlock_at, category)                    │
│              │                                                  │
│              ▼                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │        Supabase PostgreSQL Database                        │ │
│  │  ┌──────────┐              ┌──────────────────────────────┐│ │
│  │  │  USERS   │              │        NOTES                 ││ │
│  │  ├──────────┤              ├──────────────────────────────┤│ │
│  │  │ id (PK)  │◄─────┐       │ id (PK)                      ││ │
│  │  │ email    │      │       │ user_id (FK)                 ││ │
│  │  │ name     │      └──────►│ title                        ││ │
│  │  │ verified │              │ body                         ││ │
│  │  └──────────┘              │ category (time/mood/...)     ││ │
│  │                            │ unlock_at ← TRIGGER          ││ │
│  │                            │ email_sent ← UPDATE WHEN SENT││ │
│  │                            │ created_at                   ││ │
│  │                            └──────────────────────────────┘│ │
│  └────────────────────────────────────────────────────────────┘ │
│              ▲                                                  │
│              │                                                  │
└──────────────┼──────────────────────────────────────────────────┘
               │
               │
┌──────────────┼────────────────────────────────────────────────────┐
│              │         BACKEND REMINDER SERVICE                  │
│              │         (Runs Every Minute)                       │
│              │                                                   │
│     ┌────────▼──────────────────────────────────────┐           │
│     │  1. Query Supabase:                           │           │
│     │     - Fetch notes where:                      │           │
│     │       * category = 'time'                     │           │
│     │       * email_sent = false                    │           │
│     │       * unlock_at <= NOW()                    │           │
│     │       * user.email_verified = true            │           │
│     └────────┬──────────────────────────────────────┘           │
│              │                                                   │
│     ┌────────▼──────────────────────────────────────┐           │
│     │  2. For Each Ready Note:                      │           │
│     │     - Generate email HTML                    │           │
│     │     - Send via Resend API                    │           │
│     │     - Log success/failure                    │           │
│     └────────┬──────────────────────────────────────┘           │
│              │                                                   │
│     ┌────────▼──────────────────────────────────────┐           │
│     │  3. Update Database:                          │           │
│     │     - Set email_sent = true (on success)     │           │
│     │     - Keep email_sent = false (on failure)   │           │
│     │     - Prevent duplicate emails               │           │
│     └────────┬──────────────────────────────────────┘           │
│              │                                                   │
│     ┌────────▼──────────────────────────────────────┐           │
│     │  4. Monitor & Log:                            │           │
│     │     - Record results                         │           │
│     │     - Alert on errors                        │           │
│     └───────────────────────────────────────────────┘           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

                          │
                          ▼
        ┌─────────────────────────────────┐
        │     RESEND EMAIL SERVICE        │
        │  Sends emails to user inbox     │
        └─────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Database Setup

#### 1.1 Run Database Migrations

In Supabase dashboard (SQL Editor):

```sql
-- Execute the migration from: supabase/migrations/001_create_tables.sql
-- This creates users and notes tables with proper indexes and RLS policies
```

Or using Supabase CLI:

```bash
supabase db push
```

#### 1.2 Verify Tables Exist

```bash
# Test with curl
curl "https://your-project.supabase.co/rest/v1/notes?limit=1" \
  -H "apikey: your-anon-key" \
  -H "Authorization: Bearer your-anon-key"
```

---

### Step 2: Choose Backend Implementation

#### Option A: Supabase Edge Functions (Recommended for Quick Setup)

**Pros**: No server management, included with Supabase, scales automatically
**Cons**: Limited customization, cold start times

```bash
# Deploy edge function
supabase functions deploy send-note-reminders

# Set secrets in Supabase dashboard:
# Settings > Edge Functions > Secrets
```

#### Option B: Node.js Server (More Control)

**Pros**: Full control, better logging, easier to test locally
**Cons**: Need to host and manage server

```bash
cd server
npm install
npm run build
# Deploy to your hosting platform
```

---

### Step 3: Configure Scheduler

Choose one:

**A. GitHub Actions (Free, Reliable)**
- Create `.github/workflows/send-note-reminders.yml`
- Runs every minute with cron syntax
- Works with any backend

**B. EasyCron (Free)**
- Set webhook to your function/server endpoint
- Simple setup, reliable

**C. Upstash Cron (Free tier)**
- Managed cron service
- Integrates with serverless functions

**D. Cloud Provider Scheduler**
- AWS CloudWatch Events
- Google Cloud Scheduler
- Azure Timer Triggers

See SETUP_GUIDE.md for detailed configuration for each option.

---

### Step 4: Frontend Integration

#### 4.1 Update Frontend to Sync with Supabase

Modify your `UNREAD1.html` to sync notes with database:

```javascript
// Add to appData()
async syncNotesToSupabase() {
    // Sync localStorage notes to Supabase when user authenticates
    const response = await fetch(`${SUPABASE_URL}/rest/v1/notes`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${sessionToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            user_id: this.user.id,
            title: note.title,
            body: note.body,
            category: this.mapCategoryToDb(note.category),
            unlock_at: note.unlockDate,
            unlock_mood: note.unlockMood,
            is_locked: note.isLocked,
            is_read: note.isRead,
            is_pinned: note.isPinned
        })
    });
    
    if (response.ok) {
        // Update localStorage to mark as synced
        note.syncedToSupabase = true;
    }
},

mapCategoryToDb(category) {
    return {
        'Future Date': 'time',
        'Mood-Based': 'mood',
        'Achievement / Event': 'achievement',
        'Reflection': 'reflection'
    }[category] || category;
}
```

#### 4.2 Create User Accounts in Database

When user completes onboarding:

```javascript
async completeOnboarding() {
    this.user.name = this.tempName;
    
    // Create user in Supabase
    const response = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
            name: this.user.name,
            email: this.user.email,
            email_verified: false // Set to true after email verification
        })
    });
    
    if (response.ok) {
        this.user.id = (await response.json())[0].id;
        this.saveUser();
        this.view = 'home';
    }
}
```

#### 4.3 Sign-In Flow with Email Verification

```javascript
async signInWithEmail(email) {
    // In your sign-in section:
    
    // 1. Query for existing user
    const userResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/users?email=eq.${email}`,
        {
            headers: {
                'apikey': SUPABASE_ANON_KEY
            }
        }
    );
    
    const users = await userResponse.json();
    
    if (users.length === 0) {
        // Create new user
        await fetch(`${SUPABASE_URL}/rest/v1/users`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                name: email.split('@')[0],
                email_verified: false
            })
        });
    }
    
    // 2. Send verification email (implement using resend SDK)
    // This would be done server-side in production
    
    // 3. Mark email as verified after user clicks link
    // (update email_verified = true in database)
}
```

---

### Step 5: Test the System

#### 5.1 Create Test Data

In Supabase SQL Editor:

```sql
-- Create test user
insert into public.users (email, name, email_verified)
values ('test@example.com', 'Test User', true);

-- Create test note with unlock time in the past
insert into public.notes (
  user_id,
  title,
  body,
  category,
  unlock_at,
  is_locked,
  email_sent
) select
  u.id,
  'Test Note',
  'This is a test note body',
  'time',
  now() - interval '1 hour',
  true,
  false
from public.users u
where u.email = 'test@example.com'
limit 1;
```

#### 5.2 Manually Trigger Reminder Job

```bash
# For Supabase Edge Function
curl -X POST \
  https://your-project.supabase.co/functions/v1/send-note-reminders \
  -H "Authorization: Bearer your_cron_secret" \
  -H "Content-Type: application/json"

# For Node.js server
curl -X POST \
  http://localhost:3001/send-reminders \
  -H "Authorization: Bearer your_cron_secret" \
  -H "Content-Type: application/json"
```

#### 5.3 Check Results

- Check email inbox for test email
- Query database to verify `email_sent` was updated:

```sql
select id, title, email_sent, updated_at 
from public.notes 
where category = 'time' and email_sent = true
order by updated_at desc;
```

- Check function logs:

```bash
# For Edge Functions
supabase functions logs send-note-reminders

# For Node.js
tail -f your-log-file.log
```

---

## Security Checklist

- [ ] SUPABASE_SERVICE_ROLE_KEY never exposed to frontend
- [ ] RESEND_API_KEY stored in environment variables only
- [ ] CRON_SECRET used to authorize scheduler requests
- [ ] Database RLS policies enabled for user isolation
- [ ] email_verified flag validated before sending emails
- [ ] FROM_EMAIL verified in Resend dashboard
- [ ] Rate limiting configured
- [ ] Error logs don't expose sensitive data
- [ ] HTTPS enforced in production
- [ ] API keys rotated regularly

---

## Monitoring

### What to Monitor

1. **Email Delivery**
   - Check Resend dashboard for bounces/failures
   - Monitor success rate in logs

2. **Database Health**
   - Monitor query performance
   - Check for orphaned records

3. **Scheduler Health**
   - Ensure cron job runs every minute
   - Alert on failures
   - Track execution time

4. **Error Tracking**
   - Log all errors
   - Set up alerts for critical failures
   - Monitor API rate limits

### Logging Example

```bash
# Tail logs in real-time
supabase functions logs send-note-reminders --tail

# Or for Node.js
pm2 logs reminder-service
```

---

## Scaling

### As Volume Grows

1. **1-100 emails/day**: Current setup is fine
2. **100-1000 emails/day**: Monitor but still fine
3. **1000-10000 emails/day**: Consider:
   - Batch processing
   - Queue system (Bull, RabbitMQ)
   - Separate read/write database
4. **10000+ emails/day**: 
   - Dedicated email service
   - Distributed processing
   - Advanced queuing

### Optimization

```javascript
// Batch process instead of one-by-one
async function sendRemindersBatch() {
    const notes = await getReadyNotes();
    
    // Process in parallel batches
    const batchSize = 10;
    for (let i = 0; i < notes.length; i += batchSize) {
        const batch = notes.slice(i, i + batchSize);
        await Promise.all(batch.map(note => sendReminder(note)));
    }
}
```

---

## Troubleshooting

### Problem: Notes not unlocking at the right time

**Solution**: 
1. Check server time matches UTC
2. Verify `unlock_at` timestamps are correct
3. Ensure cron job runs every minute

### Problem: Emails going to spam

**Solution**:
1. Verify SPF/DKIM/DMARC records in Resend
2. Use consistent FROM_EMAIL
3. Keep unsubscribe rates low

### Problem: Database connection errors

**Solution**:
1. Check SERVICE_ROLE_KEY is correct
2. Verify network connectivity
3. Check Supabase status page

### Problem: Duplicate emails

**Solution**:
1. Ensure email_sent flag updates immediately after send
2. Add retry logic only for network failures
3. Lock mechanism for multiple instances

See SETUP_GUIDE.md and server/README.md for more troubleshooting.

---

## Support Resources

- **Supabase**: https://supabase.com/docs
- **Resend**: https://resend.com/docs
- **Edge Functions**: https://supabase.com/docs/guides/functions
- **Node.js**: https://nodejs.org/docs

---

## Next Steps

1. Choose backend (Edge Functions or Node.js)
2. Complete setup from SETUP_GUIDE.md
3. Set up scheduler
4. Update frontend
5. Test with sample data
6. Monitor in production
7. Optimize as needed

---

**Last Updated**: February 19, 2026
**Version**: 1.0
