# Production Deployment Checklist

This guide ensures your email reminder system is production-ready and secure.

---

## 📋 Pre-Deployment Phase (1-2 days before launch)

### 1. Infrastructure Setup

- [ ] Supabase project created and linked locally
- [ ] Database migrations executed successfully
- [ ] Tables created: `users`, `notes` with all columns
- [ ] RLS policies enabled on both tables
- [ ] Database backups enabled (Supabase → Settings → Backups)
- [ ] Supabase project linked to GitHub/CI-CD
- [ ] Resend account created
- [ ] Resend sender domain verified (SPF, DKIM, DMARC records added)
- [ ] Resend API key generated and stored in safe location

### 2. Secrets & Environment Variables

- [ ] Copy `.env.example` to `.env.production`
- [ ] Generate strong CRON_SECRET: `openssl rand -base64 32`
- [ ] Add to `.env.production`:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RESEND_API_KEY`
  - `CRON_SECRET`
  - `FROM_EMAIL`
  - All other required variables
- [ ] Add `.env` and `.env.production` to `.gitignore`
- [ ] Store `.env.production` in secure location (password manager, vault)
- [ ] Never commit `.env` with real values to git
- [ ] Add environment variables to deployment platform (GitHub Secrets, Railway, etc.)

### 3. Code Review & Testing

- [ ] All source code reviewed for hardcoded secrets
- [ ] No `console.log()` statements printing sensitive data
- [ ] Error handling doesn't expose API details
- [ ] Email template HTML is properly escaped
- [ ] Database queries use parameterized statements
- [ ] Test with intentional XSS payloads in user/note data
- [ ] Test with very long strings (>1000 chars)
- [ ] Test with special characters in names/titles
- [ ] Ran full test suite (if applicable)

### 4. Database Verification

```sql
-- Execute in Supabase SQL Editor

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- Check policies exist
SELECT * FROM pg_policies;

-- Check indexes exist
SELECT * FROM pg_indexes 
WHERE schemaname = 'public';

-- Verify no data in production yet
SELECT COUNT(*) FROM public.users;
SELECT COUNT(*) FROM public.notes;

-- Test query that reminder system will use
SELECT n.id, n.title, u.email, u.name, n.unlock_at
FROM public.notes n
JOIN public.users u ON n.user_id = u.id
WHERE n.category = 'time'
  AND n.email_sent = false
  AND n.unlock_at <= NOW()
  AND u.email_verified = true;
```

### 5. Capacity Planning

- [ ] Estimated users in first month: _____ (use for capacity planning)
- [ ] Estimated notes per user: _____
- [ ] Estimated emails per day: (users × notes × unlock_rate)
- [ ] Resend plan selected based on volume
- [ ] Supabase tier selected for database size
- [ ] Cron scheduler frequency appropriate (every 1 min vs 5 min)

---

## 🚀 Deployment Phase (Day of launch)

### 6. Backend Deployment

**If using Edge Functions:**
- [ ] Edge Function code pushed to `supabase/functions/send-note-reminders/`
- [ ] Environment variables set in Supabase Secrets dashboard
- [ ] Deploy: `supabase functions deploy send-note-reminders`
- [ ] Verify deployment: Check Supabase Dashboard > Functions
- [ ] Test endpoint: 
  ```bash
  curl -X POST https://your-project.supabase.co/functions/v1/send-note-reminders \
    -H "Authorization: Bearer your_anon_key" \
    -H "Content-Type: application/json"
  ```

**If using Node.js server:**
- [ ] Code pushed to deployment platform (GitHub, Railway, Render, etc.)
- [ ] Environment variables set in platform dashboard
- [ ] Build successful: `npm run build`
- [ ] Server starting: `npm start`
- [ ] Health check passing:
  ```bash
  curl https://your-server.com/health
  # Should return: {"status": "ok"}
  ```

### 7. Scheduler Deployment

**GitHub Actions (recommended):**
- [ ] `.github/workflows/send-reminders.yml` created
- [ ] Workflow references correct function/server URL
- [ ] CRON_SECRET set in GitHub Secrets
- [ ] Cron schedule: `'*/1 * * * *'` (every minute)
- [ ] Test workflow manual trigger works
- [ ] Check "Actions" tab to confirm workflow runs every minute

**Alternative (Upstash/EasyCron):**
- [ ] Account created and verified
- [ ] Cron job configured with correct URL
- [ ] Authorization header set to `Bearer {CRON_SECRET}`
- [ ] Test payload: POST, Content-Type: application/json
- [ ] Verify "next execution" time in dashboard

### 8. Frontend Integration

- [ ] Backend URL environment variable set
- [ ] User signup flow creates user in Supabase
- [ ] Note creation syncs to Supabase
- [ ] Time-based notes saved with `category: 'time'` and `unlock_at` timestamp
- [ ] Email verification flow implemented (or skip for MVP)
- [ ] Frontend receives user.email_verified flag
- [ ] UI shows email reminder status

### 9. Monitoring Setup

- [ ] Logging enabled (check Supabase/server logs)
- [ ] Error tracking configured (Sentry or similar)
- [ ] Email delivery monitoring enabled (Resend Dashboard)
- [ ] Database metrics viewed (Supabase Dashboard)
- [ ] Uptime monitoring enabled (Pingdom, UptimeRobot)
- [ ] Alert email configured for critical errors
- [ ] Slack integration for notifications (optional)

---

## ✅ Verification Phase (First 24 hours)

### 10. Smoke Tests

Create test data and verify system works:

```sql
-- Create test user
INSERT INTO public.users (id, email, name, email_verified)
VALUES ('test-user-123', 'your-email@example.com', 'Test User', true);

-- Create test note with past unlock time (should trigger immediately)
INSERT INTO public.notes (user_id, title, body, category, unlock_at, email_sent)
VALUES (
  'test-user-123',
  'Test Note Title',
  'Test note body',
  'time',
  NOW() - interval '5 minutes',  -- Past time = should send now
  false
);

-- Wait for next cron execution (max 1 minute)
-- Check Resend dashboard for email delivery
-- Check note: SELECT email_sent FROM public.notes WHERE id = '...';
-- Should be true
```

### 11. Real User Testing

- [ ] Invite 5-10 internal users
- [ ] Create notes with various unlock times
- [ ] Test with past unlock times (should email immediately)
- [ ] Test with future unlock times (should wait)
- [ ] Verify emails arrive in inbox (not spam)
- [ ] Check email formatting looks correct
- [ ] Verify email contains user name and note title
- [ ] Test with special characters in names/titles

### 12. Performance Monitoring

In first 24 hours:
- [ ] Check cron execution logs
- [ ] Note: Average execution time should be < 5 seconds
- [ ] Monitor: Resend email delivery rate (should be 99%+)
- [ ] Monitor: Database response times (should be < 100ms)
- [ ] Monitor: Email bounce rate (should be 0% with verified users)
- [ ] Check: No duplicate emails sent
- [ ] Check: No emails spam-marked

---

## 🔐 Security Verification Phase

### 13. Security Testing

- [ ] CRON_SECRET cannot be bypassed:
  ```bash
  # Should return 401 Unauthorized
  curl -X POST https://function-url
  
  # Should return 401 Unauthorized
  curl -X POST https://function-url \
    -H "Authorization: Bearer wrong_secret"
  ```

- [ ] Service role key not exposed in frontend (check browser Network tab)
- [ ] HTML escaping works:
  ```sql
  -- Insert malicious test data
  UPDATE public.users 
  SET name = '<script>alert(1)</script>'
  WHERE id = 'test-user-123';
  
  -- Email should not execute script
  ```

- [ ] RLS prevents unauthorized access:
  ```javascript
  // Frontend with anon key should NOT see other users' notes
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .neq('user_id', currentUser.id);
  
  // Should return error or empty result
  ```

- [ ] Error messages don't leak secrets:
  ```bash
  # Trigger error, check response doesn't include API keys
  curl -X POST https://function-url
  ```

### 14. Data Privacy Verification

- [ ] User data is encrypted at rest (Supabase default)
- [ ] Connections use HTTPS (all Supabase URLs are HTTPS)
- [ ] No sensitive data in logs beyond note IDs
- [ ] Backup strategy documented and tested
- [ ] User deletion doesn't break system
- [ ] GDPR compliance initial testing passed

---

## 📊 Runbook Phase (Day 1 onwards)

### 15. Runbook & Alerts

Create monitoring runbook:

```markdown
## Monitoring Runbook

### Daily Checks (every morning)
- [ ] Check Supabase Dashboard for error logs
- [ ] Check Resend Dashboard for bounce rate
- [ ] Check function/server status page

### Alert: High bounce rate (>5%)
1. Check Resend details for bounce reasons
2. Remove bounced emails from future sends
3. Consider email list verification

### Alert: Cron not executing
1. Check cron scheduler status (GitHub Actions, Upstash, etc.)
2. Check function/server logs for recent execution
3. Manually trigger: curl -X POST with CRON_SECRET
4. If still failing: page on-call engineer

### Alert: Duplicate emails sent
1. Check database: should have email_sent=true
2. Check logs for concurrent execution
3. Review Resend message IDs for duplicates
4. Consider adding deduplication logic

### Weekly Checks (every Friday)
- [ ] Review cost: Supabase usage, Resend costs
- [ ] Check: Any unread error logs
- [ ] Verify: email_sent flag is working (sample query)
```

### 16. Runbook Testing

- [ ] Run through runbook with team
- [ ] Practice manual cron trigger
- [ ] Practice reading logs
- [ ] Practice responding to alerts
- [ ] Verify escalation procedures

---

## 📈 Post-Deployment Phase (Week 1)

### 17. Metrics & Analytics

Track first week:
- [ ] Total users added: _____
- [ ] Total notes created: _____
- [ ] Total emails sent: _____
- [ ] Email delivery rate: _____%
- [ ] Email bounce rate: _____%
- [ ] Average response time: _____ ms
- [ ] Error rate: _____%
- [ ] User satisfaction: _____ (if surveyed)

### 18. User Feedback

- [ ] Collect feedback from test users
- [ ] Document any issues
- [ ] Track: email timing accuracy
- [ ] Track: email spam/not spam ratio
- [ ] Track: feature requests
- [ ] Update documentation based on feedback

### 19. Cost Analysis

First week costs:
- Supabase: $___
- Resend: $___
- Hosting (if Node.js): $___
- Domain/DNS: $___
- Total: $___

Adjust plan if needed:
- [ ] Supabase tier appropriate for data size
- [ ] Resend plan covers email volume
- [ ] No unexpected costs

### 20. Production Hardening

After successful first week:
- [ ] Implement advanced monitoring (Sentry, DataDog, etc.)
- [ ] Set up automated backups (if not already)
- [ ] Implement Redis caching (if performance needed)
- [ ] Add database connection pooling (if scaling)
- [ ] Implement queue system (Bull, RabbitMQ) for high volume
- [ ] Set up alerting for all critical metrics
- [ ] Implement graceful shutdown for deployments
- [ ] Add metrics/instrumentation for debugging

---

## 🔄 Ongoing Maintenance

### Weekly
- [ ] Review logs and metrics
- [ ] Check Resend bounce/complaint rate
- [ ] Verify cron execution (should see recent runs)
- [ ] Update documentation if needed

### Monthly
- [ ] Review costs and capacity
- [ ] Test disaster recovery (restore from backup)
- [ ] Rotate API keys (or plan rotation)
- [ ] Review security notifications
- [ ] Check Supabase/Resend for updates

### Quarterly
- [ ] Rotate CRON_SECRET
- [ ] Rotate SUPABASE_SERVICE_ROLE_KEY
- [ ] Review and update security policies
- [ ] Conduct security audit
- [ ] Review and update runbook
- [ ] Plan capacity for next quarter

### Annually
- [ ] Full security audit
- [ ] Performance optimization review
- [ ] Architecture review and upgrades
- [ ] Cost optimization review
- [ ] Compliance certification renewal

---

## 🆘 Troubleshooting Quick Links

| Problem | Solution |
|---------|----------|
| Emails not sending | Check Supabase logs, verify Resend key, test manual trigger |
| High bounce rate | Check email addresses, verify domain records, review bounces in Resend |
| Duplicate emails | Check concurrent cron execution, verify email_sent flag logic |
| Cron not running | Check scheduler status, verify CRON_SECRET, check logs |
| Slow performance | Check database indexes, monitor query times, consider caching |
| Users not created | Check signup flow, verify Supabase connection, check RLS policies |

See [QUICK_REFERENCE.md](QUICK_REFERENCE.md#common-issues) for more solutions.

---

## ✨ Success Criteria

Your system is production-ready when:

1. ✅ Emails arrive within 1 minute of unlock time
2. ✅ Email delivery rate is 99%+
3. ✅ No duplicate emails sent to same user
4. ✅ Email content is properly formatted with user/note data
5. ✅ All errors are logged without exposing secrets
6. ✅ System gracefully handles edge cases (malformed data, network errors)
7. ✅ Database remains responsive under load
8. ✅ Security review passed (RLS, secrets, escaping)
9. ✅ Monitoring alerts configured and tested
10. ✅ Team trained on runbook and incident response

---

**Last Updated**: February 19, 2026  
**Version**: 1.0

Questions? See [QUICK_REFERENCE.md](QUICK_REFERENCE.md) or [IMPLEMENTATION.md](IMPLEMENTATION.md)
