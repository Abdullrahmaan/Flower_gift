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
    // If running locally, the environment variables are not defined.
    // We provide a dummy/placeholder configuration to allow Firebase initialization 
    // without crashing, although data saving/loading will not work locally.
    console.warn("Using placeholder Firebase configuration for local development.");
    firebaseConfig = {
        apiKey: "AIzaSy_LOCAL_DEV_KEY",
        authDomain: "local-dev-app.firebaseapp.com",
        projectId: "local-dev-project", // CRITICAL: This was missing in local runs
        storageBucket: "local-dev-app.appspot.com",
        messagingSenderId: "1234567890",
        appId: "1:1234567890:web:localdev"
    };
    // ===================================
}

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Image Preloading Configuration ---
const FLOWER_TYPES = ['Rose', 'Lily', 'Tulip', 'Sunflower', 'Daisy'];
const flowerImages = {};
FLOWER_TYPES.forEach(name => {
    flowerImages[name] = new Image();
    flowerImages[name].src = `${name}.png`;
});

const gardenBackgroundImg = new Image();
gardenBackgroundImg.src = 'garden_background.png';

// --- Global Variables ---
let db;
let auth;
let currentUserId = null;
let isAuthReady = false;
let flowerCollection = []; // Stores the user's garden collection

let currentGiftData = null; // Stores gift data when in gift view

// Check if we are on the builder page or the gift page
const isBuilderPage = window.location.pathname.toLowerCase().includes('builder.html');

// DOM Elements - Builder Page
const senderNameInput = document.getElementById('sender-name');
const recipientNameInput = document.getElementById('recipient-name');
const messageInput = document.getElementById('personal-message-input');
const generateButton = document.getElementById('generate-button');
const copyButton = document.getElementById('copy-button');
const linkText = document.getElementById('link-text');
const feedbackMessage = document.getElementById('feedback-message');
const flowerSelectionButtons = document.getElementById('flower-selection-buttons');

// DOM Elements - Gift Page
const gardenButton = document.getElementById('garden-button');
const flowerView = document.getElementById('flower-view');
const gardenView = document.getElementById('garden-view');
const wateringCan = document.getElementById('watering-can');
const waterCountDisplay = document.getElementById('water-count-display');
const giftReveal = document.getElementById('gift-reveal');
const mainFlower = document.getElementById('main-flower');
const personalMessageEl = document.getElementById('personal-message');
const wateringInstruction = document.getElementById('watering-instruction');
const addToGardenButton = document.getElementById('add-to-garden-button');
const flowerGrid = document.getElementById('flower-grid');
const gardenGridContainer = document.getElementById('garden-grid-container');

// --- Constants ---
const WATER_COUNT_MAX = 5;
let waterCount = 0;
let selectedFlowerType = 'Rose'; // Default selection

// --- Utility Functions ---

/**
 * Gets the base URL for the shareable link.
 * On GitHub Pages, this includes the repository name in the path.
 * In the Immersive, the current origin/pathname is used.
 * @returns {string} The base URL for the Gift.HTML page.
 */
function getGiftPageBaseUrl() {
    // Determine the base URL for the target Gift.HTML page
    // This handles both local testing and GitHub Pages deployment correctly.

    // 1. Get the current origin (e.g., https://user.github.io or http://localhost:8080)
    const origin = window.location.origin;

    // 2. Get the current repository path (e.g., /repo-name/ or just /)
    let pathname = window.location.pathname;
    
    // Clean the pathname to find the root folder (repo name on GitHub Pages)
    // If we are at /repo-name/builder.html, we need /repo-name/Gift.HTML
    if (pathname.includes('/')) {
        // Get path up to the last slash (where the HTML files are located)
        pathname = pathname.substring(0, pathname.lastIndexOf('/') + 1);
    } else {
        pathname = '/';
    }

    // Combine and point to the Gift.HTML file
    return `${origin}${pathname}Gift.HTML`;
}

/**
 * Shows a temporary feedback message to the user.
 * @param {string} message 
 * @param {string} type 'success' or 'error'
 */
function showFeedback(message, type) {
    feedbackMessage.textContent = message;
    feedbackMessage.classList.remove('hidden', 'bg-red-100', 'text-red-700', 'bg-green-100', 'text-green-700');
    if (type === 'success') {
        feedbackMessage.classList.add('bg-green-100', 'text-green-700', 'border-green-300');
    } else if (type === 'error') {
        feedbackMessage.classList.add('bg-red-100', 'text-red-700', 'border-red-300');
    }
    setTimeout(() => {
        feedbackMessage.classList.add('hidden');
    }, 3000);
}

/**
 * Extracts query parameters from the URL.
 * @returns {object}
 */
function getQueryParams() {
    const params = {};
    new URLSearchParams(window.location.search).forEach((value, key) => {
        params[key] = value;
    });
    return params;
}

// --- Firebase and Auth Logic ---

/**
 * Attempts to sign in using the custom token or anonymously if the token is unavailable.
 */
async function attemptSignIn() {
    try {
        if (initialAuthToken) {
            await firebase.auth().signInWithCustomToken(initialAuthToken);
            console.log("Signed in with custom token.");
        } else {
            await firebase.auth().signInAnonymously();
            console.log("Signed in anonymously.");
        }
    } catch (error) {
        console.error("Firebase Auth error during sign-in:", error);
    }
}

/**
 * Gets the path for the gifts collection based on the current user.
 * We store gifts publicly under the app ID so they can be retrieved by anyone with the ID.
 * The user's collection is for the collection of gifts they have received.
 * @returns {string} The Firestore path.
 */
const getGiftDataPath = (giftId) => `artifacts/${appId}/public/data/gifts/${giftId}`;
const getUserGardenPath = () => `artifacts/${appId}/users/${currentUserId}/garden`;

/**
 * Fetches a gift from Firestore.
 * @param {string} giftId 
 * @returns {object | null}
 */
async function fetchGiftData(giftId) {
    if (!db) return null;
    try {
        const docRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('gifts').doc(giftId);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            return { id: docSnap.id, ...docSnap.data() };
        }
        return null;
    } catch (error) {
        console.error("Error fetching gift data:", error);
        return null;
    }
}

/**
 * Adds the currently viewed gift to the user's garden collection.
 */
async function addToGarden() {
    if (!currentGiftData || !currentUserId) {
        showFeedback("Authentication or gift data missing. Cannot save.", 'error');
        return;
    }
    if (currentGiftData.isSaved) {
        showFeedback("This flower is already in your garden!", 'success');
        return;
    }

    try {
        // Use the gift ID as the document ID in the user's garden collection
        const docRef = db.collection('artifacts').doc(appId).collection('users').doc(currentUserId).collection('garden').doc(currentGiftData.id);
        await docRef.set({
            ...currentGiftData,
            receivedAt: firebase.firestore.FieldValue.serverTimestamp(),
            isSaved: true
        });
        currentGiftData.isSaved = true; // Update local state
        showFeedback("Flower saved to your garden successfully!", 'success');
        addToGardenButton.textContent = "Saved to Garden!";
        addToGardenButton.classList.remove('bg-pink-500', 'hover:bg-pink-600');
        addToGardenButton.classList.add('bg-gray-400', 'cursor-not-allowed');

    } catch (error) {
        console.error("Error saving flower to garden:", error);
        showFeedback("Failed to save flower to garden.", 'error');
    }
}

/**
 * Sets up a real-time listener for the user's garden collection.
 */
function setupFlowerCollectionListener() {
    if (!isAuthReady || !currentUserId || isBuilderPage) return;

    const gardenRef = db.collection('artifacts').doc(appId).collection('users').doc(currentUserId).collection('garden');

    gardenRef.onSnapshot(snapshot => {
        flowerCollection = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log("Garden data updated:", flowerCollection.length, "flowers.");
        // Redraw the garden if we are currently viewing it
        if (gardenView.style.display !== 'none') {
            drawGarden(flowerCollection);
        }
    }, error => {
        console.error("Error listening to garden collection:", error);
    });
}

// --- Gift/Flower View Logic ---

/**
 * Switches the main view on the Gift.HTML page.
 * @param {'flower' | 'garden'} viewName 
 */
function switchView(viewName) {
    if (isBuilderPage) return;

    if (viewName === 'flower') {
        flowerView.style.display = 'flex';
        gardenView.style.display = 'none';
        gardenButton.textContent = 'View Garden';
        gardenButton.onclick = () => switchView('garden');
        document.body.style.backgroundColor = '#E0FFFF'; // Light Cyan for flower view
    } else if (viewName === 'garden') {
        flowerView.style.display = 'none';
        gardenView.style.display = 'flex';
        gardenButton.textContent = 'View Gift';
        gardenButton.onclick = () => switchView('flower');
        document.body.style.backgroundColor = '#8FBC8F'; // Darker background for garden
        drawGarden(flowerCollection); // Ensure it's drawn when switching
    }
}

/**
 * Initializes the gift view with data and sets up interaction.
 * @param {object} data The gift data object.
 */
function initializeGiftView(data) {
    currentGiftData = data;

    // Set up initial view
    wateringInstruction.innerHTML = `Water the seed for <span class="text-pink-600">${data.recipientName}</span>, sent by <span class="text-blue-600">${data.senderName}</span>!`;

    // Reset state
    waterCount = 0;
    waterCountDisplay.textContent = `Keep clicking the can! ${WATER_COUNT_MAX} clicks to bloom!`;
    wateringCan.style.display = 'block';
    giftReveal.style.display = 'none';
    addToGardenButton.style.display = 'none'; // Hide until bloomed
    
    // Reset save button state
    addToGardenButton.textContent = "Save to My Garden";
    addToGardenButton.classList.remove('bg-gray-400', 'cursor-not-allowed');
    addToGardenButton.classList.add('bg-pink-500', 'hover:bg-pink-600');

    // Watering Can Click Handler
    wateringCan.onclick = () => {
        if (waterCount < WATER_COUNT_MAX) {
            waterCount++;
            const remaining = WATER_COUNT_MAX - waterCount;
            waterCountDisplay.textContent = `Keep clicking! ${remaining} clicks remaining!`;
            wateringCan.classList.add('shake');
            setTimeout(() => wateringCan.classList.remove('shake'), 500);

            if (waterCount >= WATER_COUNT_MAX) {
                bloomFlower(data);
            }
        }
    };

    addToGardenButton.onclick = addToGarden;
    
    // Ensure flower view is visible if we loaded data
    document.getElementById('status-message').style.display = 'none';
    flowerView.style.display = 'flex';
    switchView('flower');
}

/**
 * Transition the view from watering to the revealed flower.
 * @param {object} data The gift data.
 */
function bloomFlower(data) {
    wateringCan.style.display = 'none';
    document.getElementById('initial-state').style.display = 'none'; // Hide the entire initial state container

    mainFlower.src = flowerImages[data.flowerType].src;
    mainFlower.alt = `${data.flowerType} Flower`;
    personalMessageEl.textContent = data.personalMessage || "No message provided.";

    giftReveal.style.display = 'block';
    addToGardenButton.style.display = 'inline-flex'; // Show save button

    // Check if flower is already saved (requires user ID to be ready)
    if (isAuthReady && currentUserId) {
         const docRef = db.collection('artifacts').doc(appId).collection('users').doc(currentUserId).collection('garden').doc(data.id);
         docRef.get().then(docSnap => {
             if (docSnap.exists) {
                currentGiftData.isSaved = true;
                addToGardenButton.textContent = "Saved to Garden!";
                addToGardenButton.classList.remove('bg-pink-500', 'hover:bg-pink-600');
                addToGardenButton.classList.add('bg-gray-400', 'cursor-not-allowed');
             }
         }).catch(e => console.error("Could not check if saved:", e));
    }
}

/**
 * Draws the current collection of flowers in the garden grid.
 * @param {Array<object>} collection The array of flower gift objects.
 */
function drawGarden(collection) {
    flowerGrid.innerHTML = ''; // Clear previous cards
    const gardenEmptyMessage = document.getElementById('garden-empty-message');

    if (collection.length === 0) {
        gardenEmptyMessage.style.display = 'block';
        return;
    }
    gardenEmptyMessage.style.display = 'none';

    collection.forEach(flower => {
        const flowerType = flower.flowerType || 'Rose';
        const card = document.createElement('div');
        card.className = 'flower-card';
        card.innerHTML = `
            <img src="${flowerImages[flowerType].src}" alt="${flowerType}" onerror="this.src='Rose.png'">
            <h3 class="text-xl font-semibold text-gray-800">${flowerType}</h3>
            <p class="text-sm text-gray-500 mt-1">From: ${flower.senderName || 'Anonymous'}</p>
            <div class="message-preview mt-3">
                ${flower.personalMessage || 'No personal message.'}
            </div>
        `;
        flowerGrid.appendChild(card);
    });
}

/**
 * Checks the URL for a giftId and loads the corresponding flower if found.
 */
async function checkUrlForFlowerId() {
    const params = getQueryParams();
    if (params.giftId) {
        document.getElementById('status-message').textContent = 'Loading gift...';
        document.getElementById('status-message').style.display = 'block';

        const giftData = await fetchGiftData(params.giftId);

        if (giftData) {
            giftData.id = params.giftId; // Ensure the ID is attached
            initializeGiftView(giftData);
        } else {
            document.getElementById('status-message').textContent = 'Gift not found or has expired.';
            document.getElementById('status-message').style.display = 'block';
            flowerView.style.display = 'none';
        }
    } else {
        // If no gift ID and we are on Gift.HTML, default to garden view
        switchView('garden');
    }
}


// --- Builder Logic ---

/**
 * Renders the flower selection buttons in the builder view.
 */
function renderFlowerSelection() {
    if (!flowerSelectionButtons) return; // Only run on builder.html

    flowerSelectionButtons.innerHTML = '';

    FLOWER_TYPES.forEach(type => {
        const button = document.createElement('button');
        button.className = 'flower-button p-3 rounded-xl border-2 font-medium transition duration-150 shadow-md';
        button.textContent = type;
        button.setAttribute('data-flower', type);

        button.onclick = () => {
            selectedFlowerType = type;
            // Visually update buttons
            document.querySelectorAll('.flower-button').forEach(btn => {
                btn.classList.remove('bg-[#6495ED]', 'text-white', 'border-[#6495ED]');
                btn.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
            });
            button.classList.add('bg-[#6495ED]', 'text-white', 'border-[#6495ED]');
            button.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
        };

        flowerSelectionButtons.appendChild(button);
    });

    // Trigger click on the default type to set initial style
    const defaultButton = flowerSelectionButtons.querySelector(`[data-flower="${selectedFlowerType}"]`);
    if (defaultButton) {
        defaultButton.click();
    }
}

/**
 * Handles the generation of the gift link and saving the gift data.
 */
async function handleGenerateGift() {
    const senderName = senderNameInput.value.trim() || 'A Secret Admirer';
    const recipientName = recipientNameInput.value.trim() || 'A Kind Soul';
    const personalMessage = messageInput.value.trim() || 'Wishing you the best.';

    if (!isAuthReady || !db) {
        showFeedback("App is still initializing. Please wait a moment.", 'error');
        return;
    }

    if (personalMessage.length > 500) {
         showFeedback("Message is too long (max 500 characters).", 'error');
         return;
    }

    const giftData = {
        senderName,
        recipientName,
        personalMessage,
        flowerType: selectedFlowerType,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        // Save the gift data to a new document in the public 'gifts' collection
        const giftsRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('gifts');
        const newGiftDoc = await giftsRef.add(giftData);
        const giftId = newGiftDoc.id;
        
        // --- FIX APPLIED HERE ---
        // Construct the shareable link using the calculated base URL for the Gift.HTML page
        const giftPageBaseUrl = getGiftPageBaseUrl();
        const shareableLink = `${giftPageBaseUrl}?giftId=${giftId}`;
        // --- END FIX ---

        // Display the link and copy button
        linkText.textContent = shareableLink;
        linkText.classList.remove('hidden');
        copyButton.classList.remove('hidden');

        showFeedback("Gift link generated successfully!", 'success');
        console.log("Generated Link:", shareableLink);

    } catch (error) {
        console.error("Error creating gift:", error);
        showFeedback("Error creating gift. Check console for details.", 'error');
    }
}

/**
 * Copies the generated link to the clipboard.
 */
function handleCopyLink() {
    const linkToCopy = linkText.textContent;
     // Use temporary textarea for copy compatibility
    const tempInput = document.createElement('textarea');
    tempInput.value = linkToCopy;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    showFeedback("Link copied to clipboard!", 'success');
}


// --- Initialization ---

window.onload = function() {
    // Initialize Firebase
    if (Object.keys(firebaseConfig).length > 0) {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
    } else {
        console.error('Firebase configuration not found.');
        return;
    }
    
    // Set up Auth State Listener
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            currentUserId = user.uid;
            isAuthReady = true;
            console.log("Auth State Changed: User logged in.", currentUserId);
            
            // Only set up listeners and views based on the current page
            if (isBuilderPage) {
                renderFlowerSelection();
            } else {
                setupFlowerCollectionListener();
                checkUrlForFlowerId();
            }
            
        } else {
            console.log("Auth State Changed: No user logged in. Attempting sign-in...");
            attemptSignIn(); 
        }
    });

    // Event listeners
    if (isBuilderPage) {
        generateButton.onclick = handleGenerateGift;
        copyButton.onclick = handleCopyLink;
    } else {
        gardenButton.onclick = () => switchView('garden'); // Initial assignment
    }
    
    // Re-draw the garden once all assets are loaded (including the new background image)
    let assetsLoaded = 0;
    const totalAssets = FLOWER_TYPES.length + 1; // +1 for the background image
    
    const checkAssets = () => {
        assetsLoaded++;
        if (assetsLoaded === totalAssets) {
            // Once all images are loaded, ensure the garden is drawn correctly
            if (!isBuilderPage && flowerCollection.length > 0) {
                 drawGarden(flowerCollection);
            }
        }
    };
    
    // Load background image
    if(gardenBackgroundImg.complete) {
        checkAssets();
    } else {
        gardenBackgroundImg.onload = checkAssets;
        gardenBackgroundImg.onerror = () => {
            console.error(`Failed to load image: garden_background.png`);
            checkAssets(); // Count as loaded even if failed
        }
    }

    // Load flower images
    FLOWER_TYPES.forEach(name => {
        if(flowerImages[name].complete) {
            checkAssets();
        } else {
            flowerImages[name].onload = checkAssets;
            flowerImages[name].onerror = () => {
                console.error(`Failed to load image: ${name}.png`);
                checkAssets(); // Count as loaded even if failed
            }
        }
    });
};
