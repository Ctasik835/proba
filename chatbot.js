// Умный чат-бот для карты МГЭС
(function() {
    // Стили бота (добавляются динамически)
    const style = document.createElement('style');
    style.textContent = `
        .chatbot-button {
            position: fixed;
            bottom: 25px;
            right: 25px;
            width: 60px;
            height: 60px;
            background-color: #9e2a2a;
            border-radius: 50%;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999;
            transition: transform 0.2s;
        }
        .chatbot-button:hover {
            transform: scale(1.05);
        }
        .chatbot-button img {
            width: 36px;
            height: 36px;
            filter: invert(1);
        }
        .chatbot-window {
            position: fixed;
            bottom: 100px;
            right: 25px;
            width: 350px;
            height: 500px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 5px 25px rgba(0,0,0,0.2);
            display: flex;
            flex-direction: column;
            z-index: 1000;
            overflow: hidden;
            transition: all 0.3s ease;
            border: 1px solid #ddd;
        }
        .chatbot-window.closed {
            display: none;
        }
        .chatbot-header {
            background: #9e2a2a;
            color: white;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: bold;
        }
        .chatbot-header button {
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
        }
        .chatbot-messages {
            flex: 1;
            padding: 12px;
            overflow-y: auto;
            background: #f9f9f9;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .message {
            max-width: 85%;
            padding: 8px 12px;
            border-radius: 12px;
            font-size: 14px;
            line-height: 1.4;
        }
        .user-message {
            background: #e8f4f8;
            align-self: flex-end;
            border-bottom-right-radius: 2px;
        }
        .bot-message {
            background: white;
            align-self: flex-start;
            border-bottom-left-radius: 2px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
            border: 1px solid #eee;
        }
        .chatbot-input {
            display: flex;
            border-top: 1px solid #ddd;
            background: white;
        }
        .chatbot-input input {
            flex: 1;
            padding: 12px;
            border: none;
            outline: none;
            font-size: 14px;
        }
        .chatbot-input button {
            background: #9e2a2a;
            border: none;
            color: white;
            padding: 0 16px;
            cursor: pointer;
            font-weight: bold;
        }
        .quick-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            padding: 8px 12px;
            background: #f0f0f0;
            border-top: 1px solid #ddd;
        }
        .quick-btn {
            background: #e9ecef;
            border: none;
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 12px;
            cursor: pointer;
            color: #333;
        }
        .quick-btn:hover {
            background: #cbd5e1;
        }
        .route-link {
            background: #9e2a2a;
            color: white;
            padding: 4px 8px;
            border-radius: 20px;
            text-decoration: none;
            font-size: 12px;
            display: inline-block;
            margin-top: 6px;
        }
        .coordinates {
            font-family: monospace;
            font-size: 12px;
            background: #f0f0f0;
            padding: 4px;
            border-radius: 4px;
            margin-top: 6px;
        }
        @media (max-width: 480px) {
            .chatbot-window { width: 90%; right: 5%; left: 5%; bottom: 80px; }
        }
    `;
    document.head.appendChild(style);

    // DOM элементы
    let chatWindow = null;
    let messagesContainer = null;
    let inputField = null;

    // Инициализация бота
    function initChatbot() {
        // Создаём кнопку
        const button = document.createElement('div');
        button.className = 'chatbot-button';
        button.innerHTML = '💬';
        button.style.fontSize = '32px';
        button.style.lineHeight = '1';
        button.style.color = 'white';
        button.style.fontWeight = 'bold';
        document.body.appendChild(button);

        // Создаём окно чата
        const windowDiv = document.createElement('div');
        windowDiv.className = 'chatbot-window closed';
        windowDiv.innerHTML = `
            <div class="chatbot-header">
                <span>🤖 Гид по МГЭС</span>
                <button id="closeChatBtn">✖</button>
            </div>
            <div class="chatbot-messages"></div>
            <div class="quick-buttons">
                <button class="quick-btn" data-question="Сколько всего МГЭС?">📊 Статистика</button>
                <button class="quick-btn" data-question="Какие ГЭС отреставрированы?">🏠 Отреставрированные</button>
                <button class="quick-btn" data-question="Заброшенные ГЭС">🏚️ Заброшенные</button>
                <button class="quick-btn" data-question="Покажи все ГЭС в Ленинградской области">📍 Все</button>
            </div>
            <div class="chatbot-input">
                <input type="text" placeholder="Спросите про ГЭС..." id="chatInput">
                <button id="sendChatBtn">→</button>
            </div>
        `;
        document.body.appendChild(windowDiv);
        chatWindow = windowDiv;
        messagesContainer = chatWindow.querySelector('.chatbot-messages');
        inputField = chatWindow.querySelector('#chatInput');
        const sendBtn = chatWindow.querySelector('#sendChatBtn');
        const closeBtn = chatWindow.querySelector('#closeChatBtn');

        // Открытие/закрытие
        button.addEventListener('click', () => {
            chatWindow.classList.remove('closed');
            inputField.focus();
        });
        closeBtn.addEventListener('click', () => {
            chatWindow.classList.add('closed');
        });

        // Отправка сообщения
        function sendMessage() {
            const text = inputField.value.trim();
            if (!text) return;
            addMessage(text, 'user');
            inputField.value = '';
            processUserQuery(text);
        }

        sendBtn.addEventListener('click', sendMessage);
        inputField.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });

        // Быстрые кнопки
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const question = btn.getAttribute('data-question');
                addMessage(question, 'user');
                processUserQuery(question);
            });
        });

        // Приветствие
        setTimeout(() => {
            addMessage("Привет! Я знаю всё о МГЭС на этой карте. Спроси меня, например: «Где находится Сосновская ГЭС?» или «Покажи заброшенные в Гатчинском районе».", 'bot');
        }, 500);
    }

    // Добавление сообщения в чат
    function addMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender === 'user' ? 'user-message' : 'bot-message'}`;
        // Обработка простых ссылок (если есть)
        if (sender === 'bot' && text.includes('http')) {
            msgDiv.innerHTML = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
        } else {
            msgDiv.textContent = text;
        }
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // === УМНАЯ ОБРАБОТКА ЗАПРОСОВ ===
    function processUserQuery(query) {
        const lowerQuery = query.toLowerCase().trim();
        const data = window.mgesData; // используем глобальный массив из main.js

        if (!data || data.length === 0) {
            addMessage("Извините, данные о ГЭС ещё не загружены. Попробуйте обновить страницу.", 'bot');
            return;
        }

        // 1. Статистика
        if (lowerQuery.includes('сколько') || (lowerQuery.includes('статистик') && lowerQuery.includes('гэс'))) {
            const total = data.length;
            const abandoned = data.filter(s => s.status === 'заброшена').length;
            const restored = data.filter(s => s.status === 'отреставрирована').length;
            addMessage(`📊 На карте ${total} МГЭС. Из них заброшенных: ${abandoned}, отреставрированных: ${restored}.`, 'bot');
            return;
        }

        // 2. Поиск по статусу
        if (lowerQuery.includes('заброшен') && !lowerQuery.includes('отреставрир')) {
            const abandonedList = data.filter(s => s.status === 'заброшена').map(s => s.name).join(', ');
            addMessage(`🏚️ Заброшенные ГЭС: ${abandonedList || 'нет'}. Чтобы узнать подробнее, спросите конкретную станцию.`, 'bot');
            return;
        }
        if (lowerQuery.includes('отреставрир')) {
            const restoredList = data.filter(s => s.status === 'отреставрирована').map(s => s.name).join(', ');
            addMessage(`🏠 Отреставрированные ГЭС: ${restoredList || 'нет'}.`, 'bot');
            return;
        }

        // 3. Поиск по региону
        const regionMatch = lowerQuery.match(/(?:в|из|район[е]?)\s+([а-яё\s]+?)(?:\?|$|\.)/i);
        if (regionMatch && !lowerQuery.includes('названи')) {
            const regionName = regionMatch[1].trim().toLowerCase();
            const filtered = data.filter(s => s.region.toLowerCase().includes(regionName));
            if (filtered.length > 0) {
                const list = filtered.map(s => s.name).join(', ');
                addMessage(`📍 В регионе "${regionName}" найдено ${filtered.length} ГЭС: ${list}. Спросите любую подробнее.`, 'bot');
            } else {
                addMessage(`Не нашёл ГЭС в регионе "${regionName}". Проверьте название (например, Лужский, Гатчинский, Приозерский).`, 'bot');
            }
            return;
        }

        // 4. Поиск по названию ГЭС (или части названия)
        const words = lowerQuery.split(/\s+/);
        let foundStations = [];
        for (let station of data) {
            const nameLow = station.name.toLowerCase();
            const oldNameLow = (station.oldName || '').toLowerCase();
            if (nameLow.includes(lowerQuery) || oldNameLow.includes(lowerQuery) ||
                words.some(w => w.length > 3 && nameLow.includes(w))) {
                foundStations.push(station);
            }
        }
        if (foundStations.length === 1) {
            const s = foundStations[0];
            const statusText = s.status === 'заброшена' ? '🏚️ Заброшена' : '🏠 Отреставрирована';
            const closedText = s.yearClosed ? ` (закрыта в ${s.yearClosed})` : '';
            let answer = `${s.name} (${s.region}) — ${statusText}${closedText}. Построена в ${s.yearBuilt}, мощность ${s.power}. ${s.techDesc.substring(0, 150)}...`;
            // Добавим кнопку маршрута
            addMessage(answer, 'bot');
            addMessage(`🗺️ Вот ссылка на маршрут к ${s.name}: https://yandex.ru/maps/?pt=${s.lon},${s.lat}&z=17&l=map`, 'bot');
            return;
        } else if (foundStations.length > 1) {
            const names = foundStations.map(s => s.name).join(', ');
            addMessage(`Найдено несколько ГЭС: ${names}. Уточните, какая именно вас интересует.`, 'bot');
            return;
        }

        // 5. Общие вопросы про возможность спросить
        if (lowerQuery.includes('что ты умеешь') || lowerQuery.includes('какие вопросы')) {
            addMessage("Я умею отвечать: сколько всего ГЭС, какие заброшены/отреставрированы, показывать ГЭС по региону (например, «в Гатчинском районе»), по названию. Спроси про конкретную станцию — расскажу историю и технические детали.", 'bot');
            return;
        }

        // 6. Если ничего не понял
        addMessage("Не совсем понял. Вы можете спросить: «Сколько ГЭС?», «Какие заброшенные?», «Вырицкая ГЭС», «в Приозерском районе».", 'bot');
    }

    // Запуск, когда DOM готов
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChatbot);
    } else {
        initChatbot();
    }
})();