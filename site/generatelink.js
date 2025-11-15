// This script runs the link generation when the button is clicked in builder.html

function generateLink() {
    const flower = document.getElementById('flower-select').value;
    const message = document.getElementById('message-input').value;
    const music = document.getElementById('music-input').value; 
    const theme = document.getElementById('theme-select').value;
    const sparkleEnabled = document.getElementById('sparkle-check').checked;
    
    // CRITICAL FIX: Get the selected water count
    const requiredClicks = document.getElementById('water-count-select').value; 

    // Encode values
    const encodedMessage = encodeURIComponent(message);
    const encodedMusic = encodeURIComponent(music); 

    const giftPage = 'gift.html'; 

    // FINAL URL CONSTRUCTION: MUST include the 'clicks' parameter
    const finalLink = `${giftPage}?flower=${flower}&message=${encodedMessage}&music=${encodedMusic}&theme=${theme}&sparkle=${sparkleEnabled}&clicks=${requiredClicks}`;

    const outputDiv = document.getElementById('output-link');
    outputDiv.innerHTML = `<a href="${finalLink}" target="_blank">${finalLink}</a>`;
}