# Email Reminder System - Security & Best Practices

## 🔐 Security Architecture

### Threat Model

| Threat | Impact | Mitigation |
|--------|--------|-----------|
| API key exposure | Complete system compromise | Environment variables, no hardcoding |
| Unauthorized access to send emails | Spam/phishing | CRON_SECRET validation, IP allowlisting |
| Duplicate email sends | Email flood (spam complaint) | Database email_sent flag, atomic updates |
| Unauthorized database access | User data breach | RLS policies, service role key security |
| Email injection | Email spoofing | Input sanitization, HTML escaping |
| Rate limit exceeded | Service disruption | Monitor Resend limits, batch processing |
| Timing attacks | Guessing valid tokens | Use constant-time comparisons |

---

## 🔑 API Key Management

### ✅ DO:

- Store API keys in environment variables
- Use different keys for dev/staging/production
- Rotate keys every 90 days
- Use minimum required permissions
- Store in Supabase Secrets (not config files)

### ❌ DON'T:

- Hardcode keys in source code
- Commit `.env` files to git
- Share keys via email or unencrypted channels
- Reuse keys across environments
- Expose keys in logs

### Implementation

**Backend (server-side only):**
```typescript
// ✅ CORRECT
const resendKey = Deno.env.get("RESEND_API_KEY");

// ❌ WRONG
const resendKey = "re_abc123..."; // Never hardcode!
```

**Frontend (.env only):**
```javascript
// ✅ CORRECT (safe public keys only)
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ❌ WRONG (never expose service role key)
const SERVICE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
```

---

## 🔐 Database Security

### Row Level Security (RLS)

Enable RLS on all tables:

```sql
-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- Only users can see their own data
CREATE POLICY "users_can_read_own_data" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_can_read_own_notes" ON public.notes
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own notes
CREATE POLICY "users_can_insert_notes" ON public.notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
```

**Edge Function Access:**
- Uses SERVICE_ROLE_KEY (bypasses RLS)
- Can read all users/notes to find ones ready to send
- CRITICAL: Never expose this key!

### Indexes for Performance

```sql
-- Speed up lookups
CREATE INDEX idx_notes_ready ON public.notes(category, email_sent, unlock_at)
  WHERE category = 'time' AND email_sent = false;

CREATE INDEX idx_users_verified ON public.users(email_verified);
CREATE INDEX idx_notes_user_id ON public.notes(user_id);
```

---

## 🔐 Scheduler Security

### CRON_SECRET

Protects your reminder endpoint from unauthorized triggers:

```typescript
// ✅ CORRECT
const authHeader = req.headers.get("authorization");
const token = Deno.env.get("CRON_SECRET");
if (authHeader !== `Bearer ${token}`) {
  return new Response("Unauthorized", { status: 401 });
}

// ❌ WRONG (no protection)
// Anyone can call your function and spam emails!
```

### Generate Strong CRON_SECRET

```bash
# 32 bytes of random data = 256-bit security
openssl rand -base64 32

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Result: something like "N8vK9p2Q4r7sT1wXyZ3aB5cD6eF7gH8j+I9kL0mN1oP2="
```

### Scheduler Protection

**GitHub Actions:**
```yaml
- run: curl -X POST https://function-url \
    -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

**EasyCron/Upstash:**
Add request header: `Authorization: Bearer your_cron_secret`

**Self-Hosted:**
```bash
# Verify header in logs
curl -X POST http://localhost:3001/send-reminders \
  -H "Authorization: Bearer your_cron_secret"
```

---

## 📧 Email Security

### Resend Configuration

1. **Verify Sender Domain**
   - Resend Dashboard > Domains
   - Add SPF record: `v=spf1 include:resend.com ~all`
   - Add DKIM record: (provided by Resend)
   - Add DMARC record: `v=DMARC1; p=reject; rua=mailto:admin@domain.com`

2. **Add Verified From Address**
   ```
   noreply@yourdomain.com  // ✅ Verified
   onboarding@resend.dev   // ❌ Trial (emails show "via resend.dev")
   ```

3. **Monitor Bounce Rates**
   - Resend Dashboard > Analytics
   - Keep bounce rate < 2%
   - Remove bounced addresses from future sends

### Email Content Security

**HTML Escaping:**
```typescript
// ✅ CORRECT - escapes HTML special characters
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

const html = `<p>Hi ${escapeHtml(userName)}</p>`;

// ❌ WRONG - could allow HTML injection
const html = `<p>Hi ${userName}</p>`; // If userName has <script>, it runs!
```

**Never Trust User Input:**
```typescript
// Sanitize note titles, usernames, etc.
const title = escapeHtml(note.title);
const name = escapeHtml(user.name);
const html = `<p>Hi ${name}, your note "${title}" is ready</p>`;
```

---

## 🛡️ Rate Limiting

### Resend Limits

| Plan | Emails/month | Emails/second |
|------|--------------|---------------|
| Free | 100 | ~0.003 |
| Hobby | 5,000 | ~0.17 |
| Pro | 100,000+ | ~3.3 |

**Monitor:**
```bash
# Check current usage
curl https://api.resend.com/emails \
  -H 'Authorization: Bearer re_your_key' \
  -H 'Content-Type: application/json' \
  | jq '.object | length'
```

**Prevent Rate Limits:**
1. Batch process (10 emails at a time)
2. Process every 5 minutes instead of every minute
3. Upgrade Resend plan
4. Implement queue (Bull, RabbitMQ)

### Application Rate Limiting

Limit manual trigger endpoint:

```typescript
// ✅ CORRECT - prevent abuse
const lastCall = new Map<string, number>();

function rateLimit(clientId: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const lastTime = lastCall.get(clientId) || 0;
  
  if (now - lastTime < (60000 / maxPerMinute)) {
    return false; // Rate limited
  }
  
  lastCall.set(clientId, now);
  return true;
}

// Allow only 1 call per minute per client
if (!rateLimit(req.ip, 1)) {
  return res.status(429).json({ error: "Too many requests" });
}
```

---

## 📝 Logging & Monitoring

### What to Log

```typescript
// ✅ GOOD - helpful debugging without exposing secrets
console.log(`Processing ${readyNotes.length} notes`);
console.log(`Successfully sent email for note ${note.id}`);
console.error(`Failed to send email: ${error.message}`);

// ❌ BAD - exposes sensitive data
console.log(`Sending email to ${user.email} with key ${resendKey}`);
console.log(JSON.stringify(emailPayload)); // Might include sensitive data
```

### Structured Logging

```typescript
// Use structured logging for better analysis
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  action: string;
  noteId?: string;
  userId?: string;
  message: string;
  errorCode?: string;
}

const log = (entry: LogEntry) => {
  console.log(JSON.stringify(entry));
};

log({
  timestamp: new Date().toISOString(),
  level: 'info',
  action: 'email_sent',
  noteId: note.id,
  userId: note.user_id,
  message: 'Email reminder sent successfully'
});
```

### Sentry Integration (Error Tracking)

```typescript
import * as Sentry from "@sentry/deno";

Sentry.init({
  dsn: Deno.env.get("SENTRY_DSN"),
  environment: Deno.env.get("ENVIRONMENT") || "production"
});

try {
  await sendReminders();
} catch (error) {
  Sentry.captureException(error);
  throw error;
}
```

---

## 🔄 Data Integrity

### Idempotency

Ensure emails are sent exactly once:

```typescript
// ✅ CORRECT - atomic operation
async function sendAndMark(note: Note): Promise<boolean> {
  // 1. Send email
  const result = await resend.emails.send(emailData);
  
  if (!result.data) {
    // Send failed - don't mark as sent
    return false;
  }
  
  // 2. Mark as sent (only if send succeeded)
  const { error } = await supabase
    .from('notes')
    .update({ email_sent: true })
    .eq('id', note.id);
  
  return !error;
}

// ❌ WRONG - could send twice if update fails
await send(email);        // Success
await markSent(note);     // Fails? Email sent but flag not updated
// Next run finds email_sent=false and sends again!
```

### Backup & Recovery

```sql
-- In case of accidental resets:
-- Create backup of sent emails
CREATE TABLE email_sent_log (
  id UUID PRIMARY KEY,
  note_id UUID REFERENCES notes(id),
  sent_at TIMESTAMP DEFAULT now(),
  recipient_email TEXT,
  message_id TEXT
);

-- Log before marking sent
INSERT INTO email_sent_log (note_id, recipient_email, message_id)
VALUES (note.id, user.email, resendResponse.id);

-- If needed, recover from backup
UPDATE notes 
SET email_sent = true 
WHERE id IN (SELECT note_id FROM email_sent_log);
```

---

## 🚨 Error Handling

### Don't Expose Errors

```typescript
// ✅ CORRECT - generic response
try {
  await sendEmail();
} catch (error) {
  console.error('Email send failed:', error); // Log details
  return { success: false, message: 'Failed to send email' }; // Generic response
}

// ❌ WRONG - exposes sensitive info
return { 
  success: false, 
  message: error.message, // Might include API keys!
  stack: error.stack       // Reveals system paths
};
```

### Recovery Strategy

```typescript
async function sendWithRetry(note: Note, maxRetries = 3): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await resend.emails.send(emailData);
      if (result.data) {
        await markSent(note);
        return true;
      }
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed:`, error.message);
      if (attempt < maxRetries - 1) {
        // Exponential backoff
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }
  
  // Give up after retries
  logFailedSend(note);
  return false;
}
```

---

## 🔄 Deployment Security

### Environment Separation

```bash
# .env.development (local, not committed)
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=eyJ...local

# .env.staging (different project)
SUPABASE_URL=https://staging.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...staging

# .env.production (most secure)
SUPABASE_URL=https://prod.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...production (rotate often!)
```

### CI/CD Security

**GitHub Secrets:**
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
CRON_SECRET
SENTRY_DSN
```

**Never in git:**
```
.env
.env.local
.env.*.local
dist/
node_modules/
```

**.gitignore:**
```
# Environment
.env
.env.*.local

# Dependencies
node_modules/
pnpm-lock.yaml

# Build
dist/
build/

# Logs
*.log
logs/
```

---

## 📊 Compliance

### Data Retention

```sql
-- Archive old deleted notes
DELETE FROM notes
WHERE deleted_at < now() - interval '90 days'
  AND category != 'time';  -- Keep time-based permanently

-- Or archive to separate table
INSERT INTO notes_archive 
SELECT * FROM notes 
WHERE deleted_at < now() - interval '90 days';

DELETE FROM notes 
WHERE id IN (SELECT id FROM notes_archive);
```

### GDPR Compliance

Allow users to request data export and deletion:

```sql
-- Export user data
SELECT * FROM public.users WHERE id = $1;
SELECT * FROM public.notes WHERE user_id = $1;

-- Delete all user data
DELETE FROM public.notes WHERE user_id = $1;
DELETE FROM public.users WHERE id = $1;
```

### Privacy Policy

Add to your Privacy Policy:
- "We send email reminders when notes are ready to open"
- "Emails are sent via Resend"
- "We never share email addresses with third parties"
- "You can unsubscribe from reminders in settings"

---

## 🔍 Security Testing

### Manual Testing

```bash
# Test with intentionally malicious input
curl -X POST https://function \
  -H "Authorization: Bearer valid_token" \
  -H "Content-Type: application/json" \
  -d '{
    "userName": "<script>alert(1)</script>",
    "noteTitle": "../../etc/passwd"
  }'

# Should return escaped content, not execute script
```

### Automated Testing

```typescript
// Test that user input is properly escaped
describe('Email Generation', () => {
  it('should escape HTML in user names', () => {
    const html = generateEmailHtml('<script>alert(1)</script>', 'Title');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should escape HTML in note titles', () => {
    const html = generateEmailHtml('User', '<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror=');
  });
});
```

---

## ✅ Pre-Launch Checklist

- [ ] All API keys in env variables, never hardcoded
- [ ] CRON_SECRET protecting endpoint
- [ ] RLS policies enabled on database tables
- [ ] Email domain verified in Resend
- [ ] Service role key never exposed to frontend
- [ ] Error messages don't leak sensitive data
- [ ] Logging captures important events
- [ ] Rate limits understood and monitored
- [ ] Backup strategy documented
- [ ] Disaster recovery plan in place
- [ ] Privacy policy updated
- [ ] GDPR/compliance requirements met
- [ ] Security testing completed
- [ ] Key rotation schedule established

---

## 📞 Security Contacts

- **Report Supabase security issue**: security@supabase.io
- **Report Resend issue**: security@resend.com
- **Report app issue**: security@returned-to-sender.com

---

**Last Updated**: February 19, 2026  
**Version**: 1.0
