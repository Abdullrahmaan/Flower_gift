document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration Variables ---
    const musicUrl = 'https://tonejs.github.io/examples/audio/casio/A2.mp3'; // Default music URL
    const sparkleEnabled = 'true'; // Default sparkle setting (Used for link generation)

    // --- DOM Elements ---
    const generateButton = document.getElementById('generate-button');
    const messageInput = document.getElementById('message');
    const flowerSelect = document.getElementById('flower-select');
    const themeSelect = document.getElementById('theme-select');
    const clicksInput = document.getElementById('clicks');
    
    const linkTextElement = document.getElementById('link-text');
    const copyButton = document.getElementById('copy-button');


    const generateLink = () => {
        const message = encodeURIComponent(messageInput.value.trim());
        const flower = flowerSelect.value;
        const theme = themeSelect.value;
        const clicks = Math.max(1, Math.min(10, parseInt(clicksInput.value) || 3)); // Clamp clicks between 1 and 10

        // --- FIX: Robust Base URL Calculation ---
        // Get the current base URL (e.g., https://abdullrahmaan.github.io/Flower_gift/)
        let baseUrl = window.location.href;
        
        // Find the last slash (/) and take the path up to and including it.
        // This removes the file name (index.html or builder.html) if it exists.
        const lastSlashIndex = baseUrl.lastIndexOf('/');
        if (lastSlashIndex > -1) {
            baseUrl = baseUrl.substring(0, lastSlashIndex + 1);
        }
        
        // The generated link should point to 'gift.html' in the base directory
        // NOTE: sparkleEnabled is now correctly accessed from the top-level scope.
        const link = `${baseUrl}gift.html?message=${message}&flower=${flower}&theme=${theme}&clicks=${clicks}&music=${encodeURIComponent(musicUrl)}&sparkle=${sparkleEnabled}`;
        // --- END FIX ---
        
        linkTextElement.textContent = link;
        linkTextElement.classList.remove('hidden');
        copyButton.classList.remove('hidden');
        
        // Update button text and style
        generateButton.textContent = 'Link Generated! Copy Below.';
        generateButton.classList.add('bg-green-500', 'hover:bg-green-600');
        generateButton.classList.remove('bg-[#7B68EE]', 'hover:bg-[#6A5ACD]');
    };

    const copyLink = () => {
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

    // --- Event Listeners ---
    generateButton.addEventListener('click', generateLink);
    copyButton.addEventListener('click', copyLink);
});
