require('dotenv').config();
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Twilio setup
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

// ===== STEP 1: Lead aaya (99acres/MagicBricks/FB se) =====
// Yeh endpoint call hoga jab naya lead aayega
app.post('/new-lead', async (req, res) => {
  try {
    const { name, phone, source, project } = req.body;

    // Phone number format karo
    const toNumber = `whatsapp:+91${phone.replace(/\D/g, '').slice(-10)}`;

    // Personalized message banao
    const message = `Namaste ${name} ji! 🙏

Aapne *${project || 'hamare project'}* mein interest dikhaya — shukriya!

Main *NestAgent AI* hoon, aapki madad karne ke liye hamesha tayyar hoon. 😊

Kya aap chahenge ki hum aapko:
1️⃣ Project ki poori details bhejein
2️⃣ Site visit schedule karein
3️⃣ Current offers batayein

Bas reply karein: *1*, *2*, ya *3* 👇

_(Source: ${source || 'Website'})_`;

    // WhatsApp message bhejo
    await client.messages.create({
      from: FROM_NUMBER,
      to: toNumber,
      body: message
    });

    console.log(`✅ Lead contacted: ${name} (${phone})`);
    res.json({ success: true, message: `WhatsApp sent to ${name}` });

  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== STEP 2: Lead ne reply kiya =====
// Twilio is webhook ko call karega jab lead reply kare
app.post('/whatsapp-reply', (req, res) => {
  const body = req.body || {};
  const reply = (body.Body || '').trim();
  const From = body.From || '';
  const name = body.ProfileName || 'Aap';

  console.log(`📩 Reply from ${From}: ${reply}`);

  let responseMessage = '';

  if (reply === '1') {
    responseMessage = `Bilkul ${name} ji! 🏠

Yeh hain hamare project ki khaas baatein:
• 2BHK & 3BHK flats available
• Premium location
• Ready to move & under construction options
• EMI starting from ₹15,000/month

Kya aap site visit ke liye available hain? 📅`;

  } else if (reply === '2') {
    responseMessage = `Zaroor ${name} ji! 📅

Site visit ke liye yeh time slots available hain:
• Kal subah 10 AM - 12 PM
• Kal dopahar 2 PM - 5 PM  
• Parso subah 11 AM

Aapko kaunsa time suit karega?
Reply mein time batayein ya call karein: *+91-XXXXXXXXXX*`;

  } else if (reply === '3') {
    responseMessage = `🎉 Special Offers — Sirf Limited Time!

✅ Pre-launch price mein booking
✅ 0% brokerage
✅ Free modular kitchen (first 10 bookings)
✅ Flexible payment plan

*Abhi book karo — offer 7 din mein khatam!*

Site visit ke liye reply karein: *2* 👆`;

  } else {
    responseMessage = `Shukriya ${name} ji! 😊

Main samjha nahi — kripya yeh reply karein:
1️⃣ *1* — Project details chahiye
2️⃣ *2* — Site visit book karein
3️⃣ *3* — Special offers dekhein

Ya seedha call karein hamare team ko! 📞`;
  }

  // Twilio TwiML format mein reply
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage}</Message>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

// ===== Health check =====
app.get('/', (req, res) => {
  res.json({
    status: '🟢 NestAgent Backend Running',
    version: '1.0.0',
    agent: 'LeadWake Agent',
    time: new Date().toLocaleString('en-IN')
  });
});

// ===== Server start =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🚀 NestAgent Backend Started!
🌐 Port: ${PORT}
🤖 LeadWake Agent: Ready
📱 WhatsApp: Connected
  `);
});