// Indique au navigateur ce qui est disponible (sans jamais renvoyer de clé secrète).
export function GET() {
  const cfg = {
    mode: "cloud",
    llm: !!process.env.ANTHROPIC_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    codeRequis: !!process.env.JARVIS_ACCESS_CODE,
    // La clé Picovoice est conçue pour être utilisée dans le navigateur (détection locale du mot « Jarvis »).
    picovoice: process.env.PICOVOICE_ACCESS_KEY || null,
  };
  return new Response(JSON.stringify(cfg), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
