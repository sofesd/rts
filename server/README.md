# Email Reminder System - Node.js Backend Alternative

This directory contains an alternative Node.js implementation of the email reminder service for Returned To Sender. Use this instead of Supabase Edge Functions if you prefer a traditional Node.js backend.

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Supabase project set up with database
- Resend API key

### Setup

```bash
# Install dependencies
cd server
npm install

# Configure environment
cp ../.env.example .env
# Edit .env with your credentials

# Start development server
npm run dev

# Build for production
npm run build

# Run production server
npm start
```

## Architecture

### Components

1. **Express Server**: REST API for triggering reminders and health checks
2. **Cron Scheduler**: Runs `sendNoteReminders()` every minute using `node-cron`
3. **Supabase Client**: Queries database for notes and updates status
4. **Resend Client**: Sends emails via Resend API

### Data Flow

```
┌─────────────────────┐
│   Every Minute      │
│   (node-cron)       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  Query Supabase for Ready Notes     │
│  - category = 'time'                │
│  - email_sent = false               │
│  - unlock_at <= now                 │
│  - user.email_verified = true       │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  For Each Note:                     │
│  1. Generate email HTML             │
│  2. Send via Resend API             │
│  3. Update email_sent = true        │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  Log Results & Errors               │
│  Monitored via console/logs         │
└─────────────────────────────────────┘
```

## Configuration

### Environment Variables

```bash
# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Email
RESEND_API_KEY=re_your_api_key

# Security
CRON_SECRET=your_secure_token

# Server
PORT=3001
NODE_ENV=development
```

### Required Supabase Setup

The server expects these tables in your Supabase database:

**users table**
```sql
create table public.users (
  id uuid primary key,
  email text unique not null,
  name text not null,
  email_verified boolean default false
);
```

**notes table**
```sql
create table public.notes (
  id uuid primary key,
  user_id uuid references public.users(id),
  title text not null,
  body text not null,
  category text not null,
  unlock_at timestamp with time zone,
  email_sent boolean default false
);
```

See `../SETUP_GUIDE.md` for full database schema.

## API Endpoints

### Health Check

```bash
GET /health

Response:
{
  "status": "ok",
  "timestamp": "2026-02-19T10:30:00.000Z"
}
```

### Manual Trigger (for testing)

```bash
POST /send-reminders
Authorization: Bearer YOUR_CRON_SECRET
Content-Type: application/json

Response:
{
  "success": true,
  "timestamp": "2026-02-19T10:30:00.000Z",
  "notesProcessed": 5,
  "successCount": 4,
  "failureCount": 1
}
```

## Deployment Options

### Option 1: Self-Hosted (VPS/Dedicated Server)

```bash
# Build
npm run build

# Run with PM2 for process management
npm install -g pm2
pm2 start dist/reminder-service.js --name "rts-reminder"
pm2 save
pm2 startup

# Set up with Nginx reverse proxy
# See: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
```

### Option 2: Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/reminder-service.js"]
```

Build and run:

```bash
docker build -t rts-reminder:latest .
docker run -d \
  --name rts-reminder \
  -p 3001:3001 \
  -e SUPABASE_URL=$SUPABASE_URL \
  -e SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
  -e RESEND_API_KEY=$RESEND_API_KEY \
  -e CRON_SECRET=$CRON_SECRET \
  rts-reminder:latest
```

### Option 3: Railway/Render/Heroku

These platforms support Node.js natively. Just push the code and configure environment variables in the dashboard.

**Procfile** (for Heroku):

```
web: npm start
worker: npm start
```

### Option 4: AWS Lambda + RDS

Use AWS SAM or Serverless Framework to deploy as a Lambda function with scheduled CloudWatch Events.

## Monitoring & Logging

### Console Logs

The service outputs detailed logs to console:

```
Starting note reminder job...
Found 5 notes ready to send
Successfully sent reminder for note abc123 to user@example.com
Job completed: { successCount: 5, failureCount: 0 }
```

### Better Logging (Production)

For production, integrate with a logging service:

```javascript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Replace console.log with logger.info
logger.info('Starting note reminder job...');
```

### Error Tracking

Integrate with Sentry:

```javascript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN
});

Sentry.captureException(error);
```

## Performance & Scaling

### Single Instance

Works well for 1,000-10,000 emails per day. The cron job runs every minute and processes notes in parallel.

### Multiple Instances

For higher volume, run multiple instances behind a load balancer, but ensure only one instance runs the cron job:

```javascript
// Add locking mechanism
import Redis from 'redis';

const redis = Redis.createClient();

cron.schedule('* * * * *', async () => {
  const lock = await redis.get('reminder-job-running');
  if (lock) return; // Skip if already running
  
  await redis.setex('reminder-job-running', 65, Date.now());
  await sendNoteReminders();
  await redis.del('reminder-job-running');
});
```

### Rate Limiting

Resend API limits:
- **Free tier**: 100 emails/day
- **Paid**: Usually 10,000+ emails/day depending on plan

Check your Resend dashboard for limits and upgrade if needed.

## Troubleshooting

### Issue: "SUPABASE_SERVICE_ROLE_KEY not found"

**Solution**: Make sure `.env` file exists and is in the correct directory:

```bash
pwd  # Should be in server/ directory
ls -la .env  # Check if file exists
```

### Issue: "Cannot connect to Supabase"

**Troubleshooting**:
1. Verify SUPABASE_URL is correct (no trailing slash)
2. Check SERVICE_ROLE_KEY is valid
3. Ensure database tables exist:

```bash
curl "https://your-project.supabase.co/rest/v1/notes?limit=1" \
  -H "apikey: your-service-key"
```

### Issue: Emails not sending

**Checklist**:
- [ ] Resend API key is valid
- [ ] FROM_EMAIL is verified in Resend dashboard
- [ ] Test email manually:

```bash
curl https://api.resend.com/emails \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer re_your_key' \
  -d '{
    "from": "noreply@returned-to-sender.com",
    "to": "test@example.com",
    "subject": "Test",
    "html": "<p>Test</p>"
  }'
```

### Issue: Cron job not running

**Check**:
1. Is the server running? `npm run dev` or `npm start`
2. Check logs for errors
3. Verify system time is correct (important for cron)

### Issue: Duplicate emails

**Cause**: Database update failed after send
**Fix**: Check that email_sent flag is being updated. Add logging:

```javascript
const { error: updateError } = await supabase
  .from('notes')
  .update({ email_sent: true })
  .eq('id', note.id);

if (updateError) {
  console.error(`CRITICAL: Failed to update email_sent for ${note.id}`);
}
```

## Development

### Run Tests

```bash
npm test
```

### Local Database Testing

```bash
# Start Supabase locally
supabase start

# Connect to local: postgresql://postgres:postgres@localhost:54321/postgres

# Create test data
psql postgresql://postgres:postgres@localhost:54321/postgres < test-data.sql

# Run reminder job
npm run dev
```

### Debug Mode

```bash
DEBUG=supabase* npm run dev
```

## Contributing

1. Follow TypeScript strict mode
2. Add error handling for all async operations
3. Log important events
4. Test with both local and remote databases
5. Update SETUP_GUIDE.md if changing configuration

## Security

⚠️ **IMPORTANT**:

- Never commit `.env` or actual keys to git
- Use `.env.local` for local development (add to `.gitignore`)
- Rotate API keys regularly
- Use HTTPS in production
- Implement rate limiting
- Monitor logs for suspicious activity
- Keep dependencies updated

## License

MIT - See LICENSE file

---

**Support**: See SETUP_GUIDE.md for more details
**Last Updated**: February 19, 2026
