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

// Set up logging for debugging
firebase.firestore.setLogLevel('debug');


// =========================================================================
// GLOBAL/SHARED VARIABLES & CONFIG
// =========================================================================

// Detect if we are on the builder page (index.html) or the gift page (gift.html)
const isBuilderPage = document.title.includes('Create Your Personalized Flower Gift');

const FLOWER_TYPES = ['Rose', 'Tulip', 'Daisy', 'Lily', 'Sunflower'];
const THEME_COLORS = {
    'spring': '#81C784', // Light Green
    'summer': '#FFF176', // Light Yellow
    'autumn': '#FFB74D', // Light Orange
    'winter': '#90CAF9'  // Light Blue
};

// Image Caching for Garden View (Gift Page Only)
const flowerImages = {};
const gardenBackgroundImg = new Image();
gardenBackgroundImg.src = 'image_36901d.jpg'; // Assuming one of the uploaded images is the background

// Load flower images for canvas drawing (only necessary on gift page)
FLOWER_TYPES.forEach(name => {
    const img = new Image();
    // Map flower names to uploaded files (User must adjust these mappings if needed)
    let src;
    if (name === 'Rose') src = 'image_49af86.jpg'; // Example mapping
    else if (name === 'Tulip') src = 'image_49b09d.jpg';
    else if (name === 'Daisy') src = 'image_49bee5.jpg';
    else if (name === 'Lily') src = 'image_49c9cb.jpg';
    else if (name === 'Sunflower') src = 'wmremove-transformed.jpeg'; // Assuming this is the 5th flower
    
    img.src = src || `${name}.png`; // Fallback to original name
    flowerImages[name] = img;
});


let flowerCollection = []; // Stores all flowers in the user's garden
let currentFlowerId = null; // ID of the flower received via the URL query
let currentFlowerData = null; // Data for the flower being opened

// DOM Elements (Shared & Specific)
const flowerView = document.getElementById('flower-view');
const gardenView = document.getElementById('garden-view');
const gardenButton = document.getElementById('garden-button');

// =========================================================================
// FIREBASE AUTHENTICATION & DATA PATHS
// =========================================================================

/**
 * Calculates the Firestore path for the public flower data.
 * @param {string} flowerId - The document ID of the flower.
 * @returns {string} The full Firestore document path.
 */
const getFlowerDocPath = (flowerId) => {
    return `artifacts/${appId}/public/data/flowers/${flowerId}`;
};

/**
 * Calculates the Firestore path for the user's personal flower collection.
 * @param {string} userId - The user's unique ID.
 * @returns {string} The full Firestore collection path.
 */
const getFlowerCollectionPath = (userId) => {
    return `artifacts/${appId}/users/${userId}/gardenCollection`;
};

/**
 * Attempts to sign in using the custom token or anonymously if the token is unavailable.
 */
const attemptSignIn = async () => {
    try {
        if (initialAuthToken) {
            await auth.signInWithCustomToken(initialAuthToken);
            console.log("Firebase Sign-In: Successful with custom token.");
        } else {
            // Sign in anonymously if no custom token is available (for local testing)
            await auth.signInAnonymously();
            console.log("Firebase Sign-In: Successful anonymously.");
        }
    } catch (error) {
        console.error("Firebase Sign-In Error:", error);
    }
};

/**
 * Sets up the real-time listener for the user's flower garden collection.
 * @param {string} userId - The current user's ID.
 */
const setupFlowerCollectionListener = (userId) => {
    const collectionRef = db.collection(getFlowerCollectionPath(userId));
    
    // Listen for real-time updates to the garden collection
    collectionRef.onSnapshot(snapshot => {
        const newCollection = [];
        snapshot.forEach(doc => {
            newCollection.push({ id: doc.id, ...doc.data() });
        });
        flowerCollection = newCollection;
        
        // Re-draw the garden if we are in the garden view and assets are loaded
        if (!isBuilderPage && gardenView.style.display !== 'none' && assetsLoaded === totalAssets) {
             drawGarden(flowerCollection);
        }

        console.log(`Garden Collection Updated. Total flowers: ${flowerCollection.length}`);
    }, error => {
        console.error("Error setting up garden listener:", error);
    });
};

// =========================================================================
// GIFT VIEWER PAGE (gift.html) LOGIC
// =========================================================================

/**
 * Checks the URL for a 'flowerId' query parameter and attempts to fetch the gift data.
 */
const checkUrlForFlowerId = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    currentFlowerId = urlParams.get('flowerId');
    const musicUrl = urlParams.get('music'); // Assuming you want to pass music
    const sparkleEnabled = urlParams.get('sparkle') === 'true';

    if (currentFlowerId) {
        console.log(`URL contains flowerId: ${currentFlowerId}`);
        await loadGiftFlower(currentFlowerId, sparkleEnabled);
    } else if (!isBuilderPage) {
        // If on the gift page but no flowerId, default to garden view if signed in
        if (auth.currentUser) {
            switchView('garden');
        }
    }
    // Music setup (if needed) - TONE.JS library is not included, so this part is skipped
};

/**
 * Loads the gift flower data from Firestore and updates the UI for the initial state.
 * @param {string} id - The flower's document ID.
 * @param {boolean} sparkleEnabled - Whether to show sparkles on reveal.
 */
const loadGiftFlower = async (id, sparkleEnabled) => {
    const flowerDocRef = db.doc(getFlowerDocPath(id));
    
    try {
        const docSnap = await flowerDocRef.get();
        if (docSnap.exists) {
            currentFlowerData = { id: docSnap.id, ...docSnap.data() };
            console.log("Flower data loaded:", currentFlowerData);
            
            // Set initial state based on data
            const clicksLeft = document.getElementById('clicks-left');
            const wateringInstruction = document.getElementById('watering-instruction');
            const initialFlower = document.getElementById('main-flower-pre');
            const mainFlower = document.getElementById('main-flower');
            
            initialFlower.src = currentFlowerData.flowerImage || 'image_362340.png'; // Use a placeholder image initially

            clicksLeft.textContent = currentFlowerData.clicks || 3;
            wateringInstruction.textContent = `A tiny ${currentFlowerData.flowerName} seed is here! Click the can ${currentFlowerData.clicks} times to make it bloom.`;

            // Setup watering interaction
            const wateringCan = document.getElementById('watering-can');
            wateringCan.onclick = () => handleWateringClick(sparkleEnabled);
            
            // Set background theme
            document.body.style.backgroundColor = THEME_COLORS[currentFlowerData.theme] || '#f7f3e8';

        } else {
            // Flower not found
            if(flowerView) {
                flowerView.innerHTML = `<div class="p-8 text-center"><h1 class="text-4xl text-red-500">Oops!</h1><p class="mt-4">This gift link is invalid or the flower has already been claimed.</p></div>`;
            }
        }
    } catch (error) {
        console.error("Error loading gift flower:", error);
    }
};

/**
 * Handles the watering can click, counts down, and reveals the gift.
 * @param {boolean} sparkleEnabled - Whether to show sparkles on reveal.
 */
const handleWateringClick = async (sparkleEnabled) => {
    let clicksLeftElement = document.getElementById('clicks-left');
    let clicksLeft = parseInt(clicksLeftElement.textContent);
    
    if (clicksLeft > 1) {
        clicksLeft--;
        clicksLeftElement.textContent = clicksLeft;
        
        // Visual feedback
        const waterDrop = document.createElement('div');
        waterDrop.classList.add('water-drop');
        waterDrop.style.left = `${Math.random() * 100}%`;
        waterDrop.style.animationDuration = `${Math.random() * 0.5 + 0.5}s`;
        document.body.appendChild(waterDrop);
        setTimeout(() => waterDrop.remove(), 1000);
        
    } else if (clicksLeft === 1) {
        clicksLeftElement.textContent = 0;
        await revealGift(sparkleEnabled);
    }
};

/**
 * Reveals the gift, updates the UI, saves the flower to the user's garden, and deletes the public gift document.
 * @param {boolean} sparkleEnabled - Whether to show sparkles on reveal.
 */
const revealGift = async (sparkleEnabled) => {
    // 1. Update UI
    document.getElementById('initial-state').classList.add('hidden');
    document.getElementById('gift-reveal').classList.remove('hidden');
    
    document.getElementById('main-flower').src = currentFlowerData.flowerImage;
    document.getElementById('main-flower').style.transform = 'scale(1)'; // Final bloom size
    document.getElementById('personal-message').textContent = currentFlowerData.message;

    // Sparkle effect
    if (sparkleEnabled) {
        animateSparkles();
    }
    
    // Disable watering can
    document.getElementById('watering-can').onclick = null;
    
    // 2. Save to User's Garden
    if (auth.currentUser && currentFlowerData) {
        const userId = auth.currentUser.uid;
        const gardenCollectionRef = db.collection(getFlowerCollectionPath(userId));
        
        try {
            await gardenCollectionRef.add({
                flowerName: currentFlowerData.flowerName,
                flowerImage: currentFlowerData.flowerImage,
                message: currentFlowerData.message,
                theme: currentFlowerData.theme,
                receivedDate: firebase.firestore.FieldValue.serverTimestamp() // Firestore timestamp
            });
            console.log("Flower successfully added to user's garden.");

            // 3. Delete Public Gift Document
            const flowerDocRef = db.doc(getFlowerDocPath(currentFlowerId));
            await flowerDocRef.delete();
            console.log("Public gift document deleted.");
            
        } catch (error) {
            console.error("Error saving or deleting flower:", error);
        }
    }
    
    // Enable garden button after reveal
    if(gardenButton) {
        gardenButton.onclick = () => switchView('garden');
        gardenButton.textContent = 'View Garden';
    }
};

/**
 * Creates and animates sparkle elements on the gift reveal.
 */
const animateSparkles = () => {
    const overlay = document.getElementById('sparkle-overlay');
    overlay.classList.remove('hidden');
    
    for (let i = 0; i < 20; i++) {
        const sparkle = document.createElement('div');
        sparkle.classList.add('sparkle');
        
        // Position relative to the main flower area
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        sparkle.style.left = `${x}%`;
        sparkle.style.top = `${y}%`;
        
        // Random size and color
        const size = Math.random() * 5 + 3;
        sparkle.style.width = `${size}px`;
        sparkle.style.height = `${size}px`;
        sparkle.style.backgroundColor = `hsl(${Math.random() * 60 + 40}, 100%, 70%)`; // Yellow/Orange
        
        // Random delay and duration for a scattered effect
        sparkle.style.animationDelay = `${Math.random() * 0.5}s`;
        sparkle.style.animationDuration = `${Math.random() * 1 + 1}s`;
        
        overlay.appendChild(sparkle);
        
        // Remove sparkle after animation ends
        setTimeout(() => sparkle.remove(), 2500);
    }
};

/**
 * Switches between the interactive gift view and the garden view.
 * @param {'flower'|'garden'} view - The view to switch to.
 */
const switchView = (view) => {
    if (view === 'garden') {
        flowerView.classList.add('hidden');
        gardenView.classList.remove('hidden');
        gardenButton.textContent = 'View Gift';
        // Ensure garden is drawn (needed if assets were slow to load initially)
        if (assetsLoaded === totalAssets) {
             drawGarden(flowerCollection);
        }
    } else {
        flowerView.classList.remove('hidden');
        gardenView.classList.add('hidden');
        gardenButton.textContent = 'View Garden';
    }
};


// =========================================================================
// PIXEL ART GARDEN CANVAS LOGIC (Gift Page Only)
// =========================================================================

const canvas = document.getElementById('garden-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;

const TILE_SIZE = 32; // Size of a single flower pixel tile
let canvasWidth = 0;
let canvasHeight = 0;
let cols = 0;
let rows = 0;
let currentScale = 1;


/**
 * Draws the background and all flowers onto the canvas.
 * @param {Array<Object>} flowers - The list of flowers to draw.
 */
const drawGarden = (flowers) => {
    if (!ctx) return;
    
    // 1. Get viewport size and calculate optimal canvas dimensions
    const container = document.getElementById('pixel-garden-container');
    const containerWidth = container.offsetWidth;
    
    // Calculate columns and rows based on max container width and tile size
    cols = Math.floor(containerWidth / TILE_SIZE);
    rows = Math.max(5, Math.ceil(flowers.length / cols)); // Ensure minimum height

    canvasWidth = cols * TILE_SIZE;
    canvasHeight = rows * TILE_SIZE;

    // Apply dimensions to canvas
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    // 2. Draw Background (The pre-loaded image)
    if (gardenBackgroundImg.complete) {
        ctx.drawImage(gardenBackgroundImg, 0, 0, gardenBackgroundImg.width, gardenBackgroundImg.height, 0, 0, canvasWidth, canvasHeight);
    } else {
        // Fallback if image isn't loaded yet
        ctx.fillStyle = '#4B5320'; // Dark green/dirt color
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    
    // 3. Draw Flowers
    flowers.forEach((flower, index) => {
        const x = index % cols;
        const y = Math.floor(index / cols);
        const img = flowerImages[flower.flowerName];

        if (img && img.complete) {
            // Draw the pre-loaded image (the asset must be TILE_SIZE x TILE_SIZE or correctly scaled)
            // For simplicity, we draw it scaled to the tile size
            ctx.drawImage(img, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        } else {
            // Fallback (e.g., a simple square)
            ctx.fillStyle = 'red';
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    });
};

/**
 * Handles clicks on the garden canvas to display flower details.
 * @param {Event} event - The click event.
 */
const handleCanvasClick = (event) => {
    if (flowerCollection.length === 0 || cols === 0) return;

    // Get click position relative to the canvas
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Calculate which tile was clicked
    const tileX = Math.floor(x / (canvasWidth / cols));
    const tileY = Math.floor(y / (canvasHeight / rows));
    
    const index = tileY * cols + tileX;

    if (index >= 0 && index < flowerCollection.length) {
        const clickedFlower = flowerCollection[index];
        displayFlowerModal(clickedFlower);
    }
};

/**
 * Displays the modal with the flower's details.
 * @param {Object} flower - The flower object.
 */
const displayFlowerModal = (flower) => {
    const modal = document.getElementById('flower-modal');
    document.getElementById('modal-flower-name').textContent = flower.flowerName;
    document.getElementById('modal-flower-message').textContent = flower.message;
    
    // Format date
    let dateStr = 'Date Unavailable';
    if (flower.receivedDate) {
        if (flower.receivedDate.toDate) {
            dateStr = flower.receivedDate.toDate().toLocaleDateString();
        } else if (flower.receivedDate instanceof Date) {
            dateStr = flower.receivedDate.toLocaleDateString();
        }
    }
    document.getElementById('modal-flower-date').textContent = `Received on: ${dateStr}`;

    modal.classList.remove('hidden');
};

/**
 * Hides the flower details modal.
 */
const hideFlowerModal = () => {
    document.getElementById('flower-modal').classList.add('hidden');
};


// =========================================================================
// GIFT BUILDER PAGE (index.html) LOGIC
// =========================================================================

// Builder Page DOM elements (only if isBuilderPage is true)
let generateButton;
let messageInput;
let flowerSelect;
let themeSelect;
let clicksInput;
let linkTextElement;
let copyButton;

if (isBuilderPage) {
    generateButton = document.getElementById('generate-button');
    messageInput = document.getElementById('message');
    flowerSelect = document.getElementById('flower-select');
    themeSelect = document.getElementById('theme-select');
    clicksInput = document.getElementById('clicks');
    
    linkTextElement = document.getElementById('link-text');
    copyButton = document.getElementById('copy-button');
}

/**
 * Handles the generation of the gift link and saving the gift data to Firestore.
 */
const handleGenerateGift = async () => {
    if (!auth.currentUser) {
        console.error("Cannot generate link: User not authenticated.");
        return;
    }
    
    const message = messageInput.value.trim();
    const flowerName = flowerSelect.value;
    const theme = themeSelect.value;
    const clicks = Math.max(1, Math.min(10, parseInt(clicksInput.value) || 3)); // Clamp clicks between 1 and 10
    
    if (message.length < 5) {
        alert("Please write a longer message (at least 5 characters).");
        return;
    }
    
    // 1. Determine Flower Image URL (Mapping to the uploaded files)
    let flowerImage;
    if (flowerName === 'Rose') flowerImage = 'image_49af86.jpg';
    else if (flowerName === 'Tulip') flowerImage = 'image_49b09d.jpg';
    else if (flowerName === 'Daisy') flowerImage = 'image_49bee5.jpg';
    else if (flowerName === 'Lily') flowerImage = 'image_49c9cb.jpg';
    else if (flowerName === 'Sunflower') flowerImage = 'wmremove-transformed.jpeg';
    else flowerImage = 'image_49af86.jpg'; // Default

    // 2. Save the flower data to the public gifts collection
    const flowersRef = db.collection(`artifacts/${appId}/public/data/flowers`);
    let docRef;
    
    try {
        docRef = await flowersRef.add({
            creatorId: auth.currentUser.uid,
            flowerName: flowerName,
            flowerImage: flowerImage,
            message: message,
            theme: theme,
            clicks: clicks,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log("Gift document successfully written with ID: ", docRef.id);
    } catch (e) {
        console.error("Error adding document: ", e);
        return;
    }

    // 3. Construct the Shareable Link
    let baseUrl = window.location.href;
    // Remove the file name (index.html) if it exists
    const lastSlashIndex = baseUrl.lastIndexOf('/');
    if (lastSlashIndex !== -1 && baseUrl.substring(lastSlashIndex).includes('.html')) {
        baseUrl = baseUrl.substring(0, lastSlashIndex + 1);
    }

    // Construct the link to the gift.html page
    const sparkleEnabled = 'true'; // Default setting
    const link = `${baseUrl}gift.html?flowerId=${docRef.id}&sparkle=${sparkleEnabled}`;
    
    linkTextElement.textContent = link;
    linkTextElement.classList.remove('hidden');
    copyButton.classList.remove('hidden');
    
    // Update button text and style
    generateButton.textContent = 'Link Generated! Copy Below.';
    generateButton.classList.add('bg-green-500', 'hover:bg-green-600');
    generateButton.classList.remove('bg-[#7B68EE]', 'hover:bg-[#6A5ACD]');
};

/**
 * Copies the generated link to the clipboard.
 */
const handleCopyLink = () => {
    const linkToCopy = linkTextElement.textContent;
    
    // Simple clipboard copy logic using execCommand for better iFrame compatibility
    if (document.execCommand('copy')) {
        // Success feedback
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

// =========================================================================
// INITIALIZATION
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // 1. Attach Event Listeners
    if (isBuilderPage) {
        generateButton.onclick = handleGenerateGift;
        copyButton.onclick = handleCopyLink;
    } else {
        // Gift/Garden page listeners
        if(gardenButton) {
            gardenButton.onclick = () => switchView('garden'); // Initial assignment
        }
        if (canvas) {
            canvas.addEventListener('click', handleCanvasClick);
        }
        const modal = document.getElementById('flower-modal');
        if (modal) {
             modal.querySelector('.close-button').onclick = hideFlowerModal;
        }
        
        // Handle window resize for responsive canvas
        const resizeObserver = new ResizeObserver(() => {
            // Only redraw the garden if it's currently visible
            if (gardenView && gardenView.style.display !== 'none') {
                drawGarden(flowerCollection);
            }
        });
        const container = document.getElementById('pixel-garden-container');
        if (container) {
            resizeObserver.observe(container);
        }
    }
    
    // 2. Firebase Auth State & Core Logic Trigger
    auth.onAuthStateChanged(user => {
        if (user) {
            const userId = user.uid;
            console.log("Auth State Changed: User logged in. UID:", userId);
            
            if (!isBuilderPage) {
                // Logic for the Gift/Garden Page
                checkUrlForFlowerId(); // Check if a gift needs opening
                setupFlowerCollectionListener(userId); // Start listening to the garden
            }
            // You could optionally display the userId on the builder page here if needed
            
        } else {
            console.log("Auth State Changed: No user logged in. Attempting sign-in...");
             attemptSignIn(); 
        }
    });

    // 3. Asset Loading Check (Handles initial drawing on gift page)
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