# WordWise: Your AI-Powered Writing Assistant for Social Media

WordWise is an intelligent Chrome extension designed for content creators, social media managers, and anyone looking to elevate their writing on **X (formerly Twitter)** and **Instagram**. It provides real-time feedback on grammar, style, tone, and SEO directly within your browser, helping you craft compelling content with confidence and efficiency.

## Features

WordWise offers a suite of tools to enhance your writing process, from initial draft to final post.

### Core Features
*   **Grammar & Spelling Check**: Corrects typos, grammatical errors, and punctuation mistakes with one-click suggestions.
*   **Tone & Readability Analysis**: Improves clarity with a readability score and emotional sentiment detection.

### Premium Features
*   **Save Posts as Inspiration**: Save inspiring posts from X or Instagram to your personal library to guide your future content.
*   **Improve This Post**: Receive comprehensive suggestions to enhance engagement, clarity, and structure before you post.
*   **Make This More [Adjective]**: Adjust your post's tone by specifying an adjective (e.g., "witty," "heartfelt," "bold").
*   **Analyze This Post**: Get an AI-driven analysis of a post's performance, with insights on what made it successful or unsuccessful.
*   **Image Caption Generator**: Automatically generate engaging captions for your images on X and Instagram.

## Installation

Getting started with WordWise is simple: [install it here](https://chromewebstore.google.com/detail/wordwise-ai-writing-assis/koacggpfpocpmjekijelppaikmfafklp).

To install the extension manually, you can do the following:

1.  **Download the Extension**: Download the `client` folder from this repository. You can do this by cloning the repository or downloading it as a ZIP file.
2.  **Open Chrome Extensions**: Open Google Chrome and navigate to `chrome://extensions/`.
3.  **Enable Developer Mode**: In the top-right corner, toggle on **"Developer mode"**.
4.  **Load the Extension**:
    *   Click on **"Load unpacked"**.
    *   Select the `client` directory you downloaded.
5.  **Done!**: The "WordWise: AI Writing Assistant" extension will now appear in your list of extensions. Pin it to your toolbar for easy access!

## How to Use

1.  **Log In**: Click the WordWise icon in your Chrome toolbar to sign up or log in.
2.  **Navigate & Write**: Go to **x.com** or **instagram.com** and start writing a post in any text field.
3.  **Get Suggestions**: The WordWise indicator icon will appear next to the text field. After you stop typing, it will show the number of available suggestions.
4.  **Review & Apply**: Click the indicator to open the suggestion box. You can apply, ignore, or customize suggestions.
5.  **Explore Features**: Use the extension popup and the in-line suggestion box to access all the core and premium features.

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
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── server/          # FastAPI Server
│   ├── main.py
│   ├── auth.py
│   ├── crud.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── requirements.txt
│   └── nlp/
│       └── analysis.py
└── PRD.txt
```

## For Developers: Running the Server Locally

If you want to contribute to the project or run your own instance of the backend, follow these steps.

### Prerequisites

*   Google Chrome
*   Python 3.8+ and `pip`

### Server Setup

1.  **Navigate to the server directory:**
    ```bash
    cd server
    ```

2.  **Install Python dependencies:**
    ```bash
    pip install -r requirements.txt
    ```
    *(Note: This will also download the `spacy` language model, which may take a few minutes.)*

3.  **Run the FastAPI server:**
    ```bash
    uvicorn main:app --reload
    ```
    The server will run at `http://127.0.0.1:8000`. The client is configured to connect to the deployed server, so you may need to update the server URL in `client/background.js` to point to your local instance for testing. 
