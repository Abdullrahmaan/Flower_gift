// --- 1. FIREBASE CONFIGURATION (CRITICAL FOR GITHUB DEPLOYMENT) ---
// IMPORTANT: The environment variables (__firebase_config, __initial_auth_token)
// only exist in the Canvas environment. For GitHub Pages, you MUST use your own
// Firebase project configuration here. Replace the placeholder values below.
const GITHUB_FIREBASE_CONFIG = {
    // Replace with your actual credentials from the Firebase console!
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Check if running in the Canvas environment or on GitHub
const isCanvasEnvironment = typeof __firebase_config !== 'undefined';

let firebaseConfig = GITHUB_FIREBASE_CONFIG;
let initialAuthToken = null;
const appId = GITHUB_FIREBASE_CONFIG.projectId || 'default-app-id'; // Use projectId as app ID fallback

if (isCanvasEnvironment) {
    // Load config from Canvas environment if available
    try {
        firebaseConfig = JSON.parse(__firebase_config);
        initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        console.log("Using Canvas Firebase configuration.");
    } catch (e) {
        console.error("Failed to parse __firebase_config from Canvas environment:", e);
    }
} else {
    console.log("Using GitHub/Local Firebase configuration.");
}

// --- 2. FIREBASE INITIALIZATION ---
// Note: We use the v8.x compat library imports in gift.html for simplicity.
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
// Set logging level for debugging Firebase
firebase.firestore.setLogLevel('debug');


// --- 3. GLOBAL VARIABLES & UTILS ---
const FLOWER_TYPES = ['Rose', 'Tulip', 'Daisy', 'Lily', 'Sunflower'];
const THEME_COLORS = {
    'spring': '#E6E6FA', // Light Lavender
    'summer': '#B0E0E6', // Powder Blue
    'autumn': '#FFDAB9', // Peach Puff
    'winter': '#ADD8E6'  // Light Blue
};
const FLOWER_SIZE = 48; // Base pixel size for flower image in the garden canvas

let flowerCollection = []; // Stores the user's received flowers
let currentUserId = null;
let isAuthReady = false;

// Determine which page we are on
const isBuilderPage = window.location.pathname.includes('index.html') || window.location.pathname.includes('builder.html');

// DOM Elements
const gardenButton = document.getElementById('garden-button');
const flowerView = document.getElementById('flower-view');
const gardenView = document.getElementById('garden-view');
const gardenCanvas = document.getElementById('garden-canvas');
const flowerModal = document.getElementById('flower-modal');
const wateringCan = document.getElementById('watering-can');
const mainFlowerPre = document.getElementById('main-flower-pre');

// Asset Storage
const flowerImages = {};
FLOWER_TYPES.forEach(name => {
    flowerImages[name] = new Image();
    // Assuming image files are in the same directory as the script.
    flowerImages[name].src = `${name}.png`;
});
const gardenBackgroundImg = new Image();
gardenBackgroundImg.src = 'garden_background.png';

// --- 4. AUTHENTICATION ---

/** Attempts to sign in using the custom token or anonymously. */
const attemptSignIn = async () => {
    try {
        if (initialAuthToken) {
            await auth.signInWithCustomToken(initialAuthToken);
        } else {
            await auth.signInAnonymously();
        }
        console.log("Sign-in attempt successful.");
    } catch (error) {
        console.error("Firebase Sign-In Error:", error);
    }
};

/**
 * Gets the reference for the user's private flowers collection.
 * @param {string} uid The user ID.
 */
const getUserFlowersCollectionRef = (uid) => {
    return db.collection('artifacts').doc(appId).collection('users').doc(uid).collection('flowers');
};

// --- 5. DATA HANDLING ---

/**
 * Sets up a real-time listener for the user's flower collection.
 * @param {string} uid The current user ID.
 */
const setupFlowerCollectionListener = (uid) => {
    const flowersRef = getUserFlowersCollectionRef(uid);

    flowersRef.onSnapshot(snapshot => {
        flowerCollection = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Use the Firestore document ID as the unique giftId
            flowerCollection.push({ id: doc.id, ...data });
        });

        console.log(`Garden updated. Total flowers: ${flowerCollection.length}`);
        
        // Re-draw the garden whenever the collection changes
        if (!isBuilderPage && gardenCanvas && isAuthReady) {
            drawGarden(flowerCollection);
        }
        
        // Update the garden button text
        updateGardenButton(flowerCollection.length);
    }, error => {
        console.error("Error setting up flower collection listener:", error);
    });
};

/**
 * Saves a new flower gift to the user's collection.
 * @param {object} giftData - The data of the flower gift.
 */
const saveNewFlower = async (giftData) => {
    if (!currentUserId) {
        // Should not happen if auth is working, but as a safeguard
        console.error("Cannot save gift: User not authenticated.");
        return;
    }
    try {
        const flowersRef = getUserFlowersCollectionRef(currentUserId);
        const newDocRef = await flowersRef.add({
            ...giftData,
            receivedAt: firebase.firestore.FieldValue.serverTimestamp() // Firestore timestamp
        });
        console.log("New flower saved with ID:", newDocRef.id);
    } catch (e) {
        console.error("Error saving new flower:", e);
    }
};

// --- 6. URL & GIFT PARSING (For gift.html) ---

/** Parses the URL for flower data and processes the gift. */
const checkUrlForFlowerId = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const flowerId = urlParams.get('id');
    const message = urlParams.get('m');
    const flowerType = urlParams.get('f');
    const clicksNeeded = parseInt(urlParams.get('c')) || 3;
    const theme = urlParams.get('t') || 'spring';
    const sparkle = urlParams.get('s') === 'true';

    // Set page theme
    document.body.className = ''; // Clear previous classes
    document.body.classList.add(`theme-${theme}`);
    
    // Check if this URL is an encoded link from the builder (no Firebase ID)
    if (message && flowerType) {
        // This is a direct gift link, set up the interactive watering process
        setupInteractiveGift(flowerType, decodeURIComponent(message), clicksNeeded, sparkle);
    } else if (flowerId && currentUserId) {
        // This is a previously saved flower link (e.g., sharing from the garden)
        // We'll rely on the onSnapshot listener to display the garden, 
        // but for now, we can show a placeholder if needed.
        console.log(`Flower ID ${flowerId} found in URL. Displaying garden...`);
    } else if (!flowerId && !message && !isBuilderPage) {
        // Normal access to gift.html with no parameters, default to garden view if flowers exist
        switchView('garden');
    }
};

// --- 7. GIFT BUILDER LOGIC (For index.html) ---

/** Generates the shareable gift link. */
const handleGenerateGift = () => {
    const messageInput = document.getElementById('message');
    const flowerSelect = document.getElementById('flower-select');
    const themeSelect = document.getElementById('theme-select');
    const clicksInput = document.getElementById('clicks');
    
    const linkTextElement = document.getElementById('link-text');
    const copyButton = document.getElementById('copy-button');
    const generateButton = document.getElementById('generate-button');
    
    const message = encodeURIComponent(messageInput.value.trim() || 'A gift for you!');
    const flower = flowerSelect.value;
    const theme = themeSelect.value;
    const clicks = Math.max(1, Math.min(10, parseInt(clicksInput.value) || 3)); // Clamp clicks

    // --- CRITICAL FIX: Base URL Calculation for GitHub Pages ---
    // The link must point to the 'gift.html' file on the public GitHub Pages URL.
    // Assuming 'index.html' (or builder.html) and 'gift.html' are in the same folder.
    let baseUrl = window.location.href.replace(/index\.html$|builder\.html$/i, 'gift.html');

    // Ensure it ends cleanly at gift.html before adding parameters
    if (!baseUrl.endsWith('gift.html')) {
        // If we were on 'https://user.github.io/repo/', this ensures 'gift.html' is added
        if (baseUrl.endsWith('/')) {
            baseUrl += 'gift.html';
        } else {
             // If we were on 'https://user.github.io/repo', this ensures '/gift.html' is added
            baseUrl += '/gift.html';
        }
    }
    // --- END CRITICAL FIX ---

    // Construct the final gift URL
    const link = `${baseUrl}?m=${message}&f=${flower}&c=${clicks}&t=${theme}&s=true`;

    linkTextElement.textContent = link;
    linkTextElement.classList.remove('hidden');
    copyButton.classList.remove('hidden');

    // Update button text and style
    generateButton.textContent = 'Link Generated! Copy Below.';
    generateButton.classList.add('bg-green-500', 'hover:bg-green-600');
    generateButton.classList.remove('bg-[#7B68EE]', 'hover:bg-[#6A5ACD]');
};

/** Handles copying the link to the clipboard. */
const handleCopyLink = () => {
    const linkTextElement = document.getElementById('link-text');
    const copyButton = document.getElementById('copy-button');
    const linkToCopy = linkTextElement.textContent;

    // Simple clipboard copy logic using execCommand for better iFrame compatibility
    if (document.execCommand('copy')) {
        const originalText = copyButton.textContent;
        copyButton.textContent = 'Copied!';
        copyButton.classList.add('bg-green-500');
        copyButton.classList.remove('bg-[#6495ED]');

        setTimeout(() => {
            copyButton.textContent = originalText;
            copyButton.classList.remove('bg-green-500');
            copyButton.classList.add('bg-[#6495ED]');
        }, 1500);
    } else {
        console.error("Copy failed. Please manually select and copy the text.");
    }
};

// --- 8. GIFT INTERACTION (For gift.html) ---

let currentFlowerData = null;
let clicksRemaining = 0;
let waterDrops = [];

/** Creates a temporary water drop effect. */
const createWaterDrop = (x, y) => {
    const drop = document.createElement('div');
    drop.classList.add('water-drop');
    drop.style.left = `${x}px`;
    drop.style.top = `${y}px`;
    document.body.appendChild(drop);
    // Remove the element after the animation finishes
    drop.addEventListener('animationend', () => drop.remove());
};

/** Updates the flower image state based on clicksRemaining. */
const updateFlowerState = () => {
    const progress = 1 - (clicksRemaining / currentFlowerData.clicksNeeded);
    const scale = 0.5 + (0.5 * progress); // Scale from 0.5 to 1.0
    const opacity = 0.5 + (0.5 * progress); // Opacity from 0.5 to 1.0

    mainFlowerPre.style.transform = `scale(${scale})`;
    mainFlowerPre.style.opacity = opacity;

    // Update instruction text
    const instructionText = document.getElementById('watering-instruction');
    if (clicksRemaining > 0) {
        instructionText.textContent = `Water ${clicksRemaining} more time${clicksRemaining === 1 ? '' : 's'} to make it bloom!`;
    } else {
        instructionText.textContent = `It's ready to bloom!`;
    }
};

/** Handles the watering can click interaction. */
const handleWaterClick = async (event) => {
    if (clicksRemaining <= 0) {
        // If already bloomed/ready, proceed to reveal
        revealGift();
        return;
    }
    
    // Create water drop effect near the click point
    const rect = wateringCan.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    createWaterDrop(x, y);

    // Apply simple visual 'jiggle' effect
    wateringCan.classList.add('water-jiggle');
    setTimeout(() => {
        wateringCan.classList.remove('water-jiggle');
    }, 200);

    // Decrement clicks and update state
    clicksRemaining--;
    updateFlowerState();

    if (clicksRemaining <= 0) {
        // Ready for reveal
        revealGift();
    }
};

/** Reveals the final gift and saves it to the garden. */
const revealGift = async () => {
    if (!currentFlowerData || currentFlowerData.isRevealed) return;
    currentFlowerData.isRevealed = true;

    // Hide initial state and show reveal state
    document.getElementById('initial-state').classList.add('hidden');
    document.getElementById('gift-reveal').classList.remove('hidden');

    // Update main flower image and message
    const mainFlowerImg = document.getElementById('main-flower');
    mainFlowerImg.src = `${currentFlowerData.flowerType}.png`;
    document.getElementById('personal-message').textContent = currentFlowerData.message;
    
    // Apply sparkle effect if enabled
    if (currentFlowerData.sparkleEnabled) {
        const sparkleOverlay = document.getElementById('sparkle-overlay');
        sparkleOverlay.classList.remove('hidden');
        // Generate a burst of sparkles
        for (let i = 0; i < 30; i++) {
            createSparkle(sparkleOverlay);
        }
        // Keep generating a few random sparkles for a constant shimmer
        setInterval(() => {
            if (Math.random() < 0.5) createSparkle(sparkleOverlay);
        }, 100);
    }
    
    // Play music (using Tone.js which is assumed to be imported in gift.html)
    try {
        if (typeof Tone !== 'undefined') {
            const synth = new Tone.Synth().toDestination();
            synth.triggerAttackRelease("C4", "8n");
            setTimeout(() => synth.triggerAttackRelease("E4", "8n"), 200);
            setTimeout(() => synth.triggerAttackRelease("G4", "4n"), 400);
        } else {
            console.warn("Tone.js not loaded. Skipping sound effect.");
        }
    } catch (e) {
        console.error("Error playing sound with Tone.js:", e);
    }

    // Save the fully revealed gift to Firestore
    await saveNewFlower(currentFlowerData);
};

/** Sets up the initial state for the interactive gift. */
const setupInteractiveGift = (flowerType, message, clicksNeeded, sparkleEnabled) => {
    // Hide the garden button while in gift view
    gardenButton.classList.add('hidden');

    currentFlowerData = {
        flowerType,
        message,
        clicksNeeded,
        sparkleEnabled,
        isRevealed: false
    };
    clicksRemaining = clicksNeeded;
    
    // Set up the initial flower image
    mainFlowerPre.src = `${flowerType}.png`;
    mainFlowerPre.classList.remove('hidden');

    // Set up event listeners
    wateringCan.addEventListener('click', handleWaterClick);
    
    // Initial state update
    updateFlowerState();
};

// --- 9. SPARKLE EFFECT (For gift.html) ---

/** Creates and launches a single sparkle element. */
const createSparkle = (container) => {
    const sparkle = document.createElement('div');
    sparkle.classList.add('sparkle');
    // Random position within the flower area
    const x = 50 + (Math.random() * 100 - 50); // +/- 50px from center
    const y = 50 + (Math.random() * 100 - 50);
    sparkle.style.left = `${x}%`;
    sparkle.style.top = `${y}%`;
    sparkle.style.opacity = Math.random();
    sparkle.style.transform = `scale(${Math.random() * 0.5 + 0.5})`; // Random size

    container.appendChild(sparkle);

    // Remove the sparkle after its animation finishes
    setTimeout(() => sparkle.remove(), 1000);
};

// --- 10. GARDEN CANVAS LOGIC (For gift.html) ---

/** Draws the entire flower garden onto the canvas. */
const drawGarden = (flowers) => {
    if (!gardenCanvas) return;

    // Canvas size settings
    const PIXEL_SCALE = 16; // How many screen pixels per game pixel
    const TILE_SIZE = FLOWER_SIZE; // 48x48 pixel tile for each flower
    const PADDING = 2; // Pixel padding around the flower
    const DENSITY = 0.6; // Ratio of tiles occupied

    // Determine grid size (tiles)
    const totalFlowers = flowers.length;
    const maxCols = Math.floor((window.innerWidth * 0.9) / (TILE_SIZE * PIXEL_SCALE));
    const numCols = Math.min(maxCols, Math.ceil(Math.sqrt(totalFlowers / DENSITY)));
    const numRows = Math.ceil(totalFlowers / numCols);

    // Calculate canvas size (in pixels)
    const canvasWidth = numCols * TILE_SIZE * PIXEL_SCALE;
    const canvasHeight = numRows * TILE_SIZE * PIXEL_SCALE;

    // Set canvas dimensions
    gardenCanvas.width = canvasWidth;
    gardenCanvas.height = canvasHeight;

    const ctx = gardenCanvas.getContext('2d');
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw background (scaled to canvas size)
    if (gardenBackgroundImg.complete) {
        ctx.drawImage(gardenBackgroundImg, 0, 0, gardenCanvas.width, gardenCanvas.height);
    } else {
        ctx.fillStyle = '#6B8E23'; // Olive Drab fallback
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    
    // Store flower positions for click detection
    const flowerPositions = [];
    
    // Draw each flower onto the grid
    flowers.forEach((flower, index) => {
        const col = index % numCols;
        const row = Math.floor(index / numCols);

        const xPos = col * TILE_SIZE * PIXEL_SCALE;
        const yPos = row * TILE_SIZE * PIXEL_SCALE;

        const flowerImg = flowerImages[flower.flowerType];
        if (flowerImg && flowerImg.complete) {
            // Draw the flower image, scaling from its source size (TILE_SIZE) to its canvas size (TILE_SIZE * PIXEL_SCALE)
            ctx.drawImage(
                flowerImg, 
                xPos + (PADDING * PIXEL_SCALE), 
                yPos + (PADDING * PIXEL_SCALE), 
                (TILE_SIZE - (2 * PADDING)) * PIXEL_SCALE, 
                (TILE_SIZE - (2 * PADDING)) * PIXEL_SCALE
            );
        } else {
            // Fallback (text or simple box)
            ctx.fillStyle = '#fff';
            ctx.fillRect(xPos, yPos, TILE_SIZE * PIXEL_SCALE, TILE_SIZE * PIXEL_SCALE);
            ctx.fillStyle = '#000';
            ctx.fillText(
                flower.flowerType, 
                xPos + (TILE_SIZE * PIXEL_SCALE) / 2, 
                yPos + (TILE_SIZE * PIXEL_SCALE) / 2
            );
        }
        
        // Store position information for click handling
        flowerPositions.push({
            id: flower.id,
            data: flower,
            x: xPos,
            y: yPos,
            width: TILE_SIZE * PIXEL_SCALE,
            height: TILE_SIZE * PIXEL_SCALE
        });
    });
    
    // Re-attach click listener with current positions (to avoid stale closures)
    gardenCanvas.onclick = (e) => handleFlowerClick(e, flowerPositions);
};

/** Handles a click on the canvas to show flower details. */
const handleFlowerClick = (e, flowerPositions) => {
    // Get click coordinates relative to the canvas
    const rect = gardenCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find the flower that was clicked
    const clickedFlower = flowerPositions.find(pos =>
        x >= pos.x && x < pos.x + pos.width &&
        y >= pos.y && y < pos.y + pos.height
    );

    if (clickedFlower) {
        showFlowerModal(clickedFlower.data);
    }
};

/** Shows the flower detail modal. */
const showFlowerModal = (flower) => {
    document.getElementById('modal-flower-name').textContent = flower.flowerType;
    document.getElementById('modal-flower-message').textContent = flower.message;
    
    // Format the date
    let dateString = "Unknown date";
    if (flower.receivedAt && flower.receivedAt.toDate) {
        const date = flower.receivedAt.toDate();
        dateString = date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    }
    document.getElementById('modal-flower-date').textContent = `Received: ${dateString}`;

    flowerModal.classList.remove('hidden');
    // Ensure the modal pops visually
    flowerModal.querySelector('div').style.animation = 'modal-pop 0.3s ease-out forwards';
};

/** Hides the flower detail modal. */
const hideFlowerModal = () => {
    // Animate out before hiding
    const modalContent = flowerModal.querySelector('div');
    modalContent.style.animation = 'none'; // Reset animation
    void modalContent.offsetWidth; // Trigger reflow
    modalContent.style.animation = 'modal-pop-out 0.3s ease-in forwards';
    
    setTimeout(() => {
        flowerModal.classList.add('hidden');
    }, 300); // Wait for animation to finish
};


// --- 11. VIEW TOGGLE AND UTILS ---

/** Switches between the flower gift and the garden view. */
const switchView = (view) => {
    if (view === 'garden') {
        document.body.style.backgroundColor = THEME_COLORS['garden']; // Set garden background color
        flowerView.classList.add('hidden');
        gardenView.classList.remove('hidden');
        gardenButton.textContent = 'View Gift';
        
        // Re-draw garden on switch
        if (isAuthReady && flowerCollection.length > 0) {
            drawGarden(flowerCollection);
        } else if (isAuthReady) {
            // No flowers, show message instead of empty canvas
            console.log("Garden view: No flowers to draw.");
        }
        
    } else if (view === 'flower') {
        const theme = currentFlowerData?.theme || 'spring';
        document.body.style.backgroundColor = THEME_COLORS[theme] || THEME_COLORS['spring'];
        flowerView.classList.remove('hidden');
        gardenView.classList.add('hidden');
        gardenButton.textContent = 'View Garden';
    }
};

/** Updates the garden button text with flower count. */
const updateGardenButton = (count) => {
    gardenButton.textContent = count > 0 ? `View Garden (${count})` : 'View Garden';
};


// --- 12. INITIALIZATION AND EVENT LISTENERS ---

document.addEventListener('DOMContentLoaded', () => {

    // Builder page specific setup
    if (isBuilderPage) {
        const generateButton = document.getElementById('generate-button');
        const copyButton = document.getElementById('copy-button');
        if (generateButton) generateButton.onclick = handleGenerateGift;
        if (copyButton) copyButton.onclick = handleCopyLink;
        
        // No Firebase listeners needed for the builder page itself
        return; 
    }

    // Gift/Garden page specific setup

    // Set up modal listeners
    if (flowerModal) {
        flowerModal.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal') || e.target.classList.contains('close-button') || e.target.parentElement.classList.contains('close-button')) {
                hideFlowerModal();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !flowerModal.classList.contains('hidden')) {
                hideFlowerModal();
            }
        });
    }
    
    // Set up the garden view toggle
    if (gardenButton) {
        gardenButton.onclick = () => {
            // If currently in flower view, switch to garden, and vice-versa.
            if (!flowerView.classList.contains('hidden')) {
                switchView('garden');
            } else {
                switchView('flower');
            }
        };
    }
    
    // 1. Authentication State Listener
    auth.onAuthStateChanged(user => {
        isAuthReady = true;
        if (user) {
            currentUserId = user.uid;
            console.log("Auth State Changed: User logged in.", currentUserId);
            
            // 2. Start checking URL for gift data (runs once)
            checkUrlForFlowerId();
            
            // 3. Start listening for garden updates (real-time)
            setupFlowerCollectionListener(currentUserId);
            
        } else {
            console.log("Auth State Changed: No user logged in. Attempting sign-in...");
             attemptSignIn(); 
        }
    });

    // 4. Asset Loading Check (Handles initial drawing on gift page)
    let assetsLoaded = 0;
    const totalAssets = FLOWER_TYPES.length + 1; // +1 for the background image
    
    const checkAssets = () => {
        assetsLoaded++;
        if (assetsLoaded === totalAssets) {
            console.log("All assets loaded.");
            // Once all images are loaded, ensure the garden is drawn correctly
            if (currentUserId && flowerCollection.length > 0 && gardenView && !flowerView.classList.contains('hidden')) {
                 // Redraw garden if we ended up in garden view without an active gift
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
            console.error(`Failed to load image: ${gardenBackgroundImg.src}`);
            checkAssets(); // Count as loaded even if failed
        }
    }

    // Load flower images
    FLOWER_TYPES.forEach(name => {
        const img = flowerImages[name];
        if(img.complete) {
            checkAssets();
        } else {
            img.onload = checkAssets;
            img.onerror = () => {
                console.error(`Failed to load image: ${img.src}`);
                checkAssets(); // Count as loaded even if failed
            }
        }
    });
});

// Add modal pop-out animation CSS dynamically
const style = document.createElement('style');
style.textContent = `
    @keyframes modal-pop-out {
        0% { opacity: 1; transform: scale(1) translateY(0); }
        100% { opacity: 0; transform: scale(0.8) translateY(-20px); }
    }
`;
document.head.appendChild(style);
