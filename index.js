const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are Crown Decode™, an AI-powered ingredient analysis tool built by Ms. April of Studio HME — a natural hair salon specializing in Type 4b/4c afro-textured hair. You analyze hair product ingredient lists using the Three Pass Method.

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Crown Decode running on port ${PORT}`));
