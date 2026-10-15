// Generates one ElevenLabs narration clip per scene into out/voice/<id>.mp3
import fs from 'node:fs';
const KEY = process.env.ELEVEN || process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; // "George": warm British narrator
if (!KEY) throw new Error('Set ELEVEN=<elevenlabs api key>');
const scenes = JSON.parse(fs.readFileSync(new URL('./voiceover.json', import.meta.url)));
fs.mkdirSync('out/voice', { recursive: true });
for (const s of scenes) {
  if (fs.existsSync(`out/voice/${s.id}.mp3`) && !process.env.FORCE) continue; // reuse existing clips
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: s.text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error(`${s.id}: ${r.status} ${await r.text()}`);
  fs.writeFileSync(`out/voice/${s.id}.mp3`, Buffer.from(await r.arrayBuffer()));
  console.log('✓', s.id);
}
