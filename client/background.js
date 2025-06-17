console.log("WordWise background script loaded.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("WordWise extension installed.");
});

const API_BASE_URL = 'https://grammar.bagztech.com';

// Helper to get token
function getToken() {
    return new Promise((resolve) => {
        chrome.storage.local.get('token', (result) => {
            resolve(result.token);
        });
    });
}

// Reusable fetch function with authentication
async function fetchWithAuth(url, options = {}) {
    const token = await getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        // Handle unauthorized access, e.g., prompt user to log in.
        console.error("Authentication error. User may need to log in.");
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }

    return response.json();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case 'analyzeText':
            handleAnalyzeText(request.payload, sendResponse);
            break;
        case 'addWordToDictionary':
            handleAddWord(request.payload, sendResponse);
            break;
        case 'openPopup':
            handleOpenPopup();
            break;
        default:
            console.warn(`Unknown message type received: ${request.type}`);
            return false;
    }
    
    return true;
});

function handleAnalyzeText(payload, sendResponse) {
    // Get user settings from sync storage
    chrome.storage.sync.get(['tonePreference', 'grammar', 'tone', 'style', 'seo'], async (settings) => {
        const requestPayload = {
            text: payload.text,
            platform: payload.platform,
            field: payload.field,
            tone_preference: settings.tonePreference || 'professional',
            enabled_analyzers: {
                grammar: settings.grammar !== false,
                tone: settings.tone !== false,
                style: settings.style !== false,
                seo: settings.seo !== false
            }
        };

        try {
            const data = await fetchWithAuth(`${API_BASE_URL}/analyze/`, {
                method: 'POST',
                body: JSON.stringify(requestPayload),
            });
            sendResponse(data);
        } catch (error) {
            console.error('Error analyzing text:', error);
            sendResponse({ error: error.message });
        }
    });
}

async function handleAddWord(payload, sendResponse) {
    try {
        const data = await fetchWithAuth(`${API_BASE_URL}/dictionary/add`, {
            method: 'POST',
            body: JSON.stringify({ word: payload.word }),
        });
        sendResponse({ success: true, ...data });
    } catch (error) {
        console.error('Error adding word to dictionary:', error);
        sendResponse({ success: false, error: error.message });
    }
}

function handleOpenPopup() {
    chrome.windows.create({
        url: 'popup/popup.html',
        type: 'popup',
        width: 400,
        height: 600,
        focused: true
    });
} 