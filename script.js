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
        projectId: "local-dev-project",
        storageBucket: "local-dev-app.appspot.com",
        messagingSenderId: "1234567890",
        appId: "1:1234567890:web:localdev"
    };
    // ===================================
}

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
// Set Firebase logging to debug to catch potential issues
firebase.firestore.setLogLevel('Debug');


// --- Configuration & Constants ---
const FLOWER_TYPES = ['Rose', 'Tulip', 'Daisy', 'Lily', 'Sunflower'];
const THEMES = {
    'day': { background: '#87CEEB', primary: '#FFD700', secondary: '#4B5320', bodyBg: '#f7f3e8' },
    'sunset': { background: '#FF7F50', primary: '#FF4500', secondary: '#6B3E2E', bodyBg: '#ffe6e6' },
    'night': { background: '#191970', primary: '#ADD8E6', secondary: '#A9A9A9', bodyBg: '#2c2c54' }
};

// State variables
let flowerCollection = []; // Stores all received flowers for the garden
let currentFlowerData = null; // Stores the data for the flower currently being viewed/watered
let gardenFlowers = []; // Stores drawn flower objects with their coordinates for hit detection
let authReady = false; // Flag to ensure we don't query Firestore before auth is complete
let currentUserId = null;
let isBuilderPage = window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('builder.html');


// --- DOM Elements ---
const flowerView = document.getElementById('flower-view');
const gardenView = document.getElementById('garden-view');
const gardenButton = document.getElementById('garden-button');

// Gift specific elements
const initialFlowerState = document.getElementById('initial-state');
const giftRevealState = document.getElementById('gift-reveal');
const wateringCan = document.getElementById('watering-can');
const mainFlowerPre = document.getElementById('main-flower-pre');
const mainFlower = document.getElementById('main-flower');
const personalMessage = document.getElementById('personal-message');
const wateringInstruction = document.getElementById('watering-instruction');
const modal = document.getElementById('flower-modal');
const modalCloseButtons = document.querySelectorAll('.close-button');
const sparkleOverlay = document.getElementById('sparkle-overlay');

// Garden specific elements
const gardenCanvas = document.getElementById('garden-canvas');
const ctx = gardenCanvas ? gardenCanvas.getContext('2d') : null;

// --- Asset Loading (Images) ---
const flowerImages = {};
FLOWER_TYPES.forEach(name => {
    // Note: The flower images should be named e.g., 'Rose.png', 'Tulip.png', etc.
    const img = new Image();
    img.src = `${name}.png`;
    flowerImages[name] = img;
});

const gardenBackgroundImg = new Image();
gardenBackgroundImg.src = 'garden_background.png';


// --- Firebase & Auth Functions ---

/**
 * Attempts to sign in the user. If an initial auth token is present, it uses that,
 * otherwise, it signs in anonymously.
 */
async function attemptSignIn() {
    try {
        if (initialAuthToken) {
            await auth.signInWithCustomToken(initialAuthToken);
            console.log("Sign-in successful via custom token.");
        } else {
            await auth.signInAnonymously();
            console.log("Sign-in successful anonymously.");
        }
    } catch (error) {
        console.error("Firebase Sign-in Failed:", error);
    }
}

/**
 * Sets up a real-time listener for the user's flower collection.
 * The data is stored in a private collection under the user's ID.
 */
function setupFlowerCollectionListener(userId) {
    if (!db || !userId) {
        console.error("Cannot set up listener: DB or userId is missing.");
        return;
    }

    // Path: /artifacts/{appId}/users/{userId}/flowers
    const flowersRef = db.collection('artifacts').doc(appId).collection('users').doc(userId).collection('flowers');
    
    // Set up a real-time listener
    return flowersRef.onSnapshot(snapshot => {
        flowerCollection = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Ensure necessary fields exist and add the Firestore doc ID
            if (data.flower && data.message && data.clicksNeeded) {
                 // Convert Firestore timestamp to a readable Date object
                const dateReceived = data.dateReceived?.toDate ? data.dateReceived.toDate() : new Date();

                flowerCollection.push({
                    id: doc.id,
                    flower: data.flower,
                    message: data.message,
                    clicksNeeded: data.clicksNeeded,
                    clicksCurrent: data.clicksCurrent || 0, // Ensure current clicks defaults to 0
                    theme: data.theme || 'day',
                    sparkle: data.sparkle !== 'false', // Default to true
                    dateReceived: dateReceived.toLocaleDateString(),
                });
            }
        });

        console.log(`Garden updated. Total flowers: ${flowerCollection.length}`);
        
        // If we are on the garden view, redraw the canvas
        if (!isBuilderPage && gardenView.style.display !== 'none') {
            drawGarden(flowerCollection);
        }
        
    }, error => {
        console.error("Error listening to flower collection:", error);
    });
}

/**
 * Saves a new flower gift to the current user's collection.
 */
async function saveFlowerGift(giftData) {
    if (!db || !currentUserId) {
        console.error("Cannot save gift: DB or currentUserId is missing.");
        return;
    }

    try {
        // Path: /artifacts/{appId}/users/{userId}/flowers
        const flowersRef = db.collection('artifacts').doc(appId).collection('users').doc(currentUserId).collection('flowers');

        await flowersRef.add({
            flower: giftData.flower,
            message: giftData.message,
            clicksNeeded: giftData.clicks,
            clicksCurrent: 0, // Starts at 0 clicks
            theme: giftData.theme,
            sparkle: giftData.sparkle,
            dateReceived: firebase.firestore.FieldValue.serverTimestamp() // Use server timestamp
        });

        console.log("New flower gift saved successfully!");
    } catch (error) {
        console.error("Error saving flower gift:", error);
        alert("Failed to save your flower gift. Please try again.");
    }
}

/**
 * Updates the click count for a specific flower ID.
 */
async function updateFlowerClicks(flowerId, newClicks) {
    if (!db || !currentUserId) {
        console.error("Cannot update clicks: DB or currentUserId is missing.");
        return;
    }

    try {
        // Path: /artifacts/{appId}/users/{userId}/flowers/{flowerId}
        const flowerDocRef = db.collection('artifacts').doc(appId).collection('users').doc(currentUserId).collection('flowers').doc(flowerId);

        await flowerDocRef.update({
            clicksCurrent: newClicks
        });

        console.log(`Flower ${flowerId} clicks updated to ${newClicks}.`);
    } catch (error) {
        console.error("Error updating flower clicks:", error);
    }
}

// --- URL Parameter Handling and Gift Loading ---

/**
 * Checks the URL for the gift query parameter (g) and loads the gift data.
 * The parameter 'g' contains base64-encoded JSON with gift details.
 */
function checkUrlForFlowerId() {
    if (isBuilderPage) return; // Skip if on the builder page

    const urlParams = new URLSearchParams(window.location.search);
    const flowerId = urlParams.get('g');

    if (flowerId) {
        // This means a gift was received. Try to load the flower data.
        loadGiftFlower(flowerId);
    } else {
        // No flower ID, user is viewing their garden/home page.
        // Initialize to flower view (which will likely immediately switch to garden if they have flowers)
        switchView('flower'); 
    }
}

/**
 * Loads a specific flower gift from the database using its ID.
 */
async function loadGiftFlower(flowerId) {
    if (!db || !currentUserId) {
        console.error("Cannot load gift: DB or currentUserId is missing.");
        return;
    }

    try {
        // Path: /artifacts/{appId}/users/{userId}/flowers/{flowerId}
        const flowerDocRef = db.collection('artifacts').doc(appId).collection('users').doc(currentUserId).collection('flowers').doc(flowerId);
        
        // Use an onSnapshot listener to get real-time updates to clicksCurrent
        flowerDocRef.onSnapshot(doc => {
            if (doc.exists) {
                const data = doc.data();
                const clicksNeeded = data.clicksNeeded || 1;
                const clicksCurrent = data.clicksCurrent || 0;
                
                // Store the current gift data globally for interaction
                currentFlowerData = {
                    id: doc.id,
                    flower: data.flower || 'Rose',
                    message: data.message || 'A gift just for you!',
                    clicksNeeded: clicksNeeded,
                    clicksCurrent: clicksCurrent,
                    theme: data.theme || 'day',
                    sparkle: data.sparkle !== 'false',
                };
                
                // Set the theme
                setPageTheme(currentFlowerData.theme);
                
                // Update the view based on the click state
                if (clicksCurrent >= clicksNeeded) {
                    revealGift(currentFlowerData);
                } else {
                    updateWateringState(currentFlowerData);
                }
            } else {
                console.error("Flower gift not found.");
                displayMessage("Error: This flower gift link is invalid or has expired.", "error");
            }
        }, error => {
            console.error("Error fetching gift flower:", error);
            displayMessage("Error: Could not load the flower gift.", "error");
        });

    } catch (error) {
        console.error("Error loading gift flower:", error);
        displayMessage("An unexpected error occurred while loading the gift.", "error");
    }
}


// --- UI and Interaction Functions ---

/**
 * Switches between the 'flower' gift view and the 'garden' collection view.
 * @param {'flower'|'garden'} viewName - The view to switch to.
 */
function switchView(viewName) {
    if (viewName === 'flower') {
        flowerView.classList.remove('hidden');
        gardenView.classList.add('hidden');
        gardenButton.textContent = 'View Garden 🌿';
        gardenButton.onclick = () => switchView('garden');

        // Restore the theme of the current flower if one is loaded
        if (currentFlowerData) {
            setPageTheme(currentFlowerData.theme);
        } else {
            // Default theme if no gift is active
            setPageTheme('day');
        }

    } else if (viewName === 'garden') {
        flowerView.classList.add('hidden');
        gardenView.classList.remove('hidden');
        gardenButton.textContent = 'View Gift Home 💌';
        gardenButton.onclick = () => switchView('flower');
        
        // Set the garden theme
        setPageTheme('garden');
        
        // Redraw the garden every time the view is switched to it
        drawGarden(flowerCollection);
    }
}

/**
 * Sets the theme (background and body color) of the page.
 * @param {string} themeName - The name of the theme ('day', 'sunset', 'night', or 'garden').
 */
function setPageTheme(themeName) {
    const body = document.body;
    
    // Custom theme for the Garden View
    if (themeName === 'garden') {
        // Garden background color is set via CSS in style.css for #garden-view
        // We only change the body's global background which is visible behind #flower-view
        body.style.backgroundColor = '#4B5320'; // Deep forest green / dark olive
        return;
    }
    
    // Themes for the Gift View
    const theme = THEMES[themeName] || THEMES['day'];
    body.style.backgroundColor = theme.bodyBg;
    
    // Update watering can instruction color based on theme for contrast (optional)
    if (wateringInstruction) {
        wateringInstruction.style.color = themeName === 'night' ? theme.primary : theme.secondary;
    }
}

/**
 * Handles the click/tap on the watering can.
 */
async function handleWateringClick() {
    if (!currentFlowerData || currentFlowerData.clicksCurrent >= currentFlowerData.clicksNeeded) {
        return; // Already bloomed or no flower data
    }
    
    // Play a short sound effect (water drop/tinkle)
    try {
        const synth = new Tone.MembraneSynth().toDestination();
        synth.triggerAttackRelease("C4", "8n");
    } catch (e) {
        console.warn("Tone.js failed to play sound.", e);
    }
    
    // Increase clicks and update in Firestore
    const newClicks = currentFlowerData.clicksCurrent + 1;
    await updateFlowerClicks(currentFlowerData.id, newClicks); // The onSnapshot listener will handle the UI update

    // Visual feedback (water particle effect)
    createWaterDrop(wateringCan.getBoundingClientRect());
}

/**
 * Updates the UI state while the flower is being watered.
 */
function updateWateringState(flowerData) {
    const clicksRemaining = flowerData.clicksNeeded - flowerData.clicksCurrent;

    initialFlowerState.classList.remove('hidden');
    giftRevealState.classList.add('hidden');

    wateringInstruction.innerHTML = `Click the watering can ${clicksRemaining} more time${clicksRemaining === 1 ? '' : 's'} to make your ${flowerData.flower} bloom!`;

    // Visual growth effect (scale the image)
    const scaleFactor = 0.5 + (0.5 * (flowerData.clicksCurrent / flowerData.clicksNeeded));
    mainFlowerPre.style.transform = `scale(${scaleFactor})`;
    mainFlowerPre.style.opacity = '1';
    
    // Set the correct pre-reveal image
    mainFlowerPre.src = `${flowerData.flower}_pre.png`;
    mainFlowerPre.alt = `${flowerData.flower} bud`;
}

/**
 * Reveals the final gift state.
 */
function revealGift(flowerData) {
    initialFlowerState.classList.add('hidden');
    giftRevealState.classList.remove('hidden');
    
    mainFlower.src = `${flowerData.flower}.png`;
    mainFlower.alt = `A fully bloomed ${flowerData.flower}`;
    personalMessage.textContent = flowerData.message;

    // Optional: Trigger a celebration sound or visual effect
    if (flowerData.sparkle) {
        startSparkleAnimation();
    }
}

// --- Canvas Garden Logic (Pixel Art) ---
const PIXEL_SIZE = 16;
const COLS = 20;
const ROWS = 20;
const GARDEN_WIDTH = COLS * PIXEL_SIZE;
const GARDEN_HEIGHT = ROWS * PIXEL_SIZE;
const FLOWER_SPRITE_SIZE = PIXEL_SIZE * 2; // Flowers are 2x2 grid units

if (gardenCanvas) {
    // Set the canvas dimensions for pixel art rendering
    gardenCanvas.width = GARDEN_WIDTH;
    gardenCanvas.height = GARDEN_HEIGHT;
}

/**
 * Renders the entire flower collection on the canvas.
 * @param {Array<Object>} flowers - The array of flower data.
 */
function drawGarden(flowers) {
    if (!ctx) return;

    // 1. Clear the canvas and draw the background
    ctx.clearRect(0, 0, GARDEN_WIDTH, GARDEN_HEIGHT);
    if (gardenBackgroundImg.complete) {
        // Draw the background image to fill the canvas
        ctx.drawImage(gardenBackgroundImg, 0, 0, GARDEN_WIDTH, GARDEN_HEIGHT);
    } else {
        // Fallback if the image hasn't loaded
        ctx.fillStyle = '#4B5320'; // Dark green soil color
        ctx.fillRect(0, 0, GARDEN_WIDTH, GARDEN_HEIGHT);
    }
    
    gardenFlowers = []; // Reset the hit detection array
    
    // 2. Determine flower positions
    const occupiedCells = new Set();
    
    // Sort flowers by date received (oldest first) so they stack correctly
    const sortedFlowers = [...flowers].sort((a, b) => {
        // Fallback to current date if parsing fails (though Firestore should provide dates)
        const dateA = new Date(a.dateReceived || Date.now()).getTime();
        const dateB = new Date(b.dateReceived || Date.now()).getTime();
        return dateA - dateB;
    });

    sortedFlowers.forEach(flower => {
        // Find a random, non-occupied 2x2 grid cell for the flower's base
        let xCell, yCell, foundSpot = false;
        
        // Try up to 100 times to find an open spot
        for (let attempt = 0; attempt < 100; attempt++) {
            // xCell must be <= COLS - 2, yCell must be <= ROWS - 2
            xCell = Math.floor(Math.random() * (COLS - 1)); 
            yCell = Math.floor(Math.random() * (ROWS - 1));
            
            // Check if the 2x2 area (xCell, yCell) is free
            const cellsToCheck = [
                `${xCell},${yCell}`,
                `${xCell + 1},${yCell}`,
                `${xCell},${yCell + 1}`,
                `${xCell + 1},${yCell + 1}`,
            ];
            
            if (cellsToCheck.every(cell => !occupiedCells.has(cell))) {
                // If the entire 2x2 spot is free, mark it as occupied
                cellsToCheck.forEach(cell => occupiedCells.add(cell));
                foundSpot = true;
                break;
            }
        }
        
        if (foundSpot) {
            const xPos = xCell * PIXEL_SIZE;
            const yPos = yCell * PIXEL_SIZE;
            
            const img = flowerImages[flower.flower];
            
            // 3. Draw the flower on the canvas
            if (img && img.complete) {
                // Draw at the calculated pixel position (2x2 grid size)
                ctx.drawImage(img, xPos, yPos, FLOWER_SPRITE_SIZE, FLOWER_SPRITE_SIZE);
                
                // 4. Store for hit detection
                gardenFlowers.push({
                    id: flower.id,
                    data: flower,
                    x: xPos,
                    y: yPos,
                    width: FLOWER_SPRITE_SIZE,
                    height: FLOWER_SPRITE_SIZE
                });
            } else {
                console.warn(`Image for ${flower.flower} not loaded, drawing fallback.`);
                // Fallback: draw a colored square
                ctx.fillStyle = flower.flower === 'Rose' ? 'red' : 'green';
                ctx.fillRect(xPos, yPos, FLOWER_SPRITE_SIZE, FLOWER_SPRITE_SIZE);
            }
        }
    });
}

/**
 * Handles clicks on the canvas for opening flower modals.
 * @param {MouseEvent} event 
 */
function handleCanvasClick(event) {
    if (!gardenCanvas || gardenView.style.display === 'none') return;
    
    // Get click position relative to the canvas
    const rect = gardenCanvas.getBoundingClientRect();
    const scaleX = gardenCanvas.width / rect.width;
    const scaleY = gardenCanvas.height / rect.height;

    // Use the mouse position scaled to the canvas's internal resolution (PIXEL_SIZE grid)
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    // Check if the click hit any drawn flower
    for (const flower of gardenFlowers) {
        if (clickX >= flower.x && clickX <= flower.x + flower.width &&
            clickY >= flower.y && clickY <= flower.y + flower.height) {
            
            // Flower found! Show the modal.
            showFlowerModal(flower.data);
            return; 
        }
    }
}


/**
 * Shows the modal with detailed flower information.
 * @param {Object} flower - The flower data object.
 */
function showFlowerModal(flower) {
    document.getElementById('modal-flower-name').textContent = flower.flower;
    document.getElementById('modal-flower-date').textContent = `Received: ${flower.dateReceived}`;
    document.getElementById('modal-flower-message').textContent = flower.message;
    modal.classList.remove('hidden');
}

/**
 * Hides the flower detail modal.
 */
function hideFlowerModal() {
    modal.classList.add('hidden');
}


// --- Animation/Visual Effects ---

/**
 * Creates a visual water drop effect near the watering can.
 */
function createWaterDrop(rect) {
    const drop = document.createElement('div');
    drop.className = 'drop';
    
    // Position the drop near the spout of the watering can
    const xOffset = rect.width * 0.6; // Slightly right of center
    const yOffset = rect.height * 0.1; // Near the top
    
    drop.style.left = `${rect.left + window.scrollX + xOffset + (Math.random() * 10 - 5)}px`;
    drop.style.top = `${rect.top + window.scrollY + yOffset + (Math.random() * 10 - 5)}px`;

    document.body.appendChild(drop);

    // Remove the drop after animation
    drop.addEventListener('animationend', () => {
        drop.remove();
    });
}

/**
 * Starts the sparkle animation overlay for the reveal.
 */
function startSparkleAnimation() {
    sparkleOverlay.classList.remove('hidden');

    // Create 20 sparkles
    for (let i = 0; i < 20; i++) {
        const sparkle = document.createElement('div');
        sparkle.className = 'sparkle';
        // Random position within the main flower/gift area
        sparkle.style.left = `${Math.random() * 100}%`;
        sparkle.style.top = `${Math.random() * 100}%`;
        sparkle.style.animationDelay = `${Math.random() * 1}s`;

        sparkleOverlay.appendChild(sparkle);
    }
    
    // Clean up sparkles after a duration
    setTimeout(() => {
        sparkleOverlay.innerHTML = '';
        sparkleOverlay.classList.add('hidden');
    }, 2000);
}


// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    // Check if the current page is one of the builder pages (index.html or builder.html)
    // The link generation logic is now handled in generatelink.js, but we keep this flag
    // for conditional logic specific to the gift/garden view.
    const isGiftPage = window.location.pathname.endsWith('gift.html') || (!window.location.pathname.endsWith('index.html') && !window.location.pathname.endsWith('builder.html'));
    
    if (isGiftPage) {
        // --- Gift/Garden Page Setup ---
        
        // Event Listeners
        wateringCan.onclick = handleWateringClick;
        gardenButton.onclick = () => switchView('garden'); // Initial assignment
        
        if (gardenCanvas) {
            gardenCanvas.addEventListener('click', handleCanvasClick);
        }
        
        modalCloseButtons.forEach(button => {
            button.onclick = hideFlowerModal;
        });

        // Set up Firebase Auth listener
        auth.onAuthStateChanged(user => {
            if (user) {
                console.log("Auth State Changed: User logged in.", user.uid);
                currentUserId = user.uid;
                authReady = true;
                
                // 1. Check URL for gift data (runs once after auth)
                checkUrlForFlowerId(); 
                
                // 2. Set up real-time listener for the entire flower collection
                setupFlowerCollectionListener(currentUserId);

            } else {
                console.log("Auth State Changed: No user logged in. Attempting sign-in...");
                 attemptSignIn(); 
            }
        });

        // Initialize to flower view before authentication loads currentFlowerData
        switchView('flower');
        
    } else if (isBuilderPage) {
        // --- Builder Page Setup (Stub for generatelink.js) ---
        // This file shouldn't execute most of its logic on the builder page,
        // but we ensure basic setup is handled for Firebase.
        auth.onAuthStateChanged(user => {
            if (user) {
                currentUserId = user.uid;
                authReady = true;
            } else {
                 attemptSignIn(); 
            }
        });
        
        // The core link generation and copy logic is in generatelink.js
        // The builder page will call saveFlowerGift(giftData) from generatelink.js.
        // We expose the function globally or ensure generatelink.js can access it.
        window.saveFlowerGift = saveFlowerGift; // Expose the function for generatelink.js
    }


    // 3. Asset Loading Check (Handles initial drawing on gift page)
    let assetsLoaded = 0;
    const totalAssets = FLOWER_TYPES.length + 1; // +1 for the background image
    
    const checkAssets = () => {
        assetsLoaded++;
        if (assetsLoaded === totalAssets) {
            // Once all images are loaded, ensure the garden is drawn correctly
            // This is only relevant for the gift page, once flowerCollection is populated
            if (isGiftPage && flowerCollection.length > 0 && gardenView.style.display !== 'none') {
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
