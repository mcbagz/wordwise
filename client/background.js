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
        case 'getInspirations':
            handleGetInspirations(sendResponse);
            break;
        case 'adjustTone':
            handleAdjustTone(request.payload, sendResponse);
            break;
        case 'analyzePost':
            handleAnalyzePost(request.payload, sendResponse);
            break;
        case 'improvePost':
            handleImprovePost(request.payload, sendResponse);
            break;
        case 'generateCaption':
            handleGenerateCaption(request.payload, sendResponse);
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

async function handleGetInspirations(sendResponse) {
    try {
        const data = await fetchWithAuth(`${API_BASE_URL}/inspiration`);
        sendResponse({ success: true, inspirations: data });
    } catch (error) {
        console.error('Error getting inspirations:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleAdjustTone(payload, sendResponse) {
    try {
        const data = await fetchWithAuth(`${API_BASE_URL}/tone-adjust`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        sendResponse({ success: true, ...data });
    } catch (error) {
        console.error('Error adjusting tone:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleAnalyzePost(payload, sendResponse) {
    try {
        const data = await fetchWithAuth(`${API_BASE_URL}/analyze-post`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        sendResponse({ success: true, analysis: data });
    } catch (error) {
        console.error('Error analyzing post:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleImprovePost(payload, sendResponse) {
    try {
        const data = await fetchWithAuth(`${API_BASE_URL}/improve-post`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        sendResponse({ success: true, improvements: data });
    } catch (error) {
        console.error('Error improving post:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleGenerateCaption(payload, sendResponse) {
    const { imageUrl, platform, keywords } = payload;
    
    let imageBlob;
    try {
        imageBlob = await fetch(imageUrl).then(r => r.blob());
    } catch (error) {
        console.error('WordWise: Error fetching blob URL in background script:', error);
        sendResponse({ success: false, error: "Could not process the provided image." });
        return;
    }

    const token = await getToken();

    if (!token) {
        sendResponse({ success: false, error: "Authentication required." });
        return;
    }

    const formData = new FormData();
    formData.append('image', imageBlob, 'upload.jpg');
    formData.append('platform', platform);
    if (keywords) {
        formData.append('keywords', keywords);
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/caption/generate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        sendResponse({ success: true, captions: data.captions });

    } catch (error) {
        console.error('Error generating caption:', error);
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