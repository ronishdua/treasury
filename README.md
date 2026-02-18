# TTB Label Compliance Checker

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
- **AI:** Anthropic Claude API (Haiku for speed, Sonnet fallback for quality)
- **Image Processing:** Pillow
- **Real-time Communication:** Server-Sent Events (native EventSource)

## Approach

The biggest bottleneck for TTB compliance agents has been batch label review -- Janet mentioned that agents have been asking for bulk upload capability for years. That was the priority: enabling agents to upload and verify up to 300 labels at once, with results streaming back as each label finishes rather than waiting for the entire batch. The frontend chunks uploads (5 files at a time, 3 concurrent) to keep things stable, and a global worker pool on the backend processes labels in parallel.

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
