# Email Reminder System - Quick Reference

## 🚀 Quick Start (5 minutes)

### 1. Get Your API Keys

```
Supabase URL: https://your-project.supabase.co
Service Role Key: Get from Settings > API > service_role (KEEP SECRET)
Anon Key: Get from Settings > API > anon (safe for frontend)
Resend API Key: Get from https://resend.com/api-keys
```

### 2. Set Environment Variables

Create `.env` file in project root:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
RESEND_API_KEY=re_your_api_key_here
CRON_SECRET=generate_a_random_string_here
```

### 3. Deploy to Supabase

```bash
# Install Supabase CLI
npm install -g @supabase/cli

# Login
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Push database migrations
supabase db push

# Deploy Edge Function
supabase functions deploy send-note-reminders
```

### 4. Set Function Secrets

In Supabase Dashboard:
- Go to Functions > send-note-reminders
- Click Secrets
- Add:
  - `RESEND_API_KEY` = re_...
  - `CRON_SECRET` = your_secret_token

### 5. Set Up Cron Job

Choose one:

**GitHub Actions** (free, recommended):
```yaml
# .github/workflows/send-note-reminders.yml
name: Send Note Reminders
on:
  schedule:
    - cron: '*/1 * * * *'
jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - run: curl -X POST \
          https://your-project.supabase.co/functions/v1/send-note-reminders \
          -H "Authorization: Bearer $CRON_SECRET"
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

**Or EasyCron**:
1. Go to https://www.easycron.com
2. Create job: `https://your-project.supabase.co/functions/v1/send-note-reminders`
3. Add header: `Authorization: Bearer your_cron_secret`

### 6. Test

Create test data in Supabase SQL Editor:

```sql
-- Create test user
insert into public.users (email, name, email_verified)
values ('your-email@example.com', 'Test', true);

-- Create test note with unlock time in past
insert into public.notes (
  user_id, title, body, category, unlock_at, is_locked, email_sent
) select id, 'Test', 'Test body', 'time', now() - interval '1 hour', true, false
from public.users where email = 'your-email@example.com';
```

Manually trigger:
```bash
curl -X POST \
  https://your-project.supabase.co/functions/v1/send-note-reminders \
  -H "Authorization: Bearer your_cron_secret"
```

Check your email inbox!

---

## 📊 Database Schema Summary

```sql
-- USERS TABLE
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  email_verified BOOLEAN DEFAULT false
);

-- NOTES TABLE  
CREATE TABLE notes (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  title TEXT,
  body TEXT,
  category TEXT ('time', 'mood', 'achievement', 'reflection'),
  unlock_at TIMESTAMP,
  unlock_mood TEXT,
  is_locked BOOLEAN,
  is_read BOOLEAN,
  is_pinned BOOLEAN,
  email_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP
);
```

---

## 🔄 How It Works

1. **Every minute**, the cron job triggers the edge function
2. **Query** finds notes where:
   - `category = 'time'`
   - `email_sent = false`
   - `unlock_at <= now()`
   - `user.email_verified = true`
3. **For each note**, send email via Resend
4. **Update** `email_sent = true` if successful
5. **Log** results and errors

---

## 🔑 Environment Variables

| Variable | Where | Type | Required |
|----------|-------|------|----------|
| SUPABASE_URL | Supabase Dashboard > API | URL | ✅ |
| SUPABASE_SERVICE_ROLE_KEY | Supabase Dashboard > API | Secret | ✅ |
| RESEND_API_KEY | Resend Dashboard > API Keys | Secret | ✅ |
| CRON_SECRET | Generate yourself | Secret | ✅ |
| VITE_SUPABASE_URL | Frontend .env | URL | (Frontend only) |
| VITE_SUPABASE_ANON_KEY | Frontend .env | Key | (Frontend only) |

---

## 🐛 Common Issues & Fixes

| Problem | Solution |
|---------|----------|
| "RESEND_API_KEY not found" | Add to Supabase > Functions > Secrets |
| "Unauthorized" from cron | Check CRON_SECRET matches |
| Emails not sending | Verify FROM_EMAIL in Resend, user email_verified=true |
| No one receives emails | Check Resend API key and domain verification |
| Database connection error | Verify SERVICE_ROLE_KEY and SUPABASE_URL correct |
| Duplicate emails | Check that email_sent updates after send |
| Function timeout | Reduce batch size or increase timeout |

---

## 📧 Email Template

Default email sent to users:

```
Subject: Your note on Returned To Sender is ready to open

Hi [User Name],

A note you wrote titled:
"[Note Title]"

is now ready to open.

Visit Returned To Sender to read your message and unlock what 
your past self wanted to tell you.

[Open Your Note Button]

Write now. Open later.
```

Customize in Edge Function `generateEmailHtml()` function.

---

## 🚄 Node.js Alternative

Instead of Edge Functions, use Node.js:

```bash
cd server
npm install
npm run dev
```

Includes built-in Express server and node-cron scheduler. See `server/README.md`.

---

## 📈 Monitoring

### Edge Function Logs
```bash
supabase functions logs send-note-reminders --tail
```

### Database Queries
```sql
-- Check emails sent
select count(*) from notes where email_sent = true;

-- See failed sends (email_sent still false)
select * from notes where category='time' and email_sent=false 
  and unlock_at < now();

-- Recent activity
select * from notes order by updated_at desc limit 10;
```

### Resend Dashboard
- https://resend.com/emails
- View sent/failed/bounced emails
- Check delivery rates

---

## 🔒 Security Checklist

- [ ] Never expose SUPABASE_SERVICE_ROLE_KEY to frontend
- [ ] Never expose RESEND_API_KEY to frontend  
- [ ] Use CRON_SECRET to authorize scheduler
- [ ] Verify FROM_EMAIL in Resend
- [ ] Enable RLS policies on database
- [ ] Use HTTPS in production
- [ ] Rotate keys regularly
- [ ] Don't log sensitive data
- [ ] Rate limit requests if needed

---

## 📚 Documentation

- **Full Setup**: See SETUP_GUIDE.md
- **Backend Details**: See server/README.md (if using Node.js)
- **Frontend Integration**: See IMPLEMENTATION.md

---

## 🎯 Success Criteria

You'll know it's working when:

✅ Cron job runs every minute (check logs)  
✅ Test email arrived in 1-2 minutes after unlock time  
✅ Database shows `email_sent = true` for sent notes  
✅ Emails have correct subject and user name  
✅ No duplicate emails sent  
✅ Failed sends don't cause errors  

---

## 📞 Support

- **Supabase Issues**: https://supabase.com/docs
- **Resend Issues**: https://resend.com/docs
- **Edge Functions**: https://supabase.com/docs/guides/functions
- **Database**: https://supabase.com/docs/guides/database

---

## 🔄 Deployment Platforms

| Platform | Setup | Cost | Recommendation |
|----------|-------|------|-----------------|
| Supabase Edge Functions | 10 min | Free (10k invokes/month) | ⭐ Best for quick setup |
| Node.js + GitHub Actions | 20 min | Free | ⭐ Good control + free |
| Node.js + Railway | 15 min | $5-10/month | Good balance |
| Node.js + Render | 15 min | Free tier available | Low cost |
| AWS Lambda | 30 min | Pay per invocation | Enterprise |

---

**Last Updated**: February 19, 2026  
**Next**: Check SETUP_GUIDE.md for detailed instructions
