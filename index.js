const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are Crown Decode™, an AI-powered ingredient analysis tool built by Ms. April of Studio HME — a professional cosmetologist with 30+ years of experience. You analyze hair product ingredient lists using the Three Pass Method. This tool is for all hair types — straight, wavy, curly, and coily — and all textures.

When analyzing ingredients, speak to what the product does for hair in general first. Where a concern or benefit is specific to a hair type (for example, drying alcohols being more problematic for dry or porous hair, or heavy occlusives being better suited for coarse hair than fine hair), name the hair type clearly so the person can apply it to their own situation.

The user will tell you the product type. Use it to run a performance analysis specific to that product category:
- Shampoo / Cleanser: evaluate cleansing strength, stripping risk, scalp suitability, lather type
- Conditioner / Detangler: evaluate slip, softness, moisture delivery, detangling ability
- Styling Product (gel, mousse, cream, custard): evaluate hold strength, cast type (hard/soft/none), whether hair will feel crunchy or soft to touch, curl definition potential, buildup risk
- Leave-in / Moisturizer: evaluate moisture vs. sealing balance, layering compatibility, absorption
- Treatment / Mask: evaluate protein vs. moisture balance, penetration potential, frequency suitability
- Oil / Serum: evaluate whether oil penetrates or seals, buildup risk, best use in routine

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
      "moisture": [],
      "softening": [],
      "slip": [],
      "hold": [],
      "sealing": []
    },
    "verdict": "1-2 sentences: what this product is actually built to DO for hair"
  },
  "performance": {
    "headline": "One sentence: what using this product will actually feel like",
    "expectations": ["2-3 specific observable outcomes the user will notice — what hair will feel like, behave like, or look like after use"],
    "verdict": "2-3 sentences in Ms. April's voice on real-world performance of this specific product type"
  },
  "pass3": {
    "dryingAlcohols": {
      "found": [],
      "position": "high or mid or low or none",
      "whatItIs": "1 plain sentence",
      "whatItMeansForYourHair": "1-2 plain sentences — name specific hair types where relevant",
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
   - Aloe (Aloe Barbadensis Leaf Juice, aloe juice, aloe gel) is moisture — list it in moisture only, never in slip
- Always populate all fields — never omit a key`;

// Route 1: Extract ingredients from one or more photos of the label.
// Accepts { images: [{ imageBase64, mediaType }, ...] } (up to 4), or the
// older single-photo shape { imageBase64, mediaType }.
const MAX_PHOTOS = 4;

function buildExtractPrompt(count) {
  if (count === 1) {
    return `Look at this image carefully.

First, assess the readability of any ingredient list visible:
- CLEAR: text is sharp, flat, fully legible
- PARTIAL: some text readable but portions are blurry, cut off, or obscured
- UNCLEAR: too blurry, dark, curved, or small to read reliably

Then respond in this exact JSON format only — no other text:
{
  "readability": "CLEAR" or "PARTIAL" or "UNCLEAR",
  "ingredients": "the full ingredient list exactly as written, or empty string if unreadable",
  "issue": "if PARTIAL or UNCLEAR, one plain sentence describing the specific problem"
}`;
  }
  return `These ${count} photos all show the SAME hair product label. The bottle is curved, so the person turned it a little between shots. Each photo shows a different slice of the same ingredient list, and neighboring photos overlap.

Your job: rebuild the ONE complete ingredient list, in the order it appears on the label.
- Read every photo. Use the overlapping words to line the slices up, the way you would line up torn pieces of a page.
- Ingredient lists usually wrap across several lines. Follow each line across all photos before moving to the next line.
- Include each ingredient once. Do not repeat ingredients that appear in two photos because of the overlap.
- Do not guess or invent ingredients. If a word is cut off or blurry in every photo, leave it out and say so in "issue".
- Ignore everything that is not the ingredient list (directions, warnings, marketing copy).

Assess readability of the combined result:
- CLEAR: the whole list was captured and every ingredient is legible
- PARTIAL: most of the list was captured, but some part is missing, blurry, or cut off
- UNCLEAR: the list could not be read reliably

Respond in this exact JSON format only — no other text:
{
  "readability": "CLEAR" or "PARTIAL" or "UNCLEAR",
  "ingredients": "the full merged ingredient list, comma-separated, in label order, or empty string if unreadable",
  "issue": "if PARTIAL or UNCLEAR, one plain sentence saying what is missing and which edge of the bottle to photograph again"
}`;
}

app.post('/api/extract-image', async (req, res) => {
  let images = Array.isArray(req.body.images) ? req.body.images : [];
  if (!images.length && req.body.imageBase64) {
    images = [{ imageBase64: req.body.imageBase64, mediaType: req.body.mediaType }];
  }
  images = images.filter(img => img && img.imageBase64).slice(0, MAX_PHOTOS);
  if (!images.length) return res.status(400).json({ error: 'No image provided.' });

  const content = [];
  images.forEach((img, i) => {
    if (images.length > 1) content.push({ type: 'text', text: `Photo ${i + 1} of ${images.length}:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.imageBase64 }
    });
  });
  content.push({ type: 'text', text: buildExtractPrompt(images.length) });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content }]
      })
    });

    const data = await response.json();
    if (data.error) {
      return res.status(500).json({ error: data.error.message || 'API error reading image.' });
    }

    const rawText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '';
       const clean = rawText.slice(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { return res.status(500).json({ error: 'Could not process the image response.' }); }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route 2: Run Three Pass analysis
app.post('/api/analyze', async (req, res) => {
  const { ingredients, productType } = req.body;
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
        model: 'claude-sonnet-5-5',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Product type: ${productType || 'Hair Product'}\n\nAnalyze these ingredients using the Three Pass Method:\n\n${ingredients}`
        }]
      })
    });

    const data = await response.json();
    if (data.error) {
      return res.status(500).json({ error: data.error.message || 'API error during analysis.' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Crown Decode running on port ${PORT}`));
