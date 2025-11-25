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

// Firebase initialization using the imported SDK functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    onSnapshot, 
    collection, 
    query, 
    where, 
    getDocs, 
    updateDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Initialize Firebase
let app, db, auth;
let userId = null;
let isAuthReady = false;

// State Variables
let currentFlowerId = null;
let currentFlowerData = null;
let flowerCollection = []; // Stores the user's collected flowers

// Constants
const FLOWER_COLLECTION_PATH = `/artifacts/${appId}/users/`;
const FLOWER_TYPES = ['Rose', 'Tulip', 'Daisy', 'Sunflower', 'Lily'];
const flowerImages = {};
const gardenBackgroundImg = new Image();
gardenBackgroundImg.src = 'garden_background.png'; // Assuming this image is available

// Preload flower images
FLOWER_TYPES.forEach(name => {
    const img = new Image();
    img.src = `${name}.png`; // Assuming images like Rose.png, Tulip.png are available
    flowerImages[name] = img;
});

// Utility function to get the current user path (private data)
function getPrivateFlowerCollectionRef(uid) {
    // Path: /artifacts/{appId}/users/{userId}/flowers
    return collection(db, `${FLOWER_COLLECTION_PATH}${uid}/flowers`);
}

// Utility function to get the document reference for a specific flower
function getFlowerDocRef(flowerId) {
    // Public data path: /artifacts/{appId}/public/data/gifts/{flowerId}
    return doc(db, `/artifacts/${appId}/public/data/gifts`, flowerId);
}

// --- INITIALIZATION AND AUTHENTICATION ---

async function attemptSignIn() {
    try {
        const authInstance = getAuth(app);
        
        // Use browserLocalPersistence to remember the user
        await setPersistence(authInstance, browserLocalPersistence);

        if (initialAuthToken) {
            await signInWithCustomToken(authInstance, initialAuthToken);
        } else {
            // Sign in anonymously if no custom token is provided
            await signInAnonymously(authInstance);
        }
        console.log("Firebase: Sign-in successful.");
    } catch (error) {
        console.error("Firebase: Sign-in failed.", error);
    }
}

function initializeFirebase() {
    if (!app) {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Authentication State Listener
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                console.log("Firebase: User logged in. UID:", userId);
                isAuthReady = true;
                
                // On the Gift page, fetch the initial flower and set up the listener
                if (!isBuilderPage) {
                    await checkUrlForFlowerId();
                    setupFlowerCollectionListener();
                } else {
                    // Builder page logic can now run with auth ready
                    // The function will be called directly below, but this is a safeguard
                }
            } else {
                userId = null;
                isAuthReady = false;
                console.log("Firebase: Auth State Changed: No user logged in. Attempting sign-in...");
                attemptSignIn(); 
            }
        });
    }
}


// --- GIFT PAGE (Gift.HTML) FUNCTIONS ---

function switchView(viewName) {
    const flowerView = document.getElementById('flower-view');
    const gardenView = document.getElementById('garden-view');
    const gardenButton = document.getElementById('garden-button');

    if (viewName === 'flower') {
        flowerView.style.display = 'block';
        gardenView.style.display = 'none';
        gardenButton.textContent = 'View Garden';
        document.body.style.backgroundColor = '#f7f3e8'; // Light background for flower view
    } else if (viewName === 'garden') {
        flowerView.style.display = 'none';
        gardenView.style.display = 'block';
        gardenButton.textContent = 'View Gift';
        document.body.style.backgroundColor = '#6B8E23'; // Darker green background for garden
        drawGarden(flowerCollection); // Redraw garden on switch
    }
}

function handleWateringClick() {
    if (!currentFlowerData || currentFlowerData.watered_count >= currentFlowerData.clicks_to_bloom) {
        // If already bloomed or no flower loaded, show message box but don't increment
        showMessageBox("Your flower is already fully bloomed!", "🎉");
        return;
    }

    // 1. Increment count locally
    let newWateredCount = currentFlowerData.watered_count + 1;
    
    // 2. Optimistic UI update
    updateWateringProgress(newWateredCount, currentFlowerData.clicks_to_bloom);

    // 3. Persist update to Firestore
    const flowerRef = getFlowerDocRef(currentFlowerId);
    
    updateDoc(flowerRef, {
        watered_count: newWateredCount
    }).catch(error => {
        console.error("Error updating watered count:", error);
        showMessageBox("Failed to water the flower. Please try again.", "⚠️");
        // Revert local state or force reload if update fails
    });
    
    // Check for bloom state immediately after click
    if (newWateredCount >= currentFlowerData.clicks_to_bloom) {
        handleBloom();
    }
}

function updateWateringProgress(current, total) {
    const progressText = document.getElementById('watering-instruction');
    const canImg = document.getElementById('watering-can');
    const progress = Math.min(100, (current / total) * 100);
    
    if (progressText) {
        progressText.innerHTML = `Keep watering! ${current} / ${total} clicks until it blooms.`;
    }
    
    // Simple animation trigger for the watering can
    if (canImg) {
        canImg.src = `can_animated.gif?t=${Date.now()}`; 
        setTimeout(() => {
            canImg.src = `can.png`; // Revert to static image after a short delay
        }, 500);
    }
}

function handleBloom() {
    const initialState = document.getElementById('initial-state');
    const revealState = document.getElementById('gift-reveal');
    const mainFlowerImg = document.getElementById('main-flower');
    const personalMessage = document.getElementById('personal-message');
    const collectButton = document.getElementById('collect-button');
    const title = document.getElementById('flower-title');

    // Check if elements exist before manipulating
    if (initialState) initialState.style.display = 'none';
    if (revealState) revealState.style.display = 'block';

    // Update revealed content
    if (title && currentFlowerData) title.textContent = `${currentFlowerData.recipient_name}'s Flower Gift`;
    if (mainFlowerImg && currentFlowerData) mainFlowerImg.src = `${currentFlowerData.flower_type}.png`;
    if (personalMessage && currentFlowerData) personalMessage.textContent = currentFlowerData.message;

    // Show the collect button
    if (collectButton) {
        collectButton.style.display = 'block';
        collectButton.onclick = handleCollectFlower;
    }
    
    triggerSparkleEffect();
}

function showMessageBox(message, emoji) {
    const box = document.createElement('div');
    box.className = 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-yellow-100 border border-yellow-400 text-yellow-700 px-6 py-3 rounded-xl shadow-2xl z-50 transition-opacity duration-300';
    box.innerHTML = `<p class="font-bold">${emoji} ${message}</p>`;
    document.body.appendChild(box);

    setTimeout(() => {
        box.style.opacity = '0';
        box.addEventListener('transitionend', () => box.remove());
    }, 3000);
}

function triggerSparkleEffect() {
    // A simple visual indicator for the bloom effect
    const overlay = document.getElementById('sparkle-overlay');
    if (!overlay) return;
    
    overlay.style.display = 'block';
    overlay.className = 'absolute inset-0 bg-white opacity-0 animate-pulse rounded-2xl'; // Tailwind style for pulse effect
    
    setTimeout(() => {
        overlay.style.display = 'none';
    }, 1500);
}

async function handleCollectFlower() {
    if (!currentFlowerData || !currentFlowerId || !userId) {
        showMessageBox("Cannot collect: Data or user not ready.", "❌");
        return;
    }

    try {
        const flowerRef = getFlowerDocRef(currentFlowerId);
        const privateCollectionRef = getPrivateFlowerCollectionRef(userId);

        // 1. Copy the flower data (without the 'is_collected' flag) to the user's private collection
        const flowerDataForCollection = {
            ...currentFlowerData,
            collected_at: new Date().toISOString()
        };
        // Use the public gift ID as the document ID in the private collection for easy tracing
        await setDoc(doc(privateCollectionRef, currentFlowerId), flowerDataForCollection);

        // 2. Mark the public flower document as collected and attribute the collector
        await updateDoc(flowerRef, {
            is_collected: true,
            collected_by_uid: userId,
            collected_by_name: currentFlowerData.recipient_name,
            collected_timestamp: new Date().toISOString()
        });

        showMessageBox("Flower Collected! Check your Garden.", "✅");
        
        // Hide the collect button immediately after success
        const collectButton = document.getElementById('collect-button');
        if (collectButton) {
             collectButton.style.display = 'none';
        }
        
        // Switch to the garden view immediately
        switchView('garden');

    } catch (error) {
        console.error("Error collecting flower:", error);
        showMessageBox("Failed to collect the flower. Please try again.", "⚠️");
    }
}

function setupFlowerCollectionListener() {
    if (!userId) return; // Wait for authentication
    
    const privateCollectionRef = getPrivateFlowerCollectionRef(userId);
    
    // Set up a real-time listener for the user's collected flowers
    onSnapshot(privateCollectionRef, (snapshot) => {
        flowerCollection = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`Garden updated: ${flowerCollection.length} flowers collected.`);
        
        // Only redraw the garden if the user is currently viewing it
        if (document.getElementById('garden-view') && document.getElementById('garden-view').style.display !== 'none') {
             drawGarden(flowerCollection);
        }
    }, (error) => {
        console.error("Error listening to flower collection:", error);
    });
}

function drawGarden(flowers) {
    const gardenDiv = document.getElementById('flower-grid');
    if (!gardenDiv) return;

    // Set the overall garden background (if the image is loaded)
    const gardenContainer = document.getElementById('garden-grid-container');
    if (gardenContainer && gardenBackgroundImg.complete) {
        gardenContainer.style.backgroundImage = `url(${gardenBackgroundImg.src})`;
        gardenContainer.style.backgroundSize = 'cover';
        gardenContainer.style.backgroundPosition = 'center';
    } else if (gardenContainer) {
         // Fallback color if image is not ready
        gardenContainer.style.backgroundColor = '#7CFC00';
    }
    
    gardenDiv.innerHTML = '';
    
    if (flowers.length === 0) {
        gardenDiv.innerHTML = `
            <div class="text-center p-10 col-span-full">
                <p class="text-white text-2xl font-semibold mb-2 drop-shadow-md">Your garden is empty!</p>
                <p class="text-gray-200 text-lg drop-shadow-sm">Receive a gift link to start collecting flowers.</p>
            </div>
        `;
        return;
    }

    // Grid layout for cards (can be adjusted in style.css for better visual garden effect)
    gardenDiv.style.display = 'grid';
    gardenDiv.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
    gardenDiv.style.gap = '20px';
    
    flowers.forEach(flower => {
        const card = document.createElement('div');
        card.className = 'flower-card bg-white p-4 rounded-xl shadow-2xl transition duration-300 hover:scale-[1.03] flex flex-col items-center';

        const collectedDate = new Date(flower.collected_at).toLocaleDateString();

        card.innerHTML = `
            <img src="${flower.flower_type}.png" alt="${flower.flower_type}" class="w-32 h-32 object-contain mb-3">
            <h3 class="text-xl font-bold text-gray-800">${flower.flower_type} for ${flower.recipient_name}</h3>
            <p class="text-sm text-gray-500 mb-2">Collected on: ${collectedDate}</p>
            <div class="message-preview w-full">
                <p class="text-sm italic overflow-hidden text-ellipsis whitespace-nowrap">"${flower.message.substring(0, 50)}..."</p>
            </div>
        `;
        gardenDiv.appendChild(card);
    });
}


async function checkUrlForFlowerId() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    
    if (id) {
        currentFlowerId = id;
        console.log(`URL parameter found: Flower ID ${currentFlowerId}.`);
        
        // Setup real-time listener for the specific gift document
        const flowerRef = getFlowerDocRef(currentFlowerId);
        onSnapshot(flowerRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                currentFlowerData = data;
                
                // Set the initial recipient name for the title
                const titleElement = document.getElementById('flower-title');
                if (titleElement) {
                    titleElement.textContent = `${data.recipient_name}'s Flower Gift`;
                }

                // Check if the flower has bloomed or if it's collected
                if (data.is_collected) {
                    showMessageBox("This flower has already been collected and is in your garden!", "🏠");
                    // Optionally redirect to garden view
                    switchView('garden');
                    return;
                } else if (data.watered_count >= data.clicks_to_bloom) {
                    // Bloomed, but not collected
                    handleBloom();
                } else {
                    // Still in the watering stage
                    updateWateringProgress(data.watered_count, data.clicks_to_bloom);
                    const canImg = document.getElementById('watering-can');
                    if (canImg) {
                        canImg.onclick = handleWateringClick;
                    }
                }
            } else {
                showMessageBox("This flower gift link is invalid or has expired.", "⚠️");
                // Hide main view content if invalid
                const flowerView = document.getElementById('flower-view');
                if (flowerView) {
                    flowerView.innerHTML = '<h1 class="text-3xl font-bold text-red-500">Invalid Gift Link</h1>';
                }
            }
        }, (error) => {
             console.error("Error listening to gift document:", error);
             showMessageBox("Failed to load gift data.", "❌");
        });
        
    } else {
        // No ID in URL - This is the landing page/no gift received.
        const flowerView = document.getElementById('flower-view');
        if (flowerView) {
            flowerView.innerHTML = `
                <div class="p-10 text-center">
                    <h1 class="text-3xl font-bold text-gray-700 mb-4">Welcome to Your Garden!</h1>
                    <p class="text-gray-500">You haven't received a flower gift yet. Ask a friend to send you one!</p>
                </div>
            `;
        }
        const gardenButton = document.getElementById('garden-button');
        if (gardenButton) {
            gardenButton.textContent = 'View Garden';
        }
        // Immediately switch to garden view if no ID is present
        switchView('garden');
    }
}

// --- BUILDER PAGE (builder.html) FUNCTIONS ---

let builderState = {
    flower_type: FLOWER_TYPES[0], // Default to the first type
};

// Function to populate flower selector in builder.html
function populateFlowerSelector() {
    const selectorDiv = document.getElementById('flower-selector');
    const placeholder = document.getElementById('flower-selector-placeholder');
    if (!selectorDiv) return;

    if (placeholder) {
        placeholder.remove(); // Remove placeholder once content is ready to be populated
    }
    
    selectorDiv.innerHTML = ''; // Clear existing content (like the placeholder)

    FLOWER_TYPES.forEach(flowerName => {
        const isSelected = flowerName === builderState.flower_type;
        const button = document.createElement('button');
        
        // Use a consistent class name and manage selection via border/background
        button.className = `flower-button p-3 rounded-xl border-4 transition duration-200 shadow-md ${isSelected ? 'border-[#7B68EE] bg-indigo-50' : 'border-gray-200 bg-white hover:border-[#7B68EE]'}`;
        button.innerHTML = `<img src="${flowerName}.png" alt="${flowerName}" class="w-16 h-16 object-contain">`;
        
        button.onclick = () => {
            builderState.flower_type = flowerName;
            populateFlowerSelector(); // Re-render to update selection style
        };
        selectorDiv.appendChild(button);
    });
}

function validateInputs(recipientName, message, clicks) {
    if (!recipientName.trim()) {
        showMessageBox("Please enter the recipient's name.", "🚫");
        return false;
    }
    if (!message.trim()) {
        showMessageBox("Please enter your personal message.", "🚫");
        return false;
    }
    const clickCount = parseInt(clicks, 10);
    if (isNaN(clickCount) || clickCount < 5 || clickCount > 100) {
        showMessageBox("Clicks to Bloom must be between 5 and 100.", "🚫");
        return false;
    }
    return true;
}

async function generateGiftLink() {
    const recipientNameInput = document.getElementById('recipient-name');
    const messageInput = document.getElementById('personal-message');
    const clicksInput = document.getElementById('watering-clicks');
    
    // Check if elements exist before accessing .value
    if (!recipientNameInput || !messageInput || !clicksInput) {
        console.error("Missing input fields in builder.html.");
        showMessageBox("Error: Form elements not found.", "❌");
        return;
    }
    
    const recipientName = recipientNameInput.value.trim();
    const message = messageInput.value.trim();
    const clicks = clicksInput.value;
    const flowerType = builderState.flower_type;
    
    if (!validateInputs(recipientName, message, clicks)) {
        return;
    }
    
    if (!db) {
        showMessageBox("Database connection not ready. Please wait a moment.", "⚠️");
        return;
    }

    try {
        const giftData = {
            recipient_name: recipientName,
            message: message,
            clicks_to_bloom: parseInt(clicks, 10),
            flower_type: flowerType,
            watered_count: 0,
            is_collected: false, // Flag for if the gift has been collected into a user's garden
            created_at: new Date().toISOString()
        };

        // Public data path: /artifacts/{appId}/public/data/gifts/{flowerId}
        const giftCollectionRef = collection(db, `/artifacts/${appId}/public/data/gifts`);
        
        // Add the document to the public gifts collection
        const newGiftDocRef = doc(giftCollectionRef);
        await setDoc(newGiftDocRef, giftData);
        
        const newGiftId = newGiftDocRef.id;
        
        // Construct the shareable link (assuming Gift.HTML is in the same directory)
        const giftUrl = `${window.location.origin}${window.location.pathname.replace('builder.html', 'Gift.HTML')}?id=${newGiftId}`;

        // Display the link and copy button
        const linkText = document.getElementById('link-text');
        const copyButton = document.getElementById('copy-button');
        
        if (linkText) {
            linkText.textContent = giftUrl;
            linkText.classList.remove('hidden');
        }
        
        if (copyButton) {
            copyButton.classList.remove('hidden');
            
            // Add copy functionality
            copyButton.onclick = () => {
                 // Using document.execCommand('copy') for better compatibility in iFrames
                const tempInput = document.createElement('textarea');
                tempInput.value = giftUrl;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                document.body.removeChild(tempInput);

                copyButton.textContent = 'Copied!';
                setTimeout(() => {
                    copyButton.textContent = 'Copy Link to Clipboard';
                }, 2000);
            };
        }
        
        showMessageBox("Gift Link Generated Successfully!", "🔗");

    } catch (error) {
        console.error("Error generating gift link:", error);
        showMessageBox("Failed to generate link. Check inputs and console.", "❌");
    }
}

function updateMessageCharCount() {
    const messageInput = document.getElementById('personal-message');
    const countSpan = document.getElementById('message-char-count');
    if (messageInput && countSpan) {
        countSpan.textContent = messageInput.value.length;
    }
}

function handleBuilderPage() {
    console.log("Builder Page: Initializing UI and listeners.");
    
    // 1. Setup Flower Selector UI
    populateFlowerSelector(); 
    
    // 2. Setup Generate Button Listener
    const generateButton = document.getElementById('generate-button');
    if (generateButton) {
        generateButton.onclick = generateGiftLink;
    }

    // 3. Setup Character Count Listener
    const messageInput = document.getElementById('personal-message');
    if (messageInput) {
        messageInput.addEventListener('input', updateMessageCharCount);
        updateMessageCharCount(); // Initial count
    }

    // 4. Setup Enter Key for Clicks Input (optional but nice UX)
    const clicksInput = document.getElementById('watering-clicks');
    if (clicksInput) {
        clicksInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent form submission
                generateGiftLink();
            }
        });
    }

    // Initialize state with default values if not already set
    if (!builderState.flower_type) {
        builderState.flower_type = FLOWER_TYPES[0];
        populateFlowerSelector();
    }
}

// --- MAIN EXECUTION ---

const isBuilderPage = document.title.includes('Create Your Personalized Flower Gift');

// Ensure Firebase is initialized regardless of page type
initializeFirebase();

// Run page-specific logic after initialization
if (isBuilderPage) {
    // Only run builder setup after the DOM is fully loaded
    document.addEventListener('DOMContentLoaded', handleBuilderPage);
} 
// Logic for Gift.HTML is handled in the onAuthStateChanged listener and checkUrlForFlowerId
// (The onAuthStateChanged listener will call checkUrlForFlowerId and setupFlowerCollectionListener)

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
        // No action needed for builder page here, as flower selector images are handled by the browser
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
