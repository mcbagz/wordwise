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
    const grammarToggle = document.getElementById('grammar');
    const toneToggle = document.getElementById('tone');
    const seoToggle = document.getElementById('seo');
    const tonePreferenceSelect = document.getElementById('tone-preference');

    const defaultSettings = {
        grammar: true,
        tone: true,
        seo: true,
        tonePreference: 'professional',
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
            seoToggle.checked = items.seo;
            tonePreferenceSelect.value = items.tonePreference;
        });

        grammarToggle.addEventListener('change', (e) => chrome.storage.sync.set({ grammar: e.target.checked }));
        toneToggle.addEventListener('change', (e) => chrome.storage.sync.set({ tone: e.target.checked }));
        seoToggle.addEventListener('change', (e) => chrome.storage.sync.set({ seo: e.target.checked }));
        tonePreferenceSelect.addEventListener('change', (e) => chrome.storage.sync.set({ tonePreference: e.target.value }));
    }
}); 