/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Path to our persistent JSON database
const DB_FILE = path.join(process.cwd(), "db.json");

// Default resources if database is empty
const DEFAULT_RESOURCES = [
  {
    id: "1",
    name: "React.js Documentation",
    url: "https://react.dev",
    desc: "The library for web and native user interfaces. Master hooks, state, and server components of the modern era.",
    category: "DOCUMENTATION",
    tags: ["ULTRA-POPULAR", "MUST-KNOW", "DECLARATIVE", "FACEBOOK"],
    favorite: true,
    date: new Date().toISOString(),
    notes: "Essential guide for everyday development. Use of hooks is absolutely fundamental.",
  },
  {
    id: "2",
    name: "Tailwind CSS Arena",
    url: "https://tailwindcss.com",
    desc: "A utility-first CSS framework packed with classes like flex, pt-4, text-center and rotate-90 that can be composed to build any design.",
    category: "LIBRARIES",
    tags: ["NEON-STYLE", "UTILITY-FIRST", "RADICAL-SPEED", "RAPID-UI"],
    favorite: false,
    date: new Date().toISOString(),
    notes: "Makes styling incredibly quick and avoids long styled-components code block setups.",
  },
  {
    id: "3",
    name: "Lucide Cyber Icons",
    url: "https://lucide.dev",
    desc: "Beautiful & consistent icon toolkit made by the community. Lightweight, fast, and highly customizable SVGs.",
    category: "ASSETS",
    tags: ["CLEAN-VIBE", "VECTOR-GOD", "LIGHTWEIGHT", "CYBER-NET"],
    favorite: true,
    date: new Date().toISOString(),
    notes: "Best replacement for FontAwesome or Heroicons. Clean and simple layout.",
  },
];

// Read from JSON DB or write defaults if missing
function readDatabase() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_RESOURCES, null, 2), "utf-8");
      return DEFAULT_RESOURCES;
    }
    const data = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading database:", error);
    return DEFAULT_RESOURCES;
  }
}

// Write to JSON DB
function writeDatabase(data: any) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing to database:", error);
  }
}

// Lazy initialize Gemini SDK client to prevent startup crash if key is missing
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
      aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
  }
  return aiClient;
}

// ==================== API ENDPOINTS ====================

// GET: All resources
app.get("/api/resources", (req, res) => {
  const resources = readDatabase();
  res.json(resources);
});

// POST: Add new resource (using AI categorization or manual input)
app.post("/api/resources", (req, res) => {
  const { name, url, desc, category, tags, notes } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  const resources = readDatabase();
  const newResource = {
    id: Date.now().toString(),
    name: name || "Untitled Resource",
    url,
    desc: desc || "Auto-saved developer item.",
    category: (category || "TOOLS").toUpperCase(),
    tags: Array.isArray(tags) ? tags.map((t: string) => t.toUpperCase()) : ["GENERAL"],
    favorite: false,
    date: new Date().toISOString(),
    notes: notes || "",
  };

  resources.unshift(newResource);
  writeDatabase(resources);
  res.status(201).json(newResource);
});

// PUT: Toggle Favorite
app.put("/api/resources/:id/toggle-fav", (req, res) => {
  const { id } = req.params;
  const resources = readDatabase();
  const index = resources.findIndex((r: any) => r.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Resource not found" });
  }
  resources[index].favorite = !resources[index].favorite;
  writeDatabase(resources);
  res.json(resources[index]);
});

// PUT: Update resource details (like notes)
app.put("/api/resources/:id", (req, res) => {
  const { id } = req.params;
  const { notes, name, desc, category, tags } = req.body;
  const resources = readDatabase();
  const index = resources.findIndex((r: any) => r.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Resource not found" });
  }

  if (notes !== undefined) resources[index].notes = notes;
  if (name !== undefined) resources[index].name = name;
  if (desc !== undefined) resources[index].desc = desc;
  if (category !== undefined) resources[index].category = category.toUpperCase();
  if (tags !== undefined) resources[index].tags = Array.isArray(tags) ? tags.map((t: string) => t.toUpperCase()) : resources[index].tags;

  writeDatabase(resources);
  res.json(resources[index]);
});

// DELETE: Delete resource
app.delete("/api/resources/:id", (req, res) => {
  const { id } = req.params;
  let resources = readDatabase();
  const initialLen = resources.length;
  resources = resources.filter((r: any) => r.id !== id);
  if (resources.length === initialLen) {
    return res.status(404).json({ error: "Resource not found" });
  }
  writeDatabase(resources);
  res.json({ success: true });
});

// POST: AI Categorizer & Enhancer using Gemini API
app.post("/api/categorize", async (req, res) => {
  const { url, name, desc } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  // Check if API client exists
  const ai = getGeminiClient();
  if (!ai) {
    // Elegant fallback if no key is set yet
    console.warn("GEMINI_API_KEY is not defined. Using static rules engine fallback.");
    
    // Extrapolate name and category from URL
    let inferredName = name || "New Resource";
    let inferredCategory = "TOOLS";
    let inferredTags = ["DEVELOPMENT", "FAST-SAVED"];
    
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.replace("www.", "");
      inferredName = name || hostname.split(".")[0].toUpperCase();
      
      const hostLower = hostname.toLowerCase();
      if (hostLower.includes("git") || hostLower.includes("code") || hostLower.includes("npm")) {
        inferredCategory = "LIBRARIES";
        inferredTags = ["RELIABLE", "CODE-BASE", "GIT-SOURCE"];
      } else if (hostLower.includes("api") || hostLower.includes("graphql") || hostLower.includes("endpoint")) {
        inferredCategory = "APIS";
        inferredTags = ["REST-API", "FAST-INTEG", "JSON"];
      } else if (hostLower.includes("template") || hostLower.includes("theme") || hostLower.includes("starter")) {
        inferredCategory = "TEMPLATES";
        inferredTags = ["KICKSTART", "BOILERPLATE", "PRE-MADE"];
      } else if (hostLower.includes("doc") || hostLower.includes("wiki") || hostLower.includes("learn") || hostLower.includes("guide")) {
        inferredCategory = "DOCUMENTATION";
        inferredTags = ["EASY-LEARN", "REFERENCE", "READ-FAST"];
      } else if (hostLower.includes("tutorial") || hostLower.includes("course") || hostLower.includes("classes")) {
        inferredCategory = "TUTORIALS";
        inferredTags = ["STEP-BY-STEP", "MASTERY", "PRACTICAL"];
      } else if (hostLower.includes("snippet") || hostLower.includes("gist") || hostLower.includes("carbon")) {
        inferredCategory = "SNIPPETS";
        inferredTags = ["COPY-PASTE", "FAST-IMPORT", "PRO-TRICK"];
      } else if (hostLower.includes("cool") || hostLower.includes("inspire") || hostLower.includes("design") || hostLower.includes("dribbble")) {
        inferredCategory = "INSPIRATION";
        inferredTags = ["EYE-CANDY", "MAXIMALISM", "NEO-BRUTALISM"];
      }
    } catch (_) {
      // ignore parsing error
    }

    return res.json({
      name: inferredName,
      desc: desc || "A curated piece of high-performance resources saved in your database.",
      category: inferredCategory,
      tags: inferredTags,
      isFallback: true,
    });
  }

  try {
    const prompt = `You are an elite, retro-futuristic AI cataloging system running in a Maximalist Hacker terminal.
Your task is to analyze the following resource details and categorize it into the most appropriate category with screamingly-vibrant, uppercase, bold tracking tags (like sticker labels).

Input Details:
- URL: ${url}
- Suggested Title (optional): ${name || "Not provided"}
- Suggested Description (optional): ${desc || "Not provided"}

Instructions:
1. EXTRAPOLATE or ENHANCE the title to be extremely high-impact, short, and memorable (maximum 4 words, keeping brand names intact, e.g. "React documentation" -> "React.js Doc Vault").
2. EXTRAPOLATE or ENHANCE the description to be punchy, exciting, and extremely clear (maximum 22 words).
3. CATEGORIZE this resource into EXACTLY ONE of the following standard Categories:
   - "DOCUMENTATION"
   - "TOOLS"
   - "APIS"
   - "TEMPLATES"
   - "LIBRARIES"
   - "TUTORIALS"
   - "SNIPPETS"
   - "ASSETS"
   - "INSPIRATION"
4. GENERATE 3 to 5 vibrant, highly-energetic, bold, hyphenated labels (tags) in ALL UPPERCASE (e.g., ["CYBER-CORE", "MUST-HAVE", "PRO-GRADE", "FE-MASTERY"]). Avoid boring general terms like "HTML", "CSS", "JAVASCRIPT" unless they are styled like sticker slogans e.g. "JS-BEAST", "CSS-MAGIC".

Return ONLY a premium, compliant JSON object according to this schema:
{
  "name": "enhanced and punchy short title",
  "desc": "highly optimized description",
  "category": "ONE_OF_THE_UPPERCASE_CATEGORIES_LISTED_ABOVE",
  "tags": ["BOLD-TAG-1", "VIBRANT-LABEL-2", "CYBER-SLICED-3"]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: "High-impact, short title for the developer resource (max 4 words).",
            },
            desc: {
              type: Type.STRING,
              description: "Exciting, ultra-punchy description of the resource (max 22 words).",
            },
            category: {
              type: Type.STRING,
              description: "Must be exactly one of: DOCUMENTATION, TOOLS, APIS, TEMPLATES, LIBRARIES, TUTORIALS, SNIPPETS, ASSETS, INSPIRATION",
            },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Array of 3 to 5 all-uppercase, bold hyphenated developer sticker tags.",
            },
          },
          required: ["name", "desc", "category", "tags"],
        },
      },
    });

    const parsedData = JSON.parse(response.text?.trim() || "{}");
    res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini categorization failed:", error);
    res.status(500).json({ error: "Gemini analysis error", details: error?.message || "" });
  }
});

// =======================================================

// Integrate Vite Middleware for Express
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MAXIMALIST SERVER] Running at http://localhost:${PORT}`);
  });
}

startServer();
