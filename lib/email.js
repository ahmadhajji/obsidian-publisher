/**
 * Email notification module - Send emails for feedback and other events
 */

const nodemailer = require('nodemailer');

// Admin email to receive notifications
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ahmad2003.hajji@gmail.com';

// SMTP configuration (using Gmail with App Password recommended)
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER; // Your Gmail address
const SMTP_PASS = process.env.SMTP_PASS; // Gmail App Password (not your regular password)

// Create transporter
let transporter = null;

function getTransporter() {
    if (!transporter && SMTP_USER && SMTP_PASS) {
        transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_PORT === 465,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
            }
        });
    }
    return transporter;
}

/**
 * Check if email notifications are configured
 */
function isEmailConfigured() {
    return Boolean(SMTP_USER && SMTP_PASS);
}

/**
 * Send feedback notification email to admin
 */
async function sendFeedbackNotification(feedback) {
    const transport = getTransporter();
    if (!transport) {
        console.log('📧 Email not configured, skipping notification');
        return false;
    }

    try {
        const typeEmoji = {
            'error': '🐛',
            'suggestion': '💡',
            'content': '📝',
            'bug': '🔧',
            'other': '💬'
        };

        const emoji = typeEmoji[feedback.type] || '📬';
        
        await transport.sendMail({
            from: `"Clinical Vault" <${SMTP_USER}>`,
            to: ADMIN_EMAIL,
            subject: `${emoji} New Feedback: ${feedback.type}`,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #7c3aed; margin-bottom: 20px;">New Feedback Received</h2>
                    
                    <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                        <p style="margin: 0 0 10px 0;"><strong>Type:</strong> ${feedback.type}</p>
                        <p style="margin: 0 0 10px 0;"><strong>From:</strong> ${feedback.email || 'Anonymous'}</p>
                        <p style="margin: 0;"><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                    </div>
                    
                    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px;">
                        <h3 style="margin: 0 0 15px 0; color: #333;">Message:</h3>
                        <p style="margin: 0; white-space: pre-wrap; color: #555; line-height: 1.6;">${feedback.message}</p>
                    </div>
                    
                    <p style="color: #888; font-size: 12px; margin-top: 20px;">
                        This notification was sent from Clinical Vault. 
                        <a href="${process.env.BASE_URL || 'http://localhost:3000'}" style="color: #7c3aed;">View Admin Panel</a>
                    </p>
                </div>
            `,
            text: `
New Feedback Received

Type: ${feedback.type}
From: ${feedback.email || 'Anonymous'}
Date: ${new Date().toLocaleString()}

Message:
${feedback.message}

---
View in Admin Panel: ${process.env.BASE_URL || 'http://localhost:3000'}
            `
        });

        console.log(`📧 Feedback notification sent to ${ADMIN_EMAIL}`);
        return true;
    } catch (error) {
        console.error('Failed to send feedback notification:', error);
        return false;
    }
}

module.exports = {
    sendFeedbackNotification,
    isEmailConfigured,
    ADMIN_EMAIL
};
