const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: send email via Resend HTTP API directly (no SDK)
async function sendVerificationEmail(toEmail, verifyUrl) {
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Crown Decode <onboarding@resend.dev>';
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #fafaf8; color: #1a1a1a; margin: 0; padding: 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 32px;">
    <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 12px 0;">One more step.</h1>
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px 0; color: #495057;">
      Click the button below to confirm your email and unlock unlimited Crown Decode analyses.
    </p>
    <p style="margin: 16px 0;">
      <a href="${verifyUrl}" style="display: inline-block; background: #1a1a1a; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">
        Confirm my email
      </a>
    </p>
    <p style="font-size: 12px; color: #868e96; line-height: 1.5; margin: 16px 0;">
      Or copy and paste this link into your browser:<br>
      <span style="word-break: break-all;">${verifyUrl}</span>
    </p>
    <div style="font-size: 12px; color: #868e96; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e8e8e8; line-height: 1.6;">
      This link expires in 24 hours. If you didn't request this, you can ignore this email — nothing will happen.<br><br>
      — Ms. April<br>Studio HME
    </div>
  </div>
</body>
</html>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: fromEmail,
      to: toEmail,
      subject: 'Unlock Crown Decode — confirm your email',
      html
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `Resend API returned ${response.status}`);
  }
  return await response.json();
}

// Helper: add an email to Mailchimp with the crown-decode tag
async function addToMailchimp(email) {
  const dc = process.env.MAILCHIMP_DC;
  const apiKey = process.env.MAILCHIMP_API_KEY;
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;
  const auth = 'Basic ' + Buffer.from('anystring:' + apiKey).toString('base64');

  const url = `https://${dc}.api.mailchimp.com/3.0/lists/${audienceId}/members`;
  const body = {
    email_address: email,
    status: 'subscribed',
    tags: ['crown-decode']
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (response.ok) return { ok: true, existing: false };

  const errData = await response.json();
  // Already a member? Just add the crown-decode tag to them.
  if (errData.title === 'Member Exists') {
    const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
    const tagsUrl = `https://${dc}.api.mailchimp.com/3.0/lists/${audienceId}/members/${subscriberHash}/tags`;
    const tagResponse = await fetch(tagsUrl, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [{ name: 'crown-decode', status: 'active' }] })
    });
    if (!tagResponse.ok) {
      const tagErr = await tagResponse.json();
      throw new Error(tagErr.detail || 'Failed to tag existing member');
    }
    return { ok: true, existing: true };
  }
  throw new Error(errData.detail || 'Failed to add to Mailchimp');
}

const SYSTEM_PROMPT = `You are Crown Decode™, an AI-powered ingredient analysis tool built by Ms. April of Studio HME — a professional cosmetologist with 30+ years of experience. You analyze hair product ingredient lists using the Three Pass Method. This tool is for all hair types — straight, wavy, curly, and coily — and all textures.

When analyzing ingredients, speak to what the product does for hair in general first. Where a concern or benefit is specific to a hair type (for example, drying alcohols being more problematic for dry or porous hair, or heavy occlusives being better suited for coarse hair than fine hair), name the hair type clearly so the person can apply it to their own situation.

VOICE RULES — follow these without exception:
- Write the way a knowledgeable cosmetologist talks to a client she respects. Plain. Direct. Warm but no-nonsense.
- Use real words only. Never invent compound words or blended terms.
- No literary or dramatic language. No words like "mercy," "grace," "testament," "revelation," "ironically," or "notably."
- No filler phrases. Do not say "it's worth noting," "keep in mind," or "at the end of the day."
- Short sentences. If a sentence can be cut in half, cut it.
- When something is a concern, say what it is and what it means for hair. No dramatic framing.
- Do not use the words: folks, queen, queens, sacred, journey, empower, holistic, transformative.

Return ONLY valid JSON — no markdown fences, no preamble, nothing outside the JSON object.

{
  "pass1": {
    "headline": "One sentence: what this product IS based on the first 5 ingredients",
    "top5": ["ing1","ing2","ing3","ing4","ing5"],
    "dominantType": "one of: water-based | occlusive | drying-risk | butter-heavy | silicone-forward | mixed",
    "moistureCheck": { "pass": true, "note": "brief explanation of moisture source situation" },
    "verdict": "1-2 sentences in Ms. April's voice about what this product fundamentally is"
  },
  "pass2": {
    "categories": {
      "moisture": ["Glycerin, Propanediol, Sorbitol, Sodium PCA, Panthenol, Aloe, Honey, Agave if found"],
      "softening": ["Cetyl Alcohol, Cetearyl Alcohol, Behenyl Alcohol if found — NOTE: these are GOOD alcohols"],
      "slip": ["Behentrimonium Methosulfate BTMS, Cetrimonium Chloride, Polyquaternium-10 or -11 if found"],
      "hold": ["PVP, VP/VA Copolymer, Carbomer, Acrylates Copolymer, Xanthan Gum if found"],
      "sealing": ["Shea Butter, Castor Oil, Jojoba Oil, other butters/oils, silicones used for sealing/shine"]
    },
    "verdict": "1-2 sentences: what this product is actually built to DO for hair"
  },
  "pass3": {
    "dryingAlcohols": {
      "found": [],
      "position": "high or mid or low or none",
      "whatItIs": "1 plain sentence",
      "whatItMeansForYourHair": "1-2 plain sentences",
      "whatToWatch": "1-2 sentences",
      "context": "1-2 sentences"
    },
    "heavyOcclusives": {
      "found": [],
      "whatItIs": "1 plain sentence",
      "whatItMeansForYourHair": "1-2 sentences",
      "whatToWatch": "1-2 sentences",
      "context": "1-2 sentences"
    },
    "proteins": {
      "found": [],
      "position": "high or mid or low or none",
      "whatItIs": "1 plain sentence",
      "whatItMeansForYourHair": "1-2 sentences",
      "whatToWatch": "1-2 sentences",
      "context": "1-2 sentences"
    },
    "fragrance": {
      "found": [],
      "whatItIs": "1 sentence",
      "whatItMeansForYourHair": "1-2 sentences",
      "whatToWatch": "1-2 sentences",
      "context": "1 sentence"
    },
    "harmful": {
      "found": [],
      "whatItIs": "1 plain sentence",
      "whatItMeansForYourHair": "1-2 sentences",
      "whatToWatch": "1 sentence",
      "context": "1 sentence"
    },
    "marketingDust": {
      "preservative": "",
      "dustIngredients": [],
      "verdict": "plain-talk on whether marketing dust was detected"
    },
    "silicones": {
      "waterSoluble": [],
      "nonSoluble": [],
      "evaporating": [],
      "verdict": "brief verdict on silicone situation"
    },
    "redFlagCount": 0,
    "verdict": "1-2 sentences: Ms. April's plain-talk summary of Pass 3"
  },
  "final": {
    "label": "5-10 word label for what this product is and does",
    "strengths": [],
    "watchOuts": [],
    "bestFor": "specific description of who and what hair needs this suits",
    "putItBack": false,
    "putItBackReason": "",
    "msAprilSays": "Ms. April's final 2-3 sentence verdict"
  }
}

Rules:
- If input is clearly not a hair product ingredient list: {"error": "Paste a real ingredient list from a hair product label."}
- Empty array [] for any category where nothing was found
- redFlagCount = number of these five categories that have at least one found item: dryingAlcohols, heavyOcclusives, proteins, fragrance, harmful
- putItBack = true ONLY if: drying alcohols are high on list with no conditioning counterbalance, OR DMDM Hydantoin is present, OR product claims moisture but has no water/oil/butter in first 3 ingredients
- Fatty alcohols (Cetyl, Cetearyl, Behenyl) are NOT drying — list them in softening only, never in dryingAlcohols
- Always populate all fields — never omit a key`;

// Route 1: Extract ingredients from a photo
app.post('/api/extract-image', async (req, res) => {
  const { imageBase64, mediaType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType || 'image/jpeg',
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: 'This is a photo of a hair product label. Please read and return ONLY the ingredient list exactly as written on the label — nothing else. No commentary, no formatting, just the raw ingredient list text. If you cannot read the ingredients clearly, return only the word: UNCLEAR'
            }
          ]
        }]
      })
    });

    const data = await response.json();
    const extracted = data.content?.[0]?.text || '';
    res.json({ ingredients: extracted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route 2: Run Three Pass analysis on ingredient text
app.post('/api/analyze', async (req, res) => {
  const { ingredients } = req.body;
  if (!ingredients) return res.status(400).json({ error: 'No ingredients provided.' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Analyze these hair product ingredients using the Three Pass Method:\n\n${ingredients}`
        }]
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route 3 (NEW): Send the magic-link verification email
app.post('/api/send-verification', async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const token = jwt.sign(
      { email: email.toLowerCase() },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    const verifyUrl = `${process.env.BASE_URL}/verify?token=${token}`;
    await sendVerificationEmail(email, verifyUrl);

    res.json({ success: true });
  } catch (err) {
    console.error('Verification email error:', err);
    res.status(500).json({ error: 'Could not send verification email. Please try again.' });
  }
});

// Route 4 (NEW): Handle the magic link click
app.get('/verify', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(verificationErrorPage('Missing verification token. Please request a new link.'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const email = decoded.email;
    await addToMailchimp(email);
    res.send(verificationSuccessPage(email));
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(400).send(verificationErrorPage('This link has expired. Please request a new one.'));
    }
    console.error('Verification error:', err);
    res.status(400).send(verificationErrorPage('This verification link is not valid. Please request a new one.'));
  }
});

function verificationSuccessPage(email) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Crown Decode™ — You're In</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafaf8; color: #1a1a1a; padding: 1.5rem 1rem; margin: 0; }
    .wrap { max-width: 520px; margin: 4rem auto; text-align: center; }
    .card { background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 2.5rem 1.5rem; }
    .check { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px 0; }
    p { font-size: 14px; line-height: 1.6; color: #495057; margin: 0 0 1rem 0; }
    .button { display: inline-block; background: #1a1a1a; color: #fff !important; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="check">✓</div>
      <h1>You're in.</h1>
      <p>Your email has been verified. Crown Decode is unlocked for unlimited analyses.</p>
      <p style="color: #868e96; font-size: 13px;">Watch your inbox over the next two weeks — Ms. April has a five-email series coming with the framework behind every decode.</p>
      <a href="/" class="button">Decode another product</a>
    </div>
  </div>
  <script>
    try { localStorage.setItem('crownDecode_verified', 'true'); } catch(e) {}
  </script>
</body>
</html>`;
}

function verificationErrorPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Crown Decode™ — Verification Issue</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafaf8; color: #1a1a1a; padding: 1.5rem 1rem; margin: 0; }
    .wrap { max-width: 520px; margin: 4rem auto; text-align: center; }
    .card { background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 2.5rem 1.5rem; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px 0; }
    p { font-size: 14px; line-height: 1.6; color: #495057; margin: 0 0 1rem 0; }
    .button { display: inline-block; background: #1a1a1a; color: #fff !important; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="icon">⚠</div>
      <h1>That didn't work.</h1>
      <p>${message}</p>
      <a href="/" class="button">Back to Crown Decode</a>
    </div>
  </div>
</body>
</html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Crown Decode running on port ${PORT}`));
