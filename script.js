// =========================================================================
// SECTION 1: CONFIGURATION & GLOBAL SETUP
// =========================================================================

// Global Firebase variables provided by the environment
const appId = 'github-pages-flower-gift-app'; // Fixed identifier for the app

/**
 * CRITICAL STEP: Paste your actual Firebase configuration here.
 * This is only a placeholder/fallback for local development.
 * Saving will fail if these placeholder values are not replaced.
 */
let firebaseConfig = {
    apiKey: "YOUR_API_KEY", // <-- REPLACE THIS WITH YOUR ACTUAL API KEY
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const initialAuthToken = null; // Assuming GitHub Pages deployment

// Initialize Firebase App and Services (using the Compat SDK loaded in gift.html)
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
firebase.firestore.setLogLevel('debug');

// Global State
let userId = null;
let isAuthReady = false;
let flowerCollection = []; // Stores all flowers loaded from the user's garden
let currentView = 'flower'; // Tracks whether 'flower' or 'garden' is active

// Garden Constants
const PIXEL_SIZE = 40; // Size of the grid cell (e.g., 40x40px)
const GARDEN_WIDTH_CELLS = 20;
const GARDEN_HEIGHT_CELLS = 10;
const FLOWER_TYPES = ['Rose', 'Lily', 'Tulip', 'Daisy', 'Orchid']; // Must match asset filenames

// DOM/Canvas Elements
const canvas = document.getElementById('garden-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;

// =========================================================================
// SECTION 2: ASSET PRELOADING (Images)
// =========================================================================

const flowerImages = {};
const gardenBackgroundImg = new Image();
gardenBackgroundImg.src = 'garden_background.png';

let assetsLoaded = 0;
const totalAssets = FLOWER_TYPES.length + 1; // +1 for the background image

const checkAssets = () => {
    assetsLoaded++;
    if (assetsLoaded === totalAssets) {
        // Once all images are loaded, if we have data, redraw the garden
        if (flowerCollection.length > 0) {
             drawGarden(flowerCollection);
        }
    }
};

// Load images and use a promise-like counter to know when they are all ready
[gardenBackgroundImg, ...FLOWER_TYPES.map(name => flowerImages[name] = new Image())].forEach((img, index) => {
    const name = index === 0 ? 'garden_background' : FLOWER_TYPES[index - 1];
    img.src = index === 0 ? 'garden_background.png' : `${name}.png`;

    if (img.complete) {
        checkAssets();
    } else {
        img.onload = checkAssets;
        img.onerror = () => {
            console.error(`Failed to load image: ${name}.png`);
            checkAssets(); // Count as loaded even if failed
        }
    }
});

// =========================================================================
// SECTION 3: UTILITY FUNCTIONS
// =========================================================================

/**
 * Converts a Firestore Timestamp object to a readable date string.
 */
function formatTimestamp(timestamp) {
    if (timestamp && typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toLocaleDateString();
    }
    return 'Unknown Date';
}

/**
 * Creates and animates a single sparkle element.
 * (This completes the implementation referenced in the gift reveal logic)
 */
function createSparkle() {
    const sparkleOverlay = document.getElementById('sparkle-overlay');
    if (!sparkleOverlay) return;

    const sparkle = document.createElement('div');
    sparkle.className = 'sparkle';
    
    // Random position within the flower area
    const flowerRect = document.getElementById('main-flower').getBoundingClientRect();
    const x = flowerRect.left + Math.random() * flowerRect.width;
    const y = flowerRect.top + flowerRect.height * 0.2; // Start above the base
    
    sparkle.style.left = `${x}px`;
    sparkle.style.top = `${y}px`;
    sparkle.style.opacity = '1';
    sparkle.style.animationDuration = `${1.5 + Math.random() * 1.5}s`; // 1.5s to 3s
    sparkle.style.backgroundColor = `hsl(${Math.random() * 60 + 240}, 100%, 80%)`; // Blue/Pink hue
    sparkle.style.transform = `translateY(${-(50 + Math.random() * 50)}px)`;

    sparkleOverlay.appendChild(sparkle);

    // Remove the sparkle after its animation is done
    setTimeout(() => {
        sparkle.remove();
    }, 3000); 
}

/**
 * Continuously generates sparkles for the blooming effect.
 */
function startSparkling() {
    // Only run if sparkle is enabled
    if (urlParams.get('sparkle') === 'true') {
        createSparkle();
        // Generate a new sparkle every 100-300ms
        setTimeout(startSparkling, 100 + Math.random() * 200); 
    }
}

// =========================================================================
// SECTION 4: FIREBASE & DATA MANAGEMENT
// =========================================================================

/**
 * Attempts to sign in the user anonymously if they aren't already signed in.
 * This assigns a unique, permanent userId for the garden collection.
 */
const attemptSignIn = () => {
    if (firebaseConfig.projectId === "YOUR_PROJECT_ID") {
         userId = crypto.randomUUID();
         isAuthReady = true;
         console.warn("Saving DISABLED: Please configure Firebase with your keys.");
         return;
    }
    // Sign in anonymously if no user is found
    auth.signInAnonymously().catch(e => console.error("Anonymous sign-in failed:", e));
};

/**
 * Listens for authentication state changes to get the user ID.
 * This is the FIRST function called after DOMContentLoaded.
 */
auth.onAuthStateChanged((user) => {
    if (user) {
        userId = user.uid;
        isAuthReady = true;
        console.log("Firebase Auth Ready. User ID:", userId);
        
        // If the flower was already bloomed before auth completed, save it now.
        const flowerWasRevealed = document.getElementById('gift-reveal').style.opacity === '1';
        if (flowerWasRevealed) {
             const flowerData = { /* data is already captured in main logic */ };
             saveFlowerToGarden(flowerData);
        }
        
        // Start loading the garden data immediately after authentication
        loadGarden();
    } else {
         console.log("Firebase Auth State Changed: No user logged in. Attempting sign-in...");
         attemptSignIn(); 
    }
});

/**
 * Saves the bloomed flower data to the user's private collection in Firestore.
 */
async function saveFlowerToGarden(flowerData) {
    if (!userId || firebaseConfig.projectId === "YOUR_PROJECT_ID") {
        console.error("Cannot save: User not authenticated or config missing.");
        return;
    }
    
    // Find a random, unique grid position (x, y) for the new flower
    let x, y, attempts = 0, positionTaken;
    do {
        x = Math.floor(Math.random() * GARDEN_WIDTH_CELLS);
        y = Math.floor(Math.random() * GARDEN_HEIGHT_CELLS);
        positionTaken = flowerCollection.some(flower => flower.gridX === x && flower.gridY === y);
        attempts++;
        if (attempts > GARDEN_WIDTH_CELLS * GARDEN_HEIGHT_CELLS * 2) {
             console.warn("Garden is full! Could not find an empty spot.");
             return; 
        }
    } while (positionTaken);
    
    flowerData.gridX = x;
    flowerData.gridY = y;
    
    try {
        const collectionRef = db.collection(`artifacts/${appId}/users/${userId}/flowers`);
        
        const docRef = await collectionRef.add({ 
            ...flowerData,
            timestamp: firebase.firestore.FieldValue.serverTimestamp() 
        });
        
        await docRef.update({ id: docRef.id }); // Add the document ID to the document itself

        console.log("Flower saved to garden with ID:", docRef.id);
    } catch (e) {
        console.error("Error saving flower to garden: ", e);
    }
}

/**
 * Loads the garden data using a real-time listener (onSnapshot).
 */
function loadGarden() {
    if (!isAuthReady || !userId) return;

    const flowerCollectionRef = db.collection(`artifacts/${appId}/users/${userId}/flowers`);

    // Real-time listener: updates 'flowerCollection' and re-draws the canvas on every change
    flowerCollectionRef.onSnapshot((snapshot) => {
        const flowers = [];
        snapshot.forEach((doc) => {
            flowers.push(doc.data());
        });
        
        flowerCollection = flowers; 
        
        // Only attempt to draw if assets are loaded
        if (assetsLoaded === totalAssets) {
             drawGarden(flowerCollection);
        } else {
             console.log("Assets still loading. Will draw garden upon completion.");
        }
        
    }, (error) => {
        console.error("Error listening to garden data: ", error);
        document.getElementById('pixel-garden-container').innerHTML = '<p style="text-align: center; padding: 20px; color: white;">Failed to load garden data. Check Firebase configuration.</p>';
    });
}


// =========================================================================
// SECTION 5: CANVAS & GARDEN RENDERING
// =========================================================================

/**
 * Draws the pixel art garden grid and plots the flowers.
 */
function drawGarden(flowers) {
    if (!ctx) return;

    canvas.width = GARDEN_WIDTH_CELLS * PIXEL_SIZE;
    canvas.height = GARDEN_HEIGHT_CELLS * PIXEL_SIZE;

    // 1. Draw the Background Pattern
    if (gardenBackgroundImg.complete) {
        const pattern = ctx.createPattern(gardenBackgroundImg, 'repeat');
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#654321'; // Fallback soil color
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    // 2. Plot the Flowers
    flowers.forEach(flower => {
        const x = flower.gridX * PIXEL_SIZE;
        const y = flower.gridY * PIXEL_SIZE;
        const img = flowerImages[flower.flowerName];

        if (img && img.complete) {
            ctx.drawImage(img, x, y, PIXEL_SIZE, PIXEL_SIZE);
        } else if (img) {
            // Placeholder if image fails to load
            ctx.fillStyle = flower.themeColor || '#FFFFFF';
            ctx.fillRect(x + PIXEL_SIZE/4, y + PIXEL_SIZE/4, PIXEL_SIZE/2, PIXEL_SIZE/2);
        }
        
        // Store the pixel boundaries for click detection (re-use the array)
        flower.minX = x;
        flower.minY = y;
        flower.maxX = x + PIXEL_SIZE;
        flower.maxY = y + PIXEL_SIZE;
    });
}

/**
 * Handles clicks on the canvas to detect which flower was clicked.
 */
function handleCanvasClick(event) {
    const rect = canvas.getBoundingClientRect();
    
    // Calculate relative click position (adjust for CSS scaling)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    
    // Check for collision with flower boundaries
    for (const flower of flowerCollection) {
        if (x >= flower.minX && x < flower.maxX && y >= flower.minY && y < flower.maxY) {
            showFlowerModal(flower);
            return;
        }
    }
}

/**
 * Shows the modal with details of the clicked flower.
 */
function showFlowerModal(flower) {
    const modal = document.getElementById('flower-modal');
    document.getElementById('modal-flower-name').textContent = flower.flowerName;
    document.getElementById('modal-flower-date').textContent = `Received: ${formatTimestamp(flower.timestamp)}`;
    document.getElementById('modal-flower-message').textContent = flower.message;
    modal.classList.remove('hidden');
}

// =========================================================================
// SECTION 6: VIEW SWITCHING & MAIN INITIALIZATION
// =========================================================================

/**
 * Toggles visibility between the single flower view and the garden view.
 */
function switchView(viewName) {
    const flowerView = document.getElementById('flower-view');
    const gardenView = document.getElementById('garden-view');
    const gardenButton = document.getElementById('garden-button');
    
    if (viewName === 'flower') {
        flowerView.style.display = 'block';
        gardenView.style.display = 'none';
        gardenButton.textContent = 'View Garden';
        document.body.style.justifyContent = 'center'; 
        // Restore theme background
        const themeName = urlParams.get('theme');
        document.body.style.backgroundColor = themeColors[themeName] || themeColors['default'];
        currentView = 'flower';
    } else if (viewName === 'garden') {
        flowerView.style.display = 'none';
        gardenView.style.display = 'block';
        gardenButton.textContent = 'Return to Flower';
        document.body.style.justifyContent = 'flex-start';
        document.body.style.backgroundColor = '#4B5320'; // Deep forest green for garden
        currentView = 'garden';
    }
}

// Global variable to store URL parameters
const urlParams = new URLSearchParams(window.location.search);
const themeColors = {
    'default': '#f7f3e8',  
    'warm': '#ffead6',     
    'cool': '#e5f3ff',     
    'vibrant': '#e7ffe7',
    'lavender': '#f3e8ff' 
};

/**
 * Handles the main flower blooming interaction.
 */
const revealGift = (flowerData) => {
    const initialState = document.getElementById('initial-state');
    const giftReveal = document.getElementById('gift-reveal');
    const mainFlower = document.getElementById('main-flower');
    const backgroundMusic = document.getElementById('background-music');
    const sparkleOverlay = document.getElementById('sparkle-overlay'); 
    const sparkleEnabled = urlParams.get('sparkle') === 'true';

    initialState.style.display = 'none';
    giftReveal.style.opacity = '1';
    mainFlower.style.transform = 'scale(1)'; 

    if (backgroundMusic.src) {
        backgroundMusic.play().catch(e => console.error("Error playing music:", e));
    }

    if (sparkleEnabled) {
        sparkleOverlay.classList.remove('hidden');
        startSparkling();
    }

    if (isAuthReady) {
        saveFlowerToGarden(flowerData);
    }
};


/**
 * Initializes all gift-related elements and click handlers.
 */
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Element Selection ---
    const wateringCan = document.getElementById('watering-can');
    const mainFlower = document.getElementById('main-flower');
    const personalMessage = document.getElementById('personal-message');
    const backgroundMusic = document.getElementById('background-music');
    const initialHeading = document.getElementById('watering-instruction');
    const gardenButton = document.getElementById('garden-button');
    const modal = document.getElementById('flower-modal');
    const closeModalButton = document.querySelector('#flower-modal .close-button');
    
    if (!wateringCan || !initialHeading) return; // Critical elements missing

    // --- Retrieve URL Parameters ---
    let requiredClicks = parseInt(urlParams.get('clicks')) || 3;
    let currentClicks = 0; 
    const flowerName = urlParams.get('flower') || 'Rose';
    const messageText = urlParams.get('message');
    const musicUrl = urlParams.get('music');
    
    const messageContent = messageText ? decodeURIComponent(messageText) : "No message provided. Still a beautiful flower!";
    const themeName = urlParams.get('theme');
    const appliedThemeColor = themeColors[themeName] || themeColors['default'];

    // --- Apply Initial URL Settings ---
    mainFlower.src = `${flowerName}.png`; 
    mainFlower.alt = `A beautiful pixel art ${flowerName}`;
    personalMessage.textContent = messageContent; 
    document.body.style.backgroundColor = appliedThemeColor;

    if (musicUrl) {
        backgroundMusic.src = decodeURIComponent(musicUrl);
    }
    
    // --- Data Object for Saving ---
    const flowerData = {
        flowerName: flowerName,
        message: messageContent,
        theme: themeName || 'default',
        themeColor: appliedThemeColor
    };

    // --- Watering Click Handler ---
    wateringCan.addEventListener('click', () => {
        if (currentClicks < requiredClicks) {
            currentClicks++;
            // Visual feedback for click
            wateringCan.style.transform = 'translateY(10px) rotate(-10deg)';
            setTimeout(() => wateringCan.style.transform = 'translateY(0) rotate(0deg)', 100);
            
            const remaining = requiredClicks - currentClicks;
            if (remaining > 0) {
                initialHeading.textContent = `Keep clicking! Only ${remaining} more time${remaining === 1 ? '' : 's'} to bloom the flower.`;
            } else {
                revealGift(flowerData);
            }
        }
    });

    // --- Initial Text Setup ---
    const clickText = requiredClicks === 1 ? "once" : `${requiredClicks} times`;
    initialHeading.textContent = `This gift needs your touch! Click the can ${clickText} to water it.`;
    
    // --- Garden Button Handler ---
    gardenButton.addEventListener('click', () => {
        switchView(currentView === 'flower' ? 'garden' : 'flower');
    });
    
    // --- Canvas and Modal Handlers ---
    if (canvas) {
        canvas.addEventListener('click', handleCanvasClick);
        drawGarden([]); // Initial draw to set up size and background
    }
    if (closeModalButton) {
        closeModalButton.addEventListener('click', () => modal.classList.add('hidden'));
    }
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    }

    // Ensure initial view state is correct
    switchView('flower');
});
