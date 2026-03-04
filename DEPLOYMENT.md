# Firebase Deployment & Security Guide

## Overview

This guide covers deploying your Returned To Sender app to Firebase with proper security rules and database indexes.

## Files

- **`firebase.json`** - Firebase configuration for functions, Firestore, and hosting
- **`firestore.rules`** - Security rules that protect user data
- **`firestore.indexes.json`** - Composite indexes for efficient queries
- **`functions/`** - Cloud Functions directory

## Deployment Steps

### 1. Install Firebase CLI (if not already installed)

```bash
npm install -g firebase-tools
```

### 2. Initialize Firebase (if needed)

```bash
firebase init
```

When prompted, select:
- ✓ Firestore
- ✓ Functions
- ✓ Hosting

### 3. Login to Firebase

```bash
firebase login
```

### 4. Set Project ID

```bash
firebase use --add
# Follow prompts to select your Firebase project
```

### 5. Deploy Everything

```bash
firebase deploy
```

Or deploy specific services:

```bash
# Deploy only functions
firebase deploy --only functions

# Deploy only Firestore rules
firebase deploy --only firestore:rules

# Deploy only Firestore indexes
firebase deploy --only firestore:indexes

# Deploy only hosting
firebase deploy --only hosting
```

### 6. Verify Deployment

Check the Firebase Console:
- **Firestore Database** → Rules tab (verify rules are applied)
- **Firestore Database** → Indexes tab (wait for indexes to build)
- **Cloud Functions** → Functions list (check function status)

---

## Security Rules Explained

### Notes Collection
```firestore
match /notes/{noteId} {
  allow read, write: if request.auth != null 
    && request.auth.uid == resource.data.userId;
}
```
- Users can only **read/write** notes they created
- The `userId` field must match their authentication UID
- Prevents unauthorized access to other users' notes

### Moods Collection
Same protection - users can only access their own mood logs.

### Reflections Collection
Same protection - users can only access their own reflections.

### Private Journal
Same protection - users can only access their own journal entries.

### Default Deny
```firestore
match /{document=**} {
  allow read, write: if false;
}
```
- Everything else is denied by default
- Most secure approach

---

## Firestore Indexes

Composite indexes are created for efficient queries:

1. **Notes by User + Unlock Date + Locked Status**
   - Used by `checkUnlocks()` function to find ready notes

2. **Notes by User + Unlock Date (Descending)**
   - For showing upcoming unlocks to users

3. **Unlock Date + Locked Status**
   - For the scheduled function to find notes across all users

---

## Testing Security Rules

### With Firebase Emulator (Local Testing)

```bash
firebase emulators:start
```

Then in your app, connect to the emulator:

```javascript
// In Firebase initialization
const db = getFirestore();
connectFirestoreEmulator(db, 'localhost', 8080);
```

### Test Cases to Try

1. **Logged in user** - should read/write own notes ✓
2. **Different user** - should NOT see other users' notes ✗
3. **Not logged in** - should NOT see any notes ✗
4. **Invalid UID** - should NOT create notes with wrong userId ✗

---

## Monitoring

### View Logs

```bash
firebase functions:log

# Or tail logs in real-time
firebase functions:log --limit=50 --follow
```

### Check Function Executions

In Firebase Console:
- **Cloud Functions** → Select function → **Executions** tab

### Monitor Firestore Usage

In Firebase Console:
- **Firestore Database** → **Usage** tab
- Check read/write counts and database size

---

## Production Checklist

Before going live:

- [ ] Firebase project created and project ID configured
- [ ] Authentication enabled (Email/Password or Google Sign-In)
- [ ] Firestore database created
- [ ] Security rules deployed
- [ ] Indexes built successfully
- [ ] Functions deployed and tested
- [ ] Email credentials configured for functions
- [ ] Custom domain configured (if using Hosting)
- [ ] CORS headers verified in functions (if needed)
- [ ] Error tracking enabled (Firebase Crashlytics optional)
- [ ] Backups enabled in Firebase Console

---

## Troubleshooting

### "Permission denied" errors in app

- Check Firestore rules - ensure `userId` field is set when creating documents
- Verify user is authenticated: `firebase.auth().currentUser`
- Check browser console for auth state

### Functions not running

- Verify Node.js version: `node --version` (should be 18+)
- Check function logs: `firebase functions:log`
- Verify environment variables: `firebase functions:config:get`

### Indexes still building

- Large collections take time to index
- You can still query in the meantime, but it may be slow
- Check status in Firebase Console

### Deploy failures

- Run `firebase --version` to check CLI is up to date
- Clear cache: `firebase cache:clear`
- Login again: `firebase login`

---

## Alternative Email Services

If not using Gmail, update `functions/index.js`:

### SendGrid
```javascript
const transporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  auth: {
    user: 'apikey',
    pass: process.env.SENDGRID_API_KEY,
  },
});
```

### Mailgun
```javascript
const transporter = nodemailer.createTransport({
  host: 'smtp.mailgun.org',
  port: 587,
  auth: {
    user: process.env.MAILGUN_USER,
    pass: process.env.MAILGUN_PASSWORD,
  },
});
```

Then update your Firebase config:
```bash
firebase functions:config:set email.service="sendgrid" email.key="your-api-key"
```

---

## Support

For issues:
- Check [Firebase Documentation](https://firebase.google.com/docs)
- Review [Cloud Functions Guide](https://firebase.google.com/docs/functions)
- Check [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/start)
