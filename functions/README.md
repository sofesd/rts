# Firebase Functions - Returned To Sender

This directory contains Cloud Functions that power the backend of Returned To Sender.

## Functions

### `checkUnlocks`
- **Type:** Scheduled (Pub/Sub)
- **Schedule:** Every 24 hours
- **Purpose:** Finds notes with future unlock dates that are ready to open and sends email notifications to users, then marks them as unlocked in Firestore.

### `manualCheckUnlocks`
- **Type:** HTTP Endpoint
- **Purpose:** Manually trigger the unlock check (useful for testing). Requires authentication token.

## Setup

### 1. Install Dependencies
```bash
cd functions
npm install
```

### 2. Configure Environment Variables

Set up Firebase Functions config:

```bash
firebase functions:config:set email.user="your-email@gmail.com" email.password="your-app-password"
```

Or create a `.env.local` file for local testing (not committed to git):

```
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
```

### 3. Email Configuration

The functions use Nodemailer with Gmail. To set up:

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate an App Password:**
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Windows Computer" (or your device)
   - Copy the 16-character password
3. **Set it in Firebase Functions config:**
   ```bash
   firebase functions:config:set email.password="your-16-char-app-password"
   ```

Or use another email service by modifying the `nodemailer.createTransport()` config.

## Deployment

Deploy functions to Firebase:

```bash
firebase deploy --only functions
```

Deploy a specific function:

```bash
firebase deploy --only functions:checkUnlocks
```

## Testing Locally

```bash
npm run serve
```

This starts the Firebase emulator suite. You can test HTTP functions at `http://localhost:5001/[project-id]/[region]/manualCheckUnlocks`

## Manually Trigger Check

Send an authenticated request:

```bash
curl -X POST "https://[region]-[project-id].cloudfunctions.net/manualCheckUnlocks?token=[id-token]"
```

Or from your browser console (when logged in):

```javascript
const token = await firebase.auth().currentUser.getIdToken();
fetch(`https://[region]-[project-id].cloudfunctions.net/manualCheckUnlocks?token=${token}`)
  .then(r => r.json())
  .then(console.log);
```

## Monitoring

View function logs:

```bash
firebase functions:log
```

Or in Firebase Console → Functions → Logs

## Notes

- The scheduled function runs in UTC timezone
- Email template can be customized in the `mailOptions.html`
- Consider adding error handling and retry logic for production
- Test email delivery before going live
