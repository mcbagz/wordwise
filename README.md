# WordWise: AI Writing Assistant

This project is a Chrome extension that provides real-time writing suggestions for content creators on social media platforms. It's built with a JavaScript-based Chrome extension client and a Python FastAPI server for NLP analysis.

## Project Structure

```
/
├── client/          # Chrome Extension
│   ├── manifest.json
│   ├── background.js
│   ├── content_scripts/
│   │   └── content.js
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   └── icons/
├── server/          # FastAPI Server
│   ├── main.py
│   ├── requirements.txt
│   └── nlp/
│       └── analysis.py
└── PRD.txt
```

## Getting Started

### Prerequisites

*   Google Chrome
*   Python 3.8+ and `pip`

### 1. Server Setup

First, set up and run the backend server.

1.  **Navigate to the server directory:**
    ```bash
    cd server
    ```

2.  **Install Python dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
    *If you encounter permission errors on Windows, try:*
    ```bash
    pip install -r requirements.txt --user
    ```
    This will also download the `spacy` language model, which may take a few minutes on the first run.

3.  **Run the FastAPI server:**
    ```bash
    uvicorn main:app --reload
    ```
    The server will be running at `http://127.0.0.1:8000`.

### 2. Client Setup (Chrome Extension)

Next, load the extension into Google Chrome.

1.  Open Google Chrome and navigate to `chrome://extensions/`.
2.  Enable **"Developer mode"** in the top right corner.
3.  Click on **"Load unpacked"**.
4.  Select the `client` directory from this project.
5.  The "WordWise: AI Writing Assistant" extension should now appear in your list of extensions.

### How to Use

Once the server is running and the extension is loaded:

1.  Navigate to [X](https://x.com), [Instagram](https://www.instagram.com), or [YouTube](https://www.youtube.com).
2.  Click on a text field (e.g., a post composer, a caption field, or a video description).
3.  Start typing! As you type, suggestions will appear in a box next to the text field.
4.  You can customize which suggestions you receive by clicking on the extension's icon in the Chrome toolbar.

## Next Steps

This is an MVP (Minimum Viable Product). The next steps for development would be:

*   **Improve NLP models:** Replace the placeholder logic in `server/nlp/analysis.py` with more sophisticated models for grammar, tone, style, and SEO.
*   **Refine the UI:** Improve the positioning and appearance of the suggestion box.
*   **Add more features:** Implement features from the PRD like custom dictionaries and advanced analytics. 