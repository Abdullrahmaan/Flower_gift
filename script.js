// Global Firebase variables provided by the environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Check if __firebase_config exists and is a non-empty string before parsing
let firebaseConfig = {};
if (typeof __firebase_config !== 'undefined' && __firebase_config.trim() !== '') {
    try {
        firebaseConfig = JSON.parse(__firebase_config);
    } catch (e) {
        console.error("Failed to parse __firebase_config:", e);
    }
} else {
    // === FIX FOR LOCAL SERVER RUNNING ===
    console.warn("Using placeholder Firebase configuration for local development.");
    firebaseConfig = {
        apiKey: "AIzaSy_LOCAL_DEV_KEY",
        authDomain: "local-dev-app.firebaseapp.com",
        projectId: "local-dev-project", // CRITICAL: This was missing in local runs
        storageBucket: "local-dev-app.appspot.com",
        messagingSenderId: "1234567890",
        appId: "1:1234567890:web:localdev"
    };
    
}

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase App and Services using the global 'firebase' object (Compat API)
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
firebase.firestore.setLogLevel('debug'); // Enable Firestore logging for better debugging

// Global state variables
let userId = null;
let isAuthReady = false;

// --- Utility Functions ---

function formatTimestamp(timestamp) {
    if (timestamp && typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toLocaleDateString();
    }
    return 'Unknown Date';
}

/**
 * Saves the bloomed flower data to the user's private collection in Firestore.
*/
async function saveFlowerToGarden(flowerData) {
    if (!userId) {
        console.error("Cannot save: User not authenticated.");
        return;
    }
    
    if (firebaseConfig.projectId === "local-dev-project") {
        console.warn("Attempting to save data with a placeholder configuration. This will likely fail without proper setup.");
    }
    
    try {
        // Saves data to the user's private collection using Compat syntax
        const collectionRef = db.collection(`artifacts/${appId}/users/${userId}/flowers`);
        
        // Add doc automatically generates an ID and includes the server timestamp
        const docRef = await collectionRef.add({ 
            ...flowerData,
            // Uyumluluk (Compat) Server Timestamp kullanımı
            timestamp: firebase.firestore.FieldValue.serverTimestamp() 
        });
        
        // Update the document to include its own ID (optional but good practice)
        await docRef.update({ id: docRef.id });

        console.log("Flower saved to garden with ID:", docRef.id);
    } catch (e) {
        console.error("Error saving flower to garden: ", e);
    }
}


function startSparkling() {
    const overlay = document.getElementById('sparkle-overlay');
    if (overlay.classList.contains('hidden')) {
        return;
    }
    
    // Generate a few sparkles
    for (let i = 0; i < 15; i++) {
        const sparkle = document.createElement('div');
        sparkle.className = 'sparkle';
        // Random position within the container bounds
        sparkle.style.left = `${Math.random() * 100}%`;
        sparkle.style.top = `${Math.random() * 100}%`;
        // Randomize animation delay
        sparkle.style.animationDelay = `${Math.random() * 2}s`;
        overlay.appendChild(sparkle);
    }
}


function renderGarden(flowers) {
    const grid = document.getElementById('flower-grid');
    grid.innerHTML = ''; 

    if (flowers.length === 0) {
        grid.innerHTML = '<p style="text-align: center; padding: 20px;">Your garden is empty! Water a flower to start collecting.</p>';
        return;
    }

    // Sort flowers by timestamp (newest first). Since orderBy is restricted, we sort client-side.
    flowers.sort((a, b) => {
        const timeA = a.timestamp && a.timestamp.toDate ? a.timestamp.toDate().getTime() : 0;
        const timeB = b.timestamp && b.timestamp.toDate ? b.timestamp.toDate().getTime() : 0;
        return timeB - timeA;
    });

    flowers.forEach(flower => {
        const card = document.createElement('div');
        card.className = 'flower-card';
        card.style.backgroundColor = flower.themeColor || '#ffffff';
        
        // Truncate message for preview
        const messagePreview = flower.message.length > 50 
            ? flower.message.substring(0, 47) + '...' 
            : flower.message;

        card.innerHTML = `
            <img src="${flower.flowerName}.png" alt="${flower.flowerName}">
            <strong>${flower.flowerName} Gift</strong>
            <p class="date">${formatTimestamp(flower.timestamp)}</p>
            <div class="message-preview">${messagePreview}</div>
        `;
        grid.appendChild(card);
    });
}

/**
 * Loads the garden data using a real-time listener (onSnapshot).
 */
function loadGarden() {
    // Only proceed if authenticated and ready
    if (!isAuthReady || !userId) return;

    // Use compat syntax for collection reference
    const flowerCollectionRef = db.collection(`artifacts/${appId}/users/${userId}/flowers`);

    // Set up real-time listener to automatically update the garden
    flowerCollectionRef.onSnapshot((snapshot) => {
        const flowers = [];
        snapshot.forEach((doc) => {
            flowers.push(doc.data());
        });
        renderGarden(flowers);
    }, (error) => {
        console.error("Error listening to garden data: ", error);
        // Display a user-friendly error if running locally
        if (firebaseConfig.projectId === "local-dev-project") {
             document.getElementById('flower-grid').innerHTML = '<p style="text-align: center; padding: 20px; color: orange;">Garden loading failed (expected in local dev environment). Data saving/loading is disabled outside the live Canvas environment.</p>';
        } else {
             document.getElementById('flower-grid').innerHTML = '<p style="text-align: center; padding: 20px; color: red;">Failed to load garden data.</p>';
        }
    });
}

// --- View Switching Logic ---
function switchView(viewName) {
    const flowerView = document.getElementById('flower-view');
    const gardenView = document.getElementById('garden-view');
    const gardenButton = document.getElementById('garden-button');

    if (viewName === 'flower') {
        flowerView.style.display = 'block';
        gardenView.style.display = 'none';
        gardenButton.textContent = 'View Garden';
        document.body.style.justifyContent = 'center'; 
    } else if (viewName === 'garden') {
        flowerView.style.display = 'none';
        gardenView.style.display = 'block';
        gardenButton.textContent = 'Return to Flower';
        document.body.style.justifyContent = 'flex-start';
        loadGarden(); 
    }
}

// --- Main DOM Content Loaded ---
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Gift Page Elements ---
    const wateringCan = document.getElementById('watering-can');
    const initialState = document.getElementById('initial-state');
    const giftReveal = document.getElementById('gift-reveal');
    const mainFlower = document.getElementById('main-flower');
    const personalMessage = document.getElementById('personal-message');
    const backgroundMusic = document.getElementById('background-music');
    const sparkleOverlay = document.getElementById('sparkle-overlay'); 
    const initialHeading = document.getElementById('watering-instruction');
    const gardenButton = document.getElementById('garden-button');
    let currentView = 'flower';
    
    // Safety check in case the element wasn't found
    if (!wateringCan || !initialHeading) {
           console.error("CRITICAL ERROR: Core DOM elements not found. Stopping script execution.");
           return;
    }
    
    // --- 2. Customization Logic (Retrieves data from the URL) ---
    const urlParams = new URLSearchParams(window.location.search);
    
    // A. Multi-Click Mechanic Setup
    const clicksParam = urlParams.get('clicks');
    let requiredClicks = parseInt(clicksParam);
    
    // Fallback logic: If parsing fails (NaN) or results in 0 or less, use default of 3
    if (isNaN(requiredClicks) || requiredClicks <= 0) {
        requiredClicks = 3;
    }
    
    console.log("URL Clicks Parameter Value:", clicksParam);
    console.log("Parsed Required Clicks:", requiredClicks);
    
    let currentClicks = 0; 
    
    // B. Set the Flower Image
    const flowerName = urlParams.get('flower');
    if (flowerName) {
        mainFlower.src = `${flowerName}.png`; 
        mainFlower.alt = `A beautiful pixel art ${flowerName}`;
    } else {
        mainFlower.src = "Rose.png"; 
        mainFlower.alt = "Default Rose";
    }

    // C. Set the Personalized Message
    const messageText = urlParams.get('message');
    // Ensure that if the message is empty, we use the default
    const messageContent = messageText ? decodeURIComponent(messageText) : "No message provided. Still a beautiful flower!";
    personalMessage.textContent = messageContent; 
    
    // D. Set the Music Source
    const musicUrl = urlParams.get('music');
    if (musicUrl) {
        backgroundMusic.src = decodeURIComponent(musicUrl);
    }
    
    // E. Set the Sparkle State
    const sparkleEnabled = urlParams.get('sparkle') === 'true';

    // F. Set the Background Theme 
    const themeName = urlParams.get('theme');
    const themeColors = {
        'default': '#f7f3e8',  
        'warm': '#ffead6',     
        'cool': '#e5f3ff',     
        'vibrant': '#e7ffe7'   
    };
    
    const appliedThemeColor = themeColors[themeName] || themeColors['default'];
    document.body.style.backgroundColor = appliedThemeColor;

    // --- Initial Text Update ---
    const clickText = requiredClicks === 1 
        ? "once" 
        : `${requiredClicks} times`;

    initialHeading.textContent = `These flowers need your touch! Click the can ${clickText} to water them.`;
    
    // --- Garden Button Handler ---
    gardenButton.addEventListener('click', () => {
        if (currentView === 'flower') {
            switchView('garden');
            currentView = 'garden';
        } else {
            switchView('flower');
            currentView = 'flower';
        }
    });
    
    // --- Authentication and Initialization ---
    // Sign in the user (either with token or anonymously) to get a persistent userId
    const attemptSignIn = () => {
        // We only attempt real sign-in if we are NOT using the local dev config
        if (firebaseConfig.projectId !== "local-dev-project") {
            if (initialAuthToken) {
                // Compat sign-in
                auth.signInWithCustomToken(initialAuthToken).catch(e => {
                    console.error("Custom token sign-in failed:", e);
                    auth.signInAnonymously().catch(e => console.error("Anonymous sign-in failed:", e));
                });
            } else {
                // Compat sign-in
                auth.signInAnonymously().catch(e => console.error("Anonymous sign-in failed:", e));
            }
        } else {
             // For local dev, manually set a dummy user ID to allow logic flow
             userId = crypto.randomUUID();
             isAuthReady = true;
             console.warn("Local Dev Mode: Auth bypassed. Using random UUID for userId.");
        }
    };

    // Auth State Listener (Compat)
    // We only use this listener if we are not in local dev mode.
    if (firebaseConfig.projectId !== "local-dev-project") {
        auth.onAuthStateChanged((user) => {
            if (user) {
                userId = user.uid;
                isAuthReady = true;
                console.log("Firebase Auth Ready. User ID:", userId);
                
                // If the flower was bloomed *before* auth completed, save it now.
                const giftBloomed = giftReveal.style.opacity === '1';
                if (giftBloomed) {
                     const flowerData = {
                         flowerName: flowerName || 'Rose',
                         message: personalMessage.textContent,
                         theme: themeName || 'default',
                         themeColor: appliedThemeColor
                     };
                     saveFlowerToGarden(flowerData);
                }
            } else {
                 console.log("Firebase Auth State Changed: No user logged in. Attempting sign-in...");
                 attemptSignIn(); 
            }
        });
    } else {
        // If in local dev mode, run attemptSignIn once to set dummy userId
        attemptSignIn();
    }


    // --- 3. Watering Mechanic Logic ---
    wateringCan.addEventListener('click', () => {
        
        if (currentClicks >= requiredClicks) {
            return;
        }
        
        currentClicks++;
        
        // Visual feedback
        wateringCan.style.transform = `scale(1.15) rotate(-5deg)`;
        setTimeout(() => {
            wateringCan.style.transform = `scale(1) rotate(0deg)`;
        }, 100);
        
        if (currentClicks >= requiredClicks) {
            
            // --- REVEAL SEQUENCE STARTS HERE ---
            initialState.classList.add('hidden');
            initialState.style.display = 'none'; 

            if (backgroundMusic.src) {
                // Attempt to play music, suppressing potential errors on some browsers
                backgroundMusic.play().catch(e => console.log("Music playback failed (user interaction required):", e)); 
            }

            setTimeout(() => {
                giftReveal.classList.remove('hidden');
                // Set opacity to 1 *immediately* to trigger the bloom check in onAuthStateChanged
                giftReveal.style.opacity = 1; 
                mainFlower.classList.add('bloomed'); 
                
                if (sparkleEnabled) {
                    sparkleOverlay.classList.remove('hidden');
                    startSparkling(); 
                }
                
                // --- CRITICAL: SAVE FLOWER TO GARDEN ---
                const flowerData = {
                    flowerName: flowerName || 'Rose',
                    message: messageContent,
                    theme: themeName || 'default',
                    themeColor: appliedThemeColor
                };

                // Save if authentication is already complete OR we are in local dev mode
                if (isAuthReady) {
                    saveFlowerToGarden(flowerData);
                } else {
                    console.warn("Auth not ready. Flower will attempt to save once auth completes via listener or on manual setting (Local Dev).");
                }
                
            }, 1000); 
            
        } else {
            // Update the message to show remaining clicks
            const remaining = requiredClicks - currentClicks;
            initialHeading.textContent = `Keep watering! ${remaining} more click${remaining !== 1 ? 's' : ''} to go!`;
        }
    });

    // Initialize to flower view
    switchView('flower');

});
