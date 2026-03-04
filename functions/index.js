const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

const db = admin.firestore();

// Configure nodemailer (update with your email service)
// Example: Gmail with App Password
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // Set this in Firebase Functions config
    pass: process.env.EMAIL_PASSWORD, // Set this in Firebase Functions config
  },
});

/**
 * Scheduled function that checks every 24 hours for notes that should be unlocked
 * and sends email notifications to users
 */
exports.checkUnlocks = functions
  .pubsub.schedule("every 24 hours")
  .timeZone("UTC")
  .onRun(async (context) => {
    console.log("Running checkUnlocks at", new Date().toISOString());

    try {
      const now = new Date();

      // Find notes with future dates that are ready to unlock
      const snapshot = await db
        .collection("notes")
        .where("unlockDate", "<=", now)
        .where("isLocked", "==", true)
        .where("category", "==", "Future Date")
        .get();

      console.log(`Found ${snapshot.size} notes ready to unlock`);

      const promises = [];

      snapshot.forEach((doc) => {
        const note = doc.data();

        promises.push(
          (async () => {
            try {
              // Get user email
              const user = await admin.auth().getUser(note.userId);

              // Send email notification
              const mailOptions = {
                from: process.env.EMAIL_USER,
                to: user.email,
                subject: `✨ Your Note Is Ready: "${note.title}"`,
                html: `
                  <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #a855f7;">Your Future Self Left You a Message</h2>
                    <p>Hey ${user.displayName || "there"}!</p>
                    <p>A note you wrote on <strong>${new Date(note.createdAt).toLocaleDateString()}</strong> is now ready to read.</p>
                    
                    <div style="background: #f3f4f6; border-left: 4px solid #a855f7; padding: 15px; margin: 20px 0; border-radius: 4px;">
                      <p style="margin: 0; color: #666;"><strong>${note.title}</strong></p>
                    </div>
                    
                    <p>
                      <a href="https://returnedtosender.com" style="background: #a855f7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">
                        Read Your Note
                      </a>
                    </p>
                    
                    <p style="color: #999; font-size: 12px; margin-top: 30px;">
                      Returned To Sender • Write now. Open later.
                    </p>
                  </div>
                `,
              };

              await transporter.sendMail(mailOptions);
              console.log(`Email sent to ${user.email}`);

              // Mark note as unlocked in Firestore
              await doc.ref.update({
                isLocked: false,
                unlockedAt: admin.firestore.Timestamp.now(),
              });

              console.log(`Unlocked note: ${doc.id}`);
            } catch (error) {
              console.error(`Error processing note ${doc.id}:`, error);
            }
          })()
        );
      });

      await Promise.all(promises);
      console.log("checkUnlocks completed successfully");
      return null;
    } catch (error) {
      console.error("Error in checkUnlocks:", error);
      throw error;
    }
  });

/**
 * Optional: HTTP function to manually trigger unlock check (for testing)
 */
exports.manualCheckUnlocks = functions.https.onRequest(
  async (request, response) => {
    // Add security check - verify caller is authenticated
    const idToken = request.query.token || request.body.token;

    try {
      await admin.auth().verifyIdToken(idToken);
    } catch (error) {
      response.status(401).send("Unauthorized");
      return;
    }

    try {
      const now = new Date();

      const snapshot = await db
        .collection("notes")
        .where("unlockDate", "<=", now)
        .where("isLocked", "==", true)
        .where("category", "==", "Future Date")
        .get();

      let unlockedCount = 0;

      for (const doc of snapshot.docs) {
        const note = doc.data();

        try {
          const user = await admin.auth().getUser(note.userId);

          const mailOptions = {
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: `✨ Your Note Is Ready: "${note.title}"`,
            html: `
              <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #a855f7;">Your Future Self Left You a Message</h2>
                <p>Hey ${user.displayName || "there"}!</p>
                <p>A note you wrote on <strong>${new Date(note.createdAt).toLocaleDateString()}</strong> is now ready to read.</p>
                
                <div style="background: #f3f4f6; border-left: 4px solid #a855f7; padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <p style="margin: 0; color: #666;"><strong>${note.title}</strong></p>
                </div>
                
                <p>
                  <a href="https://returnedtosender.com" style="background: #a855f7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">
                    Read Your Note
                  </a>
                </p>
                
                <p style="color: #999; font-size: 12px; margin-top: 30px;">
                  Returned To Sender • Write now. Open later.
                </p>
              </div>
            `,
          };

          await transporter.sendMail(mailOptions);
          console.log(`Email sent to ${user.email}`);

          await doc.ref.update({
            isLocked: false,
            unlockedAt: admin.firestore.Timestamp.now(),
          });

          unlockedCount++;
        } catch (error) {
          console.error(`Error processing note ${doc.id}:`, error);
        }
      }

      response.json({
        success: true,
        message: `Checked and unlocked ${unlockedCount} notes`,
        count: unlockedCount,
      });
    } catch (error) {
      console.error("Error in manual check:", error);
      response.status(500).json({ error: error.message });
    }
  }
);
