// Cloudflare Worker for the Marvel-Manhattan AI Project Workshop.
// Set GEMINI_API_KEY as a Worker Secret; never put it in index.html.
const ALLOWED_ORIGINS = new Set([
  'https://jg76c96f57-hue.github.io',
  'http://localhost:8787',
  'http://127.0.0.1:8787'
]);

function json(data, status = 200, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': origin || 'https://jg76c96f57-hue.github.io',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin'
      }});
    }
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'Diese Website ist für den Worker nicht freigegeben.' }, 403, origin);
    if (request.method !== 'POST') return json({ error: 'Bitte POST verwenden.' }, 405, origin);
    if (!env.GEMINI_API_KEY) return json({ error: 'Der Worker-Schlüssel GEMINI_API_KEY fehlt. Hinterlege ihn in den Worker-Secrets.' }, 500, origin);

    let input;
    try { input = await request.json(); }
    catch { return json({ error: 'Die Anfrage war kein gültiges JSON.' }, 400, origin); }

    const idea = String(input.idea || '').trim();
    const mode = String(input.mode || 'building');
    if (!idea) return json({ error: 'Bitte beschreibe zuerst deine Projektidee.' }, 400, origin);
    if (idea.length > 12000) return json({ error: 'Die Beschreibung ist zu lang (maximal 12.000 Zeichen).' }, 413, origin);

    const modeNames = {
      building: 'Minecraft-Gebäude / Bauwerk',
      minecraft: 'Minecraft-Projekt',
      website: 'Website oder Web-App',
      game: 'Spiel oder interaktive Simulation',
      story: 'Geschichte, Welt oder Figuren',
      learning: 'Lern- oder Schulprojekt',
      other: 'Sonstiges freies Projekt'
    };
    const isBuilding = mode === 'building';
    const context = isBuilding
      ? `Minecraft-Bauwerk. Maße: ${input.width} breit, ${input.depth} tief, Höhe ${input.height}, ${input.floors} Etagen. Stil: ${input.style || 'frei'}. Survival-Aufwand: ${input.difficulty || 'mittel'}. Koordinaten: ${input.coords || 'nicht angegeben'}.`
      : `Projektart: ${modeNames[mode] || modeNames.other}. Zusätzliche Wünsche: ${String(input.projectType || 'keine angegeben')}. Erstelle kein Minecraft-Gebäude, außer der Nutzer wünscht es ausdrücklich.`;

    const prompt = `Du bist eine hilfreiche, sichere und geduldige deutschsprachige Projekt-KI. Antworte konkret und altersgerecht. Erstelle eine umsetzbare Anleitung, keine bloßen allgemeinen Tipps. Bei Programmierprojekten gib lauffähigen, vollständigen Code an, wenn die Anfrage danach verlangt; nenne die Dateinamen und erkläre, wo der Code hingehört. Bei Websites berücksichtige iPad/Safari, mobile Darstellung, Datenschutz und sichere Schlüsselverwaltung. Behaupte niemals, dass Code getestet wurde, wenn du ihn nicht ausgeführt hast. Wenn Informationen fehlen, triff vernünftige Annahmen und benenne sie kurz.
Projektmodus: ${modeNames[mode] || modeNames.other}
Nutzeridee: ${idea}
Kontext: ${context}

Gib NUR ein gültiges JSON-Objekt mit genau diesen Feldern zurück:
{
 "title": "kurzer Projekttitel",
 "summary": "kurze Zusammenfassung",
 "deliverable": "konkretes Ergebnis, Konzept oder erste Umsetzung; bei Codeprojekten kurz erklären, was der Code macht",
 "code": "vollständiger Code als String, wenn für die Idee Code sinnvoll ist, sonst leerer String",
 "materials": [{"name":"Material oder Ressource","amount":0,"notes":"wofür"}],
 "floors": [{"level":1,"name":"Abschnitt oder Ebene","description":"Beschreibung","dimensions":"Maße falls sinnvoll","rooms":[],"steps":[]}],
 "steps": ["konkreter Schritt 1", "konkreter Schritt 2"],
 "tips": ["wichtiger Hinweis"]
}
Für nicht-bauliche Projekte dürfen materials und floors leere Arrays sein. Wenn du Code erzeugst, nutze im Feld code normale Quelltextzeichen und keine Markdown-Codezäune. Wenn die Antwort sehr groß wäre, liefere eine sinnvolle erste Version und teile klar mit, was noch fehlt.`;

    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(env.GEMINI_API_KEY), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
        })
      });
      const apiData = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = apiData?.error?.message || `KI-Anfrage fehlgeschlagen (${response.status}).`;
        return json({ error: message }, 502, origin);
      }
      const raw = apiData?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
      if (!raw) return json({ error: 'Die KI hat keine Antwort geliefert. Bitte versuche es erneut.' }, 502, origin);
      let plan;
      try { plan = JSON.parse(raw); }
      catch { return json({ error: 'Die KI-Antwort ließ sich nicht als JSON lesen. Bitte versuche es erneut.' }, 502, origin); }
      if (!plan || !Array.isArray(plan.steps)) return json({ error: 'Die KI-Antwort hatte nicht das erwartete Format.' }, 502, origin);
      plan.materials = Array.isArray(plan.materials) ? plan.materials : [];
      plan.floors = Array.isArray(plan.floors) ? plan.floors : [];
      plan.tips = Array.isArray(plan.tips) ? plan.tips : [];
      return json({ plan }, 200, origin);
    } catch (error) {
      return json({ error: 'Verbindungsfehler beim Aufrufen der KI. Prüfe Worker und Internetverbindung.' }, 502, origin);
    }
  }
};
