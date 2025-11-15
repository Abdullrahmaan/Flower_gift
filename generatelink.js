document.addEventListener('DOMContentLoaded', () => {
    const generateButton = document.getElementById('generate-button');
    const messageInput = document.getElementById('message');
    const flowerSelect = document.getElementById('flower-select');
    const themeSelect = document.getElementById('theme-select');
    const clicksInput = document.getElementById('clicks');
    
    const linkTextElement = document.getElementById('link-text');
    const copyButton = document.getElementById('copy-button');

    const musicUrl = 'https://tonejs.github.io/examples/audio/casio/A2.mp3'; 

    const generateLink = () => {
        const message = encodeURIComponent(messageInput.value.trim());
        const flower = flowerSelect.value;
        const theme = themeSelect.value;
        const clicks = Math.max(1, Math.min(10, parseInt(clicksInput.value) || 3)); 
        let baseUrl = window.location.href;
        
    
        const lastSlashIndex = baseUrl.lastIndexOf('/');
        if (lastSlashIndex > -1) {
            baseUrl = baseUrl.substring(0, lastSlashIndex + 1);
        }
        
        const link = `${baseUrl}gift.html?message=${message}&flower=${flower}&theme=${theme}&clicks=${clicks}&music=${encodeURIComponent(musicUrl)}&sparkle=${sparkleEnabled}`;
        
        linkTextElement.textContent = link;
        linkTextElement.classList.remove('hidden');
        copyButton.classList.remove('hidden');
        
        generateButton.textContent = 'Link Generated! Copy Below.';
        generateButton.classList.add('bg-green-500', 'hover:bg-green-600');
        generateButton.classList.remove('bg-[#7B68EE]', 'hover:bg-[#6A5ACD]');
    };

    const copyLink = () => {
        const linkToCopy = linkTextElement.textContent;
        
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

    generateButton.addEventListener('click', generateLink);
    copyButton.addEventListener('click', copyLink);
});
