// =========================================================
// 1. FIREBASE CONFIGURATION & INITIALIZATION
// =========================================================
// !!! PASTE YOUR REAL FIREBASE CONFIG HERE !!!
const firebaseConfig = {
  apiKey: "AIzaSyCC1QeQsUiSxLoKTJfAomwuW2CPJsYe5mU",
  authDomain: "flower-gift-b16b9.firebaseapp.com",
  projectId: "flower-gift-b16b9",
  storageBucket: "flower-gift-b16b9.firebasestorage.app",
  messagingSenderId: "508370263382",
  appId: "1:508370263382:web:27c88f5cf0a9b3435d0af7"
};

let db, auth;
let currentGiftData = {};

try {
    // Assuming the HTML files load the Firebase compat SDKs via CDN
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
    // Sign in anonymously to save/retrieve user gardens
    auth.signInAnonymously().catch(e => console.error("Firebase Auth Error:", e));
} catch (e) {
    console.error("Firebase Initialization Failed. Check your config keys.", e);
}


// =========================================================
// 2. ASSETS & CONSTANTS
// =========================================================
const FLOWER_IMAGES = {
    'Rose': 'https://placehold.co/200x200/FF69B4/000?text=Rose',
    'Tulip': 'https://placehold.co/200x200/FFD700/000?text=Tulip',
    'Daisy': 'https://placehold.co/200x200/FFFFFF/000?text=Daisy',
    'Orchid': 'https://placehold.co/200x200/A020F0/000?text=Orchid'
};

const THEMES = {
    'Forest': '#4B5320',
    'Lavender': '#E6E6FA',
    'Sunshine': '#FFFACD',
    'Ocean': '#E0F7FA'
};


// =========================================================
// 3. BUILDER LOGIC (For index.html or gift-builder.html)
// =========================================================

/**
 * Handles the visual selection of a flower in the builder UI.
 * @param {string} flowerName - The name of the flower.
 * @param {HTMLElement} btnElement - The button element clicked.
 */
window.selectFlower = (flowerName, btnElement) => {
    const hiddenInput = document.getElementById('selected-flower');
    if (!hiddenInput) return; // Not on the builder page

    hiddenInput.value = flowerName;
    
    // Visual Update (remove 'selected' from all, add to current)
    document.querySelectorAll('.flower-button').forEach(b => b.classList.remove('flower-selected'));
    btnElement.classList.add('flower-selected');
};

/**
 * Generates the shareable link based on builder inputs.
 * Uses URL parameters instead of Firestore to make sharing simpler.
 */
window.generateLink = () => {
    const flower = document.getElementById('selected-flower')?.value || 'Rose';
    const message = encodeURIComponent(document.getElementById('input-message')?.value || "A gift for you!");
    const theme = document.getElementById('input-theme')?.value || 'Forest';
    const clicks = document.getElementById('input-clicks')?.value || '5';

    if (!document.getElementById('share-link')) {
        console.error("Missing UI elements for link generation.");
        return;
    }

    // Determine the base URL dynamically and point to the viewer page (e.g., gift.html)
    // NOTE: If you consolidate to index.html, change 'gift.html' to 'index.html'
    const baseUrl = window.location.href.split('?')[0];
    const targetPage = baseUrl.endsWith('index.html') ? baseUrl : baseUrl.replace(/[^/]*$/, 'gift.html');

    const fullLink = `${targetPage}?flower=${flower}&message=${message}&theme=${theme}&clicks=${clicks}`;

    document.getElementById('share-link').innerText = fullLink;
    document.getElementById('result-area').classList.remove('hidden');
};

/**
 * Copies the generated link to the clipboard.
 */
window.copyLink = () => {
    const linkText = document.getElementById('share-link')?.innerText;
    if (linkText) {
        navigator.clipboard.writeText(linkText).then(() => {
            alert("Link copied to clipboard!");
        });
    }
};


// =========================================================
// 4. GARDEN/VIEWER LOGIC (For gift.html or index.html Viewer)
// =========================================================

let clicksLeft = 0;
let totalClicks = 0;

/**
 * Initializes the viewer state based on URL parameters.
 */
const initializeViewer = () => {
    const params = new URLSearchParams(window.location.search);
    
    if (params.has('flower')) {
        currentGiftData = {
            flower: params.get('flower'),
            message: decodeURIComponent(params.get('message')),
            theme: params.get('theme'),
            clicks: parseInt(params.get('clicks')) || 5
        };
        
        totalClicks = currentGiftData.clicks;
        clicksLeft = totalClicks;

        // Apply Theme and set initial text
        if (THEMES[currentGiftData.theme]) {
            document.body.style.backgroundColor = THEMES[currentGiftData.theme];
        }
        document.getElementById('clicks-left-text').innerText = `${totalClicks} drops needed`;
    }
};

/**
 * Handles a user 'watering' the plant.
 */
window.waterPlant = () => {
    if (clicksLeft > 0) {
        clicksLeft--;
        
        // UI Updates
        const currentClicks = totalClicks - clicksLeft;
        const percentage = (currentClicks / totalClicks) * 100;

        document.getElementById('progress-bar').style.width = `${percentage}%`;
        document.getElementById('clicks-left-text').innerText = 
            clicksLeft > 0 ? `${clicksLeft} drops left` : "Blooming...";
        
        // Sprout size feedback
        const sprout = document.getElementById('sprout-img');
        if (sprout) {
             sprout.style.transform = `scale(${1 + (currentClicks / totalClicks) * 0.5})`;
        }

        if (clicksLeft === 0) {
            bloom();
        }
    }
};

/**
 * Reveals the final flower and message.
 */
const bloom = () => {
    document.getElementById('stage-seed')?.classList.add('hidden');
    document.getElementById('stage-bloom')?.classList.remove('hidden');
    
    document.getElementById('final-flower').src = FLOWER_IMAGES[currentGiftData.flower] || FLOWER_IMAGES['Rose'];
    document.getElementById('message-text').innerText = currentGiftData.message;

    saveToGarden();
};

/**
 * Saves the gift data to the user's Firestore collection.
 */
const saveToGarden = () => {
    if (!auth.currentUser || !db || currentGiftData.saved) return;
    
    auth.onAuthStateChanged(user => {
        if (user) {
            db.collection('users').doc(user.uid).collection('garden').add({
                flower: currentGiftData.flower,
                message: currentGiftData.message,
                receivedAt: firebase.firestore.FieldValue.serverTimestamp(),
                x: Math.random(), 
                y: Math.random() 
            }).then(() => {
                console.log("Flower saved to garden!");
                currentGiftData.saved = true; // Prevent re-saving
                document.getElementById('nav-btn')?.classList.remove('hidden'); // Show button after save
            }).catch(e => {
                console.error("Error saving flower:", e);
            });
        }
    });
};

/**
 * Draws all saved flowers onto the canvas.
 */
window.drawGarden = () => {
    const canvas = document.getElementById('garden-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = 800;
    canvas.height = 500;
    
    ctx.fillStyle = "#3e2723"; // Soil background
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    auth.onAuthStateChanged(user => {
        if (user) {
            db.collection('users').doc(user.uid).collection('garden').get().then((querySnapshot) => {
                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    const img = new Image();
                    img.src = FLOWER_IMAGES[data.flower];
                    
                    img.onload = () => {
                        const size = 60;
                        const x = data.x * (canvas.width - size);
                        const y = data.y * (canvas.height - size);
                        ctx.drawImage(img, x, y, size, size);
                    };
                });
            });
        }
    });
};

/**
 * Toggles between the gift view and the garden view (used by a nav button).
 */
window.toggleGarden = () => {
    const giftContainer = document.getElementById('gift-container');
    const gardenContainer = document.getElementById('garden-container');
    const navBtn = document.getElementById('nav-btn');

    const isGiftVisible = !giftContainer?.classList.contains('hidden');

    if (isGiftVisible) {
        // Switch to Garden
        giftContainer?.classList.add('hidden');
        gardenContainer?.classList.remove('hidden');
        document.body.style.backgroundColor = '#2F3515';
        navBtn.innerText = "Back to Gift 🎁";
        drawGarden();
    } else {
        // Switch to Gift
        gardenContainer?.classList.add('hidden');
        giftContainer?.classList.remove('hidden');
        document.body.style.backgroundColor = THEMES[currentGiftData.theme] || '#fcfcfc';
        navBtn.innerText = "View Garden 🪴";
    }
}


// =========================================================
// 5. GLOBAL INITIALIZATION
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
    // This runs logic that is common to both pages or is part of the viewer page.
    // It's safe to run on both if the functions check for the existence of UI elements.
    initializeViewer();
});

