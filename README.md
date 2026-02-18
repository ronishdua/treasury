# TTB Label Compliance Checker

**Live:** [treasury-five-xi.vercel.app](https://treasury-five-xi.vercel.app/)

AI-powered alcohol beverage label verification for TTB compliance agents. Upload label images and application data, and get automated compliance checks with real-time streaming results.

## How It Works

1. Upload a CSV with your COLA application data and label images (up to 300 at a time)
2. Click Analyze -- the system extracts structured data from each label using Claude vision
3. Results stream back in real-time as each label is processed
4. Review compliance status: passed, needs review, or rejected

## CSV Format

Upload a CSV with the following columns:

| Column | Example |
|--------|---------|
| `label_id` | COLA-0001 |
| `brand_name` | Old Tom Distillery |
| `class_type` | Kentucky Straight Bourbon Whiskey |
| `alcohol_content` | 45% Alc./Vol. |
| `net_contents` | 750 mL |
| `producer_name` | Old Tom Distillery |
| `producer_address` | Louisville, KY |

## Image Naming

Image filenames should match the `label_id` column in your CSV. For example, a row with `label_id` of `COLA-0001` should have a corresponding image named `COLA-0001.png` (or `.jpg`, `.webp`).

## Tech Stack

- **Frontend:** React 19, Vite 7, Tailwind CSS 4
- **Backend:** FastAPI, Uvicorn
- **AI:** Anthropic Claude API (Haiku for extraction speed)
- **Image Processing:** Pillow
- **Real-time Communication:** Server-Sent Events (native EventSource)

## Approach

The biggest bottleneck for TTB compliance agents has been batch label review -- Janet mentioned that agents have been asking for bulk upload capability for years. That was the priority: enabling agents to upload and verify up to 300 labels at once, with results streaming back as each label finishes rather than waiting for the entire batch. The frontend compresses images client-side and chunks uploads (3 files at a time, 4 concurrent) to keep things fast, and a global worker pool on the backend processes labels in parallel.

## Trade-offs and Limitations

- **Focused on batch uploads as the core problem.** Sarah and Janet both emphasized that processing labels one-at-a-time is the biggest pain point for agents handling 200-300 label applications from importers. Everything else -- the streaming results, chunked uploads, parallel workers -- supports that goal.
- **Haiku-only for speed.** Sonnet produces more accurate extraction on difficult labels but takes 2-3x longer. Since agents flagged 5-second response time as a hard requirement (the scanning vendor pilot failed at 30-40s), I kept Haiku as the sole model. The Sonnet fallback logic exists in the codebase but is disabled. Trade-off: occasional extraction misses on low-quality images that Sonnet would catch.
- **Case-insensitive, punctuation-normalized matching.** Dave's example of "STONE'S THROW" vs "Stone's Throw" is handled -- brand name comparison strips punctuation and case before comparing, so obvious formatting differences don't trigger false mismatches.
- **Government warning checks are thorough but imperfect.** The system checks for warning presence, exact text match against the canonical federal warning, ALL CAPS on the header, and bold formatting. Bold detection is best-effort since vision models can't reliably distinguish font weight.
- **No persistent storage.** This is a stateless prototype -- results exist only during the session. No user data is retained after the job expires (30 min TTL). Appropriate for a POC per Marcus's guidance, but a production version would need result persistence and audit trails.
- **Image quality handling is limited.** The preprocessing pipeline handles EXIF rotation, contrast boosting, and resizing, but can't correct heavy skew or glare. Labels that are unreadable to the model get flagged as "low confidence" with downgraded severity so agents know to review manually.
- **Scales to 300 labels but hasn't been load-tested at that volume.** The architecture supports it (12 workers, 10 concurrent API calls, chunked uploads), but at 300 images the main constraint becomes Anthropic API rate limits. The retry logic handles 429s with exponential backoff, so it should complete but may take 3-5 minutes for a full batch.
- **Client-side image compression before upload.** Images are resized to 1600px and converted to JPEG in the browser before uploading, reducing payload by ~6x. This keeps upload times reasonable even on slower connections.

## Quick Start

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

echo "ANTHROPIC_API_KEY=your-key-here" > .env

uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.
