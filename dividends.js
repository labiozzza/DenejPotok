// dividends.js

const DIVIDEND_INTERVAL = 12; // каждые 12 ходов
let turnCounter = 0;

function createDividendModal(ticker, dividendPercent, dividendAmount) {
    // Если модалка уже есть — удалим
    const oldModal = document.getElementById("dividendModal");
    if (oldModal) oldModal.remove();

    const modal = document.createElement("div");
    modal.id = "dividendModal";
    modal.style.position = "fixed";
    modal.style.top = 0;
    modal.style.left = 0;
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.background = "rgba(0, 0, 0, 0.5)";
    modal.style.display = "flex";
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.style.zIndex = 9999;

    modal.innerHTML = `
        <div style="background: white; padding: 20px; border-radius: 8px; max-width: 400px; text-align: center;">
            <h2>Дивиденды!</h2>
            <p>Компания <b>${ticker}</b> объявила дивиденды в размере <b>${dividendPercent}%</b>.</p>
            <p>Вам начислено: <b>$${dividendAmount}</b></p>
            <button id="closeDividendModal" style="padding: 8px 15px; margin-top: 10px;">OK</button>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("closeDividendModal").addEventListener("click", () => {
        modal.remove();
    });
}

function handleDividends() {
    turnCounter++;

    if (turnCounter % DIVIDEND_INTERVAL === 0) {
        const ticker = TICKERS[Math.floor(Math.random() * TICKERS.length)];
        const lastPrice = STATE[ticker][STATE[ticker].length - 1];

        const dividendPercent = Math.floor(Math.random() * 11) + 5; // 5–15%
        let dividendAmount = Math.round((lastPrice * dividendPercent) / 100);
        if (dividendAmount < 1) dividendAmount = 1;

        // Падение цены
        let newPrice = Math.max(PRICE_MIN, lastPrice - dividendAmount);
        STATE[ticker].push(newPrice);

        updateChart(ticker, STATE[ticker]);

        // Показ модалки
        createDividendModal(ticker, dividendPercent, dividendAmount);
    }
}

function initDividendSystem() {
    const nextBtn = document.getElementById("nextBtn");
    if (!nextBtn) return;

    nextBtn.addEventListener("click", () => {
        handleDividends();
    });

    const resetBtn = document.getElementById("resetBtn");
    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            turnCounter = 0;
        });
    }
}

// Запуск системы после загрузки страницы
document.addEventListener("DOMContentLoaded", initDividendSystem);
