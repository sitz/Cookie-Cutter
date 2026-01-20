// Cookie Cutter Popup Script

document.addEventListener('DOMContentLoaded', () => {
    const enableToggle = document.getElementById('enableToggle');
    const totalAccepted = document.getElementById('totalAccepted');
    const sitesProcessed = document.getElementById('sitesProcessed');
    const currentStatus = document.getElementById('currentStatus');
    const container = document.querySelector('.container');

    // Load current state
    chrome.storage.local.get(['enabled', 'stats'], (result) => {
        const isEnabled = result.enabled !== false;
        enableToggle.checked = isEnabled;
        updateUI(isEnabled);

        const stats = result.stats || { totalAccepted: 0, sitesProcessed: [] };
        totalAccepted.textContent = stats.totalAccepted;
        sitesProcessed.textContent = stats.sitesProcessed.length;
    });

    // Handle toggle change
    enableToggle.addEventListener('change', () => {
        const isEnabled = enableToggle.checked;
        chrome.storage.local.set({ enabled: isEnabled });
        updateUI(isEnabled);
    });

    function updateUI(isEnabled) {
        const statusDot = currentStatus.querySelector('.status-dot');
        const statusText = currentStatus.querySelector('span:last-child');

        if (isEnabled) {
            container.classList.remove('disabled');
            statusDot.classList.add('active');
            statusDot.classList.remove('inactive');
            statusText.textContent = 'Active on this page';
        } else {
            container.classList.add('disabled');
            statusDot.classList.remove('active');
            statusDot.classList.add('inactive');
            statusText.textContent = 'Disabled';
        }
    }

    // Report Issue button
    const reportIssue = document.getElementById('reportIssue');
    reportIssue.addEventListener('click', async () => {
        // Get current tab URL
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url || 'Unknown';
        let domain = 'Unknown';

        try {
            domain = new URL(url).hostname;
        } catch (e) {
            domain = url;
        }

        const title = encodeURIComponent(`Cookie banner not auto-accepted: ${domain}`);
        const issueUrl = `https://github.com/sitz/Cookie-Cutter/issues/new?title=${title}&labels=bug`;
        chrome.tabs.create({ url: issueUrl });
    });
});
