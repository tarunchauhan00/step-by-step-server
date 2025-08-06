// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const axios = require('axios');

// Load environment variables
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  GMAIL_USER,
  GMAIL_PASS,
  WASENDER_URL,
  WASENDER_TOKEN
} = process.env;

// Debug: log loaded env vars (mask sensitive parts)
console.log('ENV · CLIENT_ID:', CLIENT_ID ? 'loaded' : 'MISSING');
console.log('ENV · CLIENT_SECRET:', CLIENT_SECRET ? 'loaded' : 'MISSING');
console.log('ENV · REDIRECT_URI:', REDIRECT_URI ? 'loaded' : 'MISSING');
console.log('ENV · GMAIL_USER:', GMAIL_USER ? GMAIL_USER.split('@')[0] + '@…' : 'MISSING');
console.log('ENV · GMAIL_PASS:', GMAIL_PASS ? 'loaded' : 'MISSING');
console.log('ENV · WASENDER_URL:', WASENDER_URL ? WASENDER_URL : 'MISSING');
console.log('ENV · WASENDER_TOKEN:', WASENDER_TOKEN ? 'loaded' : 'MISSING');

const app = express();
app.use(express.json());
app.use(cors());

// 1) HOME ROUTE
app.get('/', (req, res) => {
  res.send(`
    <h1>Google Forms + Gmail Demo</h1>
    <p>1) <a href="/auth">Sign in with Google</a>.</p>
    <p>2) POST <code>/createForm</code> to create a Google Form.</p>
    <p>3) POST <code>/sendEmail</code> to send an email.</p>
    <p>4) POST <code>/sendWhatsApp</code> via WasenderApi.</p>
  `);
});

// 2) AUTH FORMS
app.get('/auth', (req, res) => {
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  const scopes = [
    'https://www.googleapis.com/auth/forms.body',
    'https://www.googleapis.com/auth/drive'
  ];
  const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: scopes });
  res.redirect(url);
});

// 3) AUTH CALLBACK
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided');

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    // Encode token and redirect to React app (port 3000)
    const encoded = encodeURIComponent(JSON.stringify(tokens));
    return res.redirect(`http://localhost:3000/?googleToken=${encoded}`);
  } catch (err) {
    console.error('Error exchanging code:', err);
    return res.status(500).send('Error exchanging code');
  }
});


// 4) CREATE FORM
app.post('/createForm', async (req, res) => {
  const { token: tokenStr, title, ownerEmails } = req.body;
  if (!tokenStr || !title) return res.status(400).send('Missing token or title');
  let token;
  try { token = JSON.parse(tokenStr); } catch { return res.status(400).send('Invalid token'); }

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2Client.setCredentials(token);

  try {
    const forms = google.forms({ version: 'v1', auth: oauth2Client });
    const createResp = await forms.forms.create({ requestBody: { info: { title, documentTitle: `Form for ${title}` }}});
    const formId = createResp.data.formId;
    const editUrl = `https://docs.google.com/forms/d/${formId}/edit`;

    if (Array.isArray(ownerEmails)) {
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      for (const email of ownerEmails) {
        await drive.permissions.create({ fileId: formId, requestBody: { role: 'writer', type: 'user', emailAddress: email }});
      }
    }
    res.json({ formId, editUrl });
  } catch (err) {
    console.error('Error creating form:', err);
    res.status(500).send('Error creating form');
  }
});

// 5) SEND EMAIL
app.post('/sendEmail', async (req, res) => {
  const { emailTo, emailMessage } = req.body;
  if (!emailTo || !emailMessage) return res.status(400).json({ error: 'Missing emailTo or emailMessage' });
  if (!GMAIL_USER || !GMAIL_PASS) return res.status(500).json({ error: 'Email credentials missing' });
  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_PASS }});
    const info = await transporter.sendMail({ from: GMAIL_USER, to: emailTo, subject: 'FMS Message', text: emailMessage });
    res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error('Error sending email:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// 6) SEND WHATSAPP VIA WASENDER
app.post('/sendWhatsApp', async (req, res) => {
  if (!WASENDER_URL || !WASENDER_TOKEN) return res.status(500).json({ error: 'WasenderApi credentials missing' });
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'Missing to or message' });

  try {
    const payload = { to, text: message };
    const headers = { 'Authorization': `Bearer ${WASENDER_TOKEN}`, 'Content-Type': 'application/json' };
    const apiRes = await axios.post(WASENDER_URL, payload, { headers });
    res.json({ success: true, data: apiRes.data });
  } catch (err) {
    console.error('WasenderApi error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to send WhatsApp message' });
  }
});

// Start the server
const PORT = process.env.PORT || 8888;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
