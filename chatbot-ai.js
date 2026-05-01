// Чат-бот с YandexGPT через Yandex Cloud Functions
(function() {
    const PROXY_URL = 'https://functions.yandexcloud.net/d4e7vi4aes1eeep2k8tr'; // ЗАМЕНИТЕ НА СВОЙ URL

    // Стили (оставляем те же, что были)
    const style = document.createElement('style');
    style.textContent = `
        .chatbot-button { position: fixed; bottom: 25px; right: 25px; width: 60px; height: 60px; background-color: #9e2a2a; border-radius: 50%; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; z-index: 999; font-size: 32px; color: white; transition: transform 0.2s; }
        .chatbot-button:hover { transform: scale(1.05); }
        .chatbot-window { position: fixed; bottom: 100px; right: 25px; width: 350px; height: 500px; background: white; border-radius: 16px; box-shadow: 0 5px 25px rgba(0,0,0,0.2); display: flex; flex-direction: column; z-index: 1000; overflow: hidden; border: 1px solid #ddd; transition: all 0.3s ease; }
        .chatbot-window.closed { display: none; }
        .chatbot-header { background: #9e2a2a; color: white; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
        .chatbot-header button { background: none; border: none; color: white; font-size: 20px; cursor: pointer; }
        .chatbot-messages { flex: 1; padding: 12px; overflow-y: auto; background: #f9f9f9; display: flex; flex-direction: column; gap: 8px; }
        .message { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 14px; line-height: 1.4; }
        .user-message { background: #e8f4f8; align-self: flex-end; border-bottom-right-radius: 2px; }
        .bot-message { background: white; align-self: flex-start; border-bottom-left-radius: 2px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border: 1px solid #eee; }
        .chatbot-input { display: flex; border-top: 1px solid #ddd; background: white; }
        .chatbot-input input { flex: 1; padding: 12px; border: none; outline: none; font-size: 14px; }
        .chatbot-input button { background: #9e2a2a; border: none; color: white; padding: 0 16px; cursor: pointer; font-weight: bold; }
        .typing { font-style: italic; color: #888; }
        @media (max-width: 480px) { .chatbot-window { width: 90%; right: 5%; left: 5%; bottom: 80px; } }
    `;
    document.head.appendChild(style);

    let chatWindow, messagesContainer, inputField;

    function addMessage(text, sender, isTyping = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender === 'user' ? 'user-message' : 'bot-message'}`;
        if (isTyping) msgDiv.classList.add('typing');
        msgDiv.textContent = text;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return msgDiv;
    }

    function showTyping() {
        return addMessage('Анализирую запрос...', 'bot', true);
    }

    async function askAI(question, context) {
        try {
            const response = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, context })
            });
            const data = await response.json();
            return data.answer || 'Не удалось получить ответ. Попробуйте позже.';
        } catch (e) {
            console.error(e);
            return 'Ошибка соединения с ИИ. Проверьте интернет или попробуйте позже.';
        }
    }

    // Локальная обработка (чтобы не тратить вызовы GPT)
    function localAnswer(query, data) {
        const q = query.toLowerCase();
        if (q.includes('сколько') || (q.includes('статистик') && q.includes('гэс'))) {
            const total = data.length;
            const abandoned = data.filter(s => s.status === 'заброшена').length;
            const restored = data.filter(s => s.status === 'отреставрирована').length;
            return `📊 На карте ${total} МГЭС. Из них заброшенных: ${abandoned}, отреставрированных: ${restored}.`;
        }
        if (q.includes('заброшен') && !q.includes('отреставрир')) {
            const list = data.filter(s => s.status === 'заброшена').map(s => s.name).join(', ');
            return `🏚️ Заброшенные ГЭС: ${list || 'нет'}.`;
        }
        if (q.includes('отреставрир')) {
            const list = data.filter(s => s.status === 'отреставрирована').map(s => s.name).join(', ');
            return `🏠 Отреставрированные ГЭС: ${list || 'нет'}.`;
        }
        const matchRegion = q.match(/(?:в|из|район[е]?)\s+([а-яё\s]+)/i);
        if (matchRegion) {
            const region = matchRegion[1].trim().toLowerCase();
            const found = data.filter(s => s.region.toLowerCase().includes(region));
            if (found.length) {
                return `📍 В регионе "${region}" найдено ${found.length} ГЭС: ${found.map(s=>s.name).join(', ')}.`;
            }
        }
        const station = data.find(s => s.name.toLowerCase().includes(q) || (s.oldName && s.oldName.toLowerCase().includes(q)));
        if (station) {
            return `${station.name} (${station.region}) — ${station.status === 'заброшена' ? 'заброшена' : 'отреставрирована'}. Построена в ${station.yearBuilt}, мощность ${station.power}. Полную историю и маршрут смотрите на карте. Задайте уточняющий вопрос.`;
        }
        return null;
    }

    async function processUserQuery(query) {
        const data = window.mgesData;
        if (!data || data.length === 0) {
            addMessage('Данные о ГЭС ещё не загружены. Обновите страницу.', 'bot');
            return;
        }
        const localAns = localAnswer(query, data);
        if (localAns) {
            addMessage(localAns, 'bot');
            return;
        }
        const typingDiv = showTyping();
        const context = `У нас есть такие гидроэлектростанции: ${data.map(s => `${s.name} (${s.region}, статус: ${s.status}, мощность ${s.power})`).join('; ')}. Ты эксперт по МГЭС Ленинградской области. Отвечай кратко и только по теме.`;
        const answer = await askAI(query, context);
        typingDiv.remove();
        addMessage(answer, 'bot');
    }

    function init() {
        const btn = document.createElement('div');
        btn.className = 'chatbot-button';
        btn.innerHTML = '💬';
        document.body.appendChild(btn);

        const win = document.createElement('div');
        win.className = 'chatbot-window closed';
        win.innerHTML = `
            <div class="chatbot-header"><span>🤖 ИИ-гид по МГЭС</span><button id="closeChatBtn">✖</button></div>
            <div class="chatbot-messages"></div>
            <div class="chatbot-input"><input type="text" id="chatInput" placeholder="Спросите про любую ГЭС..."><button id="sendChatBtn">→</button></div>
        `;
        document.body.appendChild(win);
        chatWindow = win;
        messagesContainer = win.querySelector('.chatbot-messages');
        inputField = win.querySelector('#chatInput');
        const sendBtn = win.querySelector('#sendChatBtn');
        const closeBtn = win.querySelector('#closeChatBtn');

        btn.onclick = () => { chatWindow.classList.remove('closed'); inputField.focus(); };
        closeBtn.onclick = () => chatWindow.classList.add('closed');
        const send = () => {
            const text = inputField.value.trim();
            if (!text) return;
            addMessage(text, 'user');
            inputField.value = '';
            processUserQuery(text);
        };
        sendBtn.onclick = send;
        inputField.onkeypress = (e) => { if (e.key === 'Enter') send(); };
        addMessage('Привет! Я AI-помощник. Спроси меня о любой МГЭС: историю, технические детали, маршрут – я подключён к YandexGPT и отвечу умно.', 'bot');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
