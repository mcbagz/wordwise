document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://grammar.bagztech.com';

    // Views
    const authContainer = document.getElementById('auth-container');
    const mainContent = document.getElementById('main-content');
    const loginView = document.getElementById('login-view');
    const signupView = document.getElementById('signup-view');

    // Forms
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');

    // Buttons and links
    const showSignupBtn = document.getElementById('show-signup');
    const showLoginBtn = document.getElementById('show-login');
    const logoutBtn = document.getElementById('logout-btn');

    // User info
    const userInfo = document.getElementById('user-info');

    // Settings elements
    const grammarToggle = document.getElementById('grammar-toggle');
    const toneToggle = document.getElementById('tone-toggle');
    const styleToggle = document.getElementById('style-toggle');

    // New elements for Inspiration feature
    const saveInspirationBtn = document.getElementById('save-inspiration-btn');
    const inspirationList = document.getElementById('inspiration-list');

    // New elements for Post Analysis feature
    const analyzePostBtn = document.getElementById('analyze-post-btn');
    const analysisResultsContainer = document.getElementById('analysis-results-container');

    let uploadedFile = null;

    const defaultSettings = {
        grammar: true,
        tone: true,
        style: true,
    };

    function showView(view) {
        authContainer.style.display = 'none';
        mainContent.style.display = 'none';

        if (view === 'auth') {
            authContainer.style.display = 'block';
        } else if (view === 'main') {
            mainContent.style.display = 'block';
        }
    }

    function toggleAuthView(view) {
        loginView.style.display = 'none';
        signupView.style.display = 'none';
        if (view === 'login') {
            loginView.style.display = 'block';
        } else {
            signupView.style.display = 'block';
        }
    }
    
    showSignupBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleAuthView('signup');
    });

    showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleAuthView('login');
    });

    // Check auth status on load
    chrome.storage.local.get('token', (result) => {
        if (result.token) {
            fetch(`${API_URL}/users/me/`, {
                headers: { 'Authorization': `Bearer ${result.token}` }
            })
            .then(response => {
                if (response.ok) return response.json();
                throw new Error('Token invalid');
            })
            .then(user => {
                userInfo.textContent = `Logged in as ${user.email}`;
                showView('main');
                loadSettings();
            })
            .catch(() => {
                showView('auth');
                toggleAuthView('login');
            });
        } else {
            showView('auth');
            toggleAuthView('login');
        }
    });

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const formData = new FormData();
        formData.append('username', email);
        formData.append('password', password);

        fetch(`${API_URL}/token`, {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) throw new Error('Login failed');
            return response.json();
        })
        .then(data => {
            chrome.storage.local.set({ token: data.access_token }, () => {
                userInfo.textContent = `Logged in as ${email}`;
                showView('main');
                loadSettings();
            });
        })
        .catch(error => {
            console.error(error);
            alert(error.message);
        });
    });

    signupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        
        fetch(`${API_URL}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        })
        .then(response => {
            if (!response.ok) throw new Error('Signup failed. Email might be taken.');
            return response.json();
        })
        .then(() => {
            alert('Signup successful! Please log in.');
            toggleAuthView('login');
        })
        .catch(error => {
            console.error(error);
            alert(error.message);
        });
    });

    logoutBtn.addEventListener('click', () => {
        chrome.storage.local.remove('token', () => {
            showView('auth');
            toggleAuthView('login');
        });
    });

    function loadSettings() {
        chrome.storage.sync.get(defaultSettings, (items) => {
            grammarToggle.checked = items.grammar;
            toneToggle.checked = items.tone;
            styleToggle.checked = items.style;
        });

        grammarToggle.addEventListener('change', (e) => chrome.storage.sync.set({ grammar: e.target.checked }));
        toneToggle.addEventListener('change', (e) => chrome.storage.sync.set({ tone: e.target.checked }));
        styleToggle.addEventListener('change', (e) => chrome.storage.sync.set({ style: e.target.checked }));
    }

    // Tab functionality
    document.querySelectorAll('.tab-link').forEach(button => {
        button.addEventListener('click', (evt) => {
            const tabName = evt.currentTarget.dataset.tab;

            // Hide all tab content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.style.display = 'none';
            });

            // Deactivate all tab links
            document.querySelectorAll('.tab-link').forEach(link => {
                link.classList.remove('active');
            });

            // Show the target tab content and activate the link
            document.getElementById(tabName).style.display = 'block';
            evt.currentTarget.classList.add('active');

            // If the inspirations tab is clicked, load the content
            if (tabName === 'inspirations') {
                loadInspirations();
            } else if (tabName === 'analyze-post') {
                // You could optionally clear old results here
                // analysisResultsContainer.innerHTML = '';
            }
        });
    });

    // --- Post Analysis Functions ---

    analyzePostBtn.addEventListener('click', () => {
        analysisResultsContainer.innerHTML = '<em>Analyzing post...</em>';

        // Get detailed data from content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) {
                analysisResultsContainer.innerHTML = '<p>Could not connect to the active tab.</p>';
                return;
            }
            chrome.tabs.sendMessage(tabs[0].id, { action: "getDetailedPostData" }, (response) => {
                if (chrome.runtime.lastError || !response || !response.data) {
                    analysisResultsContainer.innerHTML = '<p>Could not retrieve post data. Make sure you are on a supported post page.</p>';
                    console.error(chrome.runtime.lastError?.message);
                    return;
                }
                
                // Send data to background script for API call
                chrome.runtime.sendMessage({ type: 'analyzePost', payload: response.data }, (apiResponse) => {
                    if (apiResponse && apiResponse.success) {
                        displayAnalysisResults(apiResponse.analysis);
                    } else {
                        analysisResultsContainer.innerHTML = `<p>Error: ${apiResponse.error || 'Failed to analyze post.'}</p>`;
                    }
                });
            });
        });
    });

    function displayAnalysisResults(analysis) {
        if (!analysis) {
            analysisResultsContainer.innerHTML = '<p>No analysis results returned.</p>';
            return;
        }

        let html = `
            <h3>Summary</h3>
            <p>${analysis.summary}</p>
            <h3>Key Factors</h3>
            <ul>
                ${analysis.key_factors.map(factor => `<li>${factor}</li>`).join('')}
            </ul>
            <h3>Recommendations</h3>
            <ul>
                ${analysis.recommendations.map(rec => `<li>${rec}</li>`).join('')}
            </ul>
        `;
        analysisResultsContainer.innerHTML = html;
    }

    // --- Inspiration Library Functions ---

    function loadInspirations() {
        chrome.storage.local.get('token', (result) => {
            if (!result.token) return;

            fetch(`${API_URL}/inspiration`, {
                headers: { 'Authorization': `Bearer ${result.token}` }
            })
            .then(response => response.ok ? response.json() : Promise.reject('Failed to load inspirations'))
            .then(inspirations => displayInspirations(inspirations))
            .catch(error => console.error('Error loading inspirations:', error));
        });
    }

    function displayInspirations(inspirations) {
        inspirationList.innerHTML = ''; // Clear existing list
        if (inspirations.length === 0) {
            inspirationList.innerHTML = '<p>No inspirations saved yet.</p>';
            return;
        }

        inspirations.forEach(insp => {
            const item = document.createElement('div');
            item.className = 'inspiration-item';
            item.innerHTML = `
                <p class="platform">${insp.platform}</p>
                <p>${insp.post_text ? insp.post_text.substring(0, 100) + '...' : ''}</p>
                ${insp.image_url ? `<img src="${insp.image_url}" width="100">` : ''}
                <button class="delete-inspiration-btn" data-id="${insp.id}">Delete</button>
            `;
            inspirationList.appendChild(item);
        });

        // Add event listeners to delete buttons
        document.querySelectorAll('.delete-inspiration-btn').forEach(button => {
            button.addEventListener('click', handleDeleteInspiration);
        });
    }
    
    saveInspirationBtn.addEventListener('click', () => {
        // Send message to content script to get post data
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: "getPostData" }, (response) => {
                if (chrome.runtime.lastError) {
                    alert("Could not detect a post on this page. Make sure you are on a supported post page on X or Instagram.");
                    console.error(chrome.runtime.lastError.message);
                    return;
                }
                if (response && response.data) {
                    saveInspiration(response.data);
                }
            });
        });
    });

    function saveInspiration(postData) {
        chrome.storage.local.get('token', (result) => {
            if (!result.token) return;

            fetch(`${API_URL}/inspiration`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${result.token}`
                },
                body: JSON.stringify(postData)
            })
            .then(response => response.ok ? response.json() : Promise.reject('Failed to save inspiration'))
            .then(() => {
                alert('Inspiration saved!');
                loadInspirations(); // Refresh list
            })
            .catch(error => {
                console.error('Error saving inspiration:', error)
                alert('Could not save inspiration.');
            });
        });
    }

    function handleDeleteInspiration(event) {
        const inspirationId = event.target.dataset.id;
        chrome.storage.local.get('token', (result) => {
            if (!result.token) return;

            fetch(`${API_URL}/inspiration/${inspirationId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${result.token}` }
            })
            .then(response => {
                if (response.ok) {
                    // Remove the item from the DOM
                    event.target.closest('.inspiration-item').remove();
                } else {
                    return Promise.reject('Failed to delete inspiration');
                }
            })
            .catch(error => {
                console.error('Error deleting inspiration:', error);
                alert('Could not delete inspiration.');
            });
        });
    }
}); 