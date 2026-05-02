// Локальный чат-бот для карты МГЭС – отвечает на все вопросы из списка
(function() {
    const styles = `
        .chatbot-button {
            position: fixed; bottom: 25px; right: 25px; width: 60px; height: 60px;
            background-color: #9e2a2a; border-radius: 50%; cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2); display: flex; align-items: center;
            justify-content: center; z-index: 999; font-size: 32px; color: white;
            transition: transform 0.2s;
        }
        .chatbot-button:hover { transform: scale(1.05); }
        .chatbot-window {
            position: fixed; bottom: 100px; right: 25px; width: 350px; height: 500px;
            background: #fff; border-radius: 16px; box-shadow: 0 5px 25px rgba(0,0,0,0.2);
            display: flex; flex-direction: column; z-index: 1000; overflow: hidden;
            border: 1px solid #ddd; transition: 0.3s ease;
        }
        .chatbot-window.closed { display: none; }
        .chatbot-header {
            background: #9e2a2a; color: white; padding: 12px 16px;
            display: flex; justify-content: space-between; align-items: center;
            font-weight: bold;
        }
        .chatbot-header button { background: none; border: none; color: white; font-size: 20px; cursor: pointer; }
        .chatbot-messages { flex: 1; padding: 12px; overflow-y: auto; background: #f9f9f9; display: flex; flex-direction: column; gap: 8px; }
        .message { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 14px; line-height: 1.4; }
        .user-message { background: #e8f4f8; align-self: flex-end; border-bottom-right-radius: 2px; }
        .bot-message { background: white; align-self: flex-start; border-bottom-left-radius: 2px; border: 1px solid #eee; }
        .chatbot-input { display: flex; border-top: 1px solid #ddd; background: #fff; }
        .chatbot-input input { flex: 1; padding: 12px; border: none; outline: none; font-size: 14px; }
        .chatbot-input button { background: #9e2a2a; border: none; color: white; padding: 0 16px; cursor: pointer; font-weight: bold; }
        .quick-buttons {
            display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px;
            background: #f0f0f0; border-top: 1px solid #ddd;
        }
        .quick-btn {
            background: #e9ecef; border: none; padding: 5px 10px;
            border-radius: 20px; font-size: 12px; cursor: pointer;
        }
        @media (max-width: 480px) {
            .chatbot-window { width: 90%; right: 5%; left: 5%; bottom: 80px; }
        }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);

    let chatWindow, messagesContainer, inputField;

    function addMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender === 'user' ? 'user-message' : 'bot-message'}`;
        msgDiv.textContent = text;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Вспомогательная функция для поиска текста в полях станции
    function findInStation(station, keywords) {
        const text = (station.history + ' ' + station.techDesc).toLowerCase();
        for (let kw of keywords) {
            if (text.includes(kw.toLowerCase())) return true;
        }
        return false;
    }

    // Главная логика ответов
    function getAnswer(question, data) {
        const q = question.toLowerCase().trim();
        
        // ---- Общие вопросы (59-74) ----
        if (q.includes('сколько всего гэс') || q === 'сколько всего гэс на карте?' || q === 'сколько всего гэс?') {
            return `На карте ${data.length} гидроэлектростанций.`;
        }
        if ((q.includes('какие гэс заброшены') || q.includes('какие гэс заброшены, а какая отреставрирована')) && !q.includes('отреставрирована')) {
            const abandoned = data.filter(s => s.status === 'заброшена').map(s => s.name);
            const restored = data.filter(s => s.status === 'отреставрирована').map(s => s.name);
            return `🏚️ Заброшены: ${abandoned.join(', ')}. 🏠 Отреставрирована: ${restored.join(', ')}.`;
        }
        if (q.includes('самая старая гэс')) {
            const oldest = data.reduce((a, b) => (a.yearBuilt < b.yearBuilt ? a : b));
            return `Самая старая ГЭС — ${oldest.name}, построена в ${oldest.yearBuilt} году.`;
        }
        if (q.includes('самая новая') || q.includes('самая новая по году постройки')) {
            const newest = data.reduce((a, b) => (a.yearBuilt > b.yearBuilt ? a : b));
            return `Самая новая ГЭС — ${newest.name}, построена в ${newest.yearBuilt} году.`;
        }
        if (q.includes('наибольшую мощность') || q.includes('какая гэс имеет наибольшую мощность')) {
            const maxPower = data.reduce((a, b) => {
                let powA = parseFloat(a.power) || 0;
                let powB = parseFloat(b.power) || 0;
                return powA > powB ? a : b;
            });
            return `Наибольшую мощность имеет ${maxPower.name} — ${maxPower.power}.`;
        }
        if (q.includes('мощность 400 квт')) {
            const station = data.find(s => s.power.includes('400'));
            return station ? `${station.name} имеет мощность 400 кВт.` : 'Нет ГЭС с мощностью 400 кВт.';
        }
        // ГЭС в районах
        if (q.includes('в гатчинском районе')) {
            const list = data.filter(s => s.region.toLowerCase().includes('гатчинский')).map(s => s.name);
            return list.length ? `В Гатчинском районе: ${list.join(', ')}.` : 'Не найдено.';
        }
        if (q.includes('в выборгском районе')) {
            const list = data.filter(s => s.region.toLowerCase().includes('выборгский')).map(s => s.name);
            return list.length ? `В Выборгском районе: ${list.join(', ')}.` : 'Не найдено.';
        }
        if (q.includes('в приозерском районе')) {
            const list = data.filter(s => s.region.toLowerCase().includes('приозерский')).map(s => s.name);
            return list.length ? `В Приозерском районе: ${list.join(', ')}.` : 'Не найдено.';
        }
        if (q.includes('в лужском районе')) {
            const list = data.filter(s => s.region.toLowerCase().includes('лужский')).map(s => s.name);
            return list.length ? `В Лужском районе: ${list.join(', ')}.` : 'Не найдено.';
        }
        // По рекам
        if (q.includes('на реке оредеж') || q.includes('стоит на реке оредеж')) {
            const stations = data.filter(s => findInStation(s, ['оредеж'])).map(s => s.name);
            return stations.length ? `На реке Оредеж стоят: ${stations.join(', ')}.` : 'Не найдено.';
        }
        if (q.includes('на реке волчьей')) {
            const stations = data.filter(s => findInStation(s, ['волчьей', 'волчья'])).map(s => s.name);
            return stations.length ? `На реке Волчьей стоит ${stations.join(', ')}.` : 'Не найдено.';
        }
        if (q.includes('на реке рощинке')) {
            const stations = data.filter(s => findInStation(s, ['рощинка', 'рощинки'])).map(s => s.name);
            return stations.length ? `На реке Рощинке стоит ${stations.join(', ')}.` : 'Не найдено.';
        }
        // Построена на месте старой плотины медного завода
        if (q.includes('медного завода') || q.includes('чикинская построена на месте')) {
            const station = data.find(s => s.name.includes('Чикинская'));
            if (station) return `Чикинская (Даймищенская) ГЭС построена на месте старой плотины медного завода братьев Чикиных (1860-е годы).`;
            return 'Информация уточняется.';
        }
        // Какие ГЭС построены в довоенный период (финские)
        if (q.includes('довоенный период') || q.includes('принадлежала финляндии')) {
            const finnish = data.filter(s => s.yearBuilt < 1940 && (s.name.includes('Сосновская') || s.name.includes('Рощинская')));
            return `В довоенный период, когда территория принадлежала Финляндии, построены: ${finnish.map(s=>s.name).join(', ')}.`;
        }
        // Почему закрылись в 1970-х
        if (q.includes('почему большинство закрылись в 1970-х')) {
            return `Большинство малых ГЭС закрыли в 1970-х годах после ввода мощностей Ленинградской АЭС и развития единой энергосистемы.`;
        }
        
        // ---- Вопросы по конкретным ГЭС ----
        // Определяем, о какой ГЭС спрашивают
        let station = null;
        if (q.includes('сосновская')) station = data.find(s => s.name.includes('Сосновская'));
        else if (q.includes('рощинская')) station = data.find(s => s.name.includes('Рощинская'));
        else if (q.includes('вырицкая')) station = data.find(s => s.name.includes('Вырицкая'));
        else if (q.includes('чикинская') || q.includes('даймищенская')) station = data.find(s => s.name.includes('Чикинская'));
        else if (q.includes('лужская')) station = data.find(s => s.name.includes('Лужская'));
        
        if (station) {
            // ---- Сосновская (вопросы 1-12) ----
            if (station.name === 'Сосновская ГЭС') {
                if (q.includes('где находится')) return `Сосновская ГЭС находится в ${station.region}. Координаты: ${station.lat}, ${station.lon}.`;
                if (q.includes('как раньше называлась')) return `Раньше называлась ${station.oldName}.`;
                if (q.includes('в каком году построили')) return `Построена в ${station.yearBuilt} году.`;
                if (q.includes('в каком году закрылась')) return `Закрылась в ${station.yearClosed} году.`;
                if (q.includes('какая мощность')) return `Мощность ${station.power}.`;
                if (q.includes('на какой реке')) return `Стоит на реке Волчьей.`;
                if (q.includes('крупнейшей частной станцией в довоенной финляндии')) return `Сосновская (Петяярвская) ГЭС считалась крупнейшей частной ГЭС довоенной Финляндии благодаря своей мощности 175 кВт и снабжению нескольких посёлков.`;
                if (q.includes('какие посёлки обеспечивала')) return `Обеспечивала посёлки: Саккола (Громово), Петяярви, Кивиниеми (Лосево), Валкъярви (Мичуринское).`;
                if (q.includes('что сейчас осталось')) return `Сохранились бетонная плотина, руины машинного зала, мост-плотина.`;
                if (q.includes('как добраться')) return station.route;
                if (q.includes('какой статус')) return `Статус: ${station.status === 'заброшена' ? 'заброшена' : 'отреставрирована'}.`;
                if (q.includes('высота подпора воды')) return `Высота подпора воды составляла 6 метров.`;
            }
            // ---- Рощинская (13-24) ----
            else if (station.name === 'Рощинская ГЭС') {
                if (q.includes('где находится')) return `Рощинская ГЭС находится в ${station.region}.`;
                if (q.includes('как раньше называлась')) return `Раньше называлась Райволовская ГЭС.`;
                if (q.includes('в каком году построили')) return `Построена в ${station.yearBuilt} году.`;
                if (q.includes('в каком году закрылась')) return `Закрылась в ${station.yearClosed} году.`;
                if (q.includes('какая мощность')) return `Точных данных о мощности нет, ориентировочно несколько сотен кВт.`;
                if (q.includes('на какой реке')) return `Стоит на реке Рощинке.`;
                if (q.includes('какую функцию сейчас выполняет')) return `Сейчас выполняет функцию плотины, сдерживая уровень воды в Рощинском озере.`;
                if (q.includes('какое техническое сооружение сохранилось')) return `Сохранилась часть механизма затвора на пешеходном мостике, здание машинного зала заброшено.`;
                if (q.includes('высота водосброса')) return `Высота водосброса около 10 метров (трёхступенчатый).`;
                if (q.includes('как добраться')) return station.route;
                if (q.includes('какой статус')) return `Статус: заброшена (не действует).`;
                if (q.includes('кто построил')) return `Построена в 1935 году, когда территория принадлежала Финляндии.`;
            }
            // ---- Вырицкая (25-36) ----
            else if (station.name === 'Вырицкая ГЭС') {
                if (q.includes('где находится')) return `Вырицкая ГЭС находится в ${station.region}.`;
                if (q.includes('как раньше называлась')) return `Раньше называлась Нижне-Вырицкая ГЭС.`;
                if (q.includes('в каком году построили')) return `Построена в ${station.yearBuilt} году.`;
                if (q.includes('закрылась ли или работает')) return `Работала до 1970-х, затем остановлена. В 2010-х годах здание отреставрировано, сейчас частный жилой дом и гостевой комплекс.`;
                if (q.includes('какая мощность')) return `Мощность ${station.power}.`;
                if (q.includes('на какой реке')) return `Стоит на реке Оредеж.`;
                if (q.includes('какой статус')) return `Статус: отреставрирована (но как ГЭС не действует).`;
                if (q.includes('что сейчас находится в здании')) return `В здании находится частный жилой дом и гостевой комплекс.`;
                if (q.includes('годовая выработка')) return `Годовая выработка составляла 2,4 млн кВт·ч.`;
                if (q.includes('напор воды')) return `Напор воды 5,5 метров.`;
                if (q.includes('сколько турбин')) return `Были установлены две горизонтальные турбины.`;
                if (q.includes('как добраться')) return station.route;
            }
            // ---- Чикинская (37-48) ----
            else if (station.name.includes('Чикинская')) {
                if (q.includes('где находится')) return `Чикинская (Даймищенская) ГЭС находится в ${station.region}.`;
                if (q.includes('как ещё называют')) return `Ещё называют Даймищенская ГЭС.`;
                if (q.includes('в каком году построили')) return `Построена в ${station.yearBuilt} году.`;
                if (q.includes('в каком году закрылась')) return `Закрылась в ${station.yearClosed} году.`;
                if (q.includes('какая мощность')) return `Мощность ${station.power}.`;
                if (q.includes('самую большую мощность')) return `Самую большую мощность среди представленных ГЭС имеет Чикинская — 1,5 МВт.`;
                if (q.includes('на каком озере')) return `Образовала запруду, известную как Чикинское озеро.`;
                if (q.includes('первая плотина')) return `Первая плотина сооружена в 1860-х годах братьями Чикиными для медного завода.`;
                if (q.includes('почему закрылась')) return `Закрыта в 1973 году в связи с вводом Ленинградской АЭС.`;
                if (q.includes('какие сооружения входят')) return `Входят: плотина (Чикинское озеро), здание ГЭС, отводящий канал.`;
                if (q.includes('какой статус')) return `Статус: заброшена, но гидроузел используется для регулирования уровня воды.`;
                if (q.includes('как добраться')) return station.route;
            }
            // ---- Лужская (49-58) ----
            else if (station.name.includes('Лужская')) {
                if (q.includes('где находится')) return `Лужская ГЭС-1 находится в ${station.region}.`;
                if (q.includes('в каком году построили')) return `Построена в ${station.yearBuilt} году.`;
                if (q.includes('в каком году закрылась')) return `Закрылась в ${station.yearClosed} году.`;
                if (q.includes('какая мощность')) return `Мощность ${station.power}.`;
                if (q.includes('на какой реке')) return `Стоит на реке Быстрица (исток из озера Врево).`;
                if (q.includes('из какого озера вытекает река')) return `Река Быстрица вытекает из озера Врево.`;
                if (q.includes('в каком состоянии сооружения')) return `Сооружения сохранились в хорошем состоянии, есть машинный зал, плотина с механизмами затворов.`;
                if (q.includes('какой статус')) return `Статус: заброшена, законсервирована, принадлежит АО «Норд Гидро».`;
                if (q.includes('как добраться')) return station.route;
                if (q.includes('высота подпора воды')) return `Высота подпора воды 6,6 метра.`;
            }
            // Если вопрос не распознан, даём общую информацию
            return `Вот что известно о ${station.name}: ${station.history.substring(0, 300)}... Подробнее смотрите на карте.`;
        }
        
        // Если не нашли ни одной станции и не общий вопрос
        return "Не совсем понял. Вы можете спросить: «Где находится Сосновская ГЭС?», «Какая мощность у Вырицкой?», «Сколько всего ГЭС?», «Какие ГЭС заброшены?» или задать вопрос из списка.";
    }

    function processQuery(query, data) {
        const answer = getAnswer(query, data);
        return answer;
    }

    function init() {
        // Кнопка
        const btn = document.createElement('div');
        btn.className = 'chatbot-button';
        btn.innerHTML = '💬';
        document.body.appendChild(btn);

        // Окно
        const win = document.createElement('div');
        win.className = 'chatbot-window closed';
        win.innerHTML = `
            <div class="chatbot-header">
                <span>🤖 Помощник по МГЭС</span>
                <button id="closeChatBtn">✖</button>
            </div>
            <div class="chatbot-messages"></div>
            <div class="quick-buttons">
                <button class="quick-btn" data-question="Сколько всего ГЭС?">📊 Статистика</button>
                <button class="quick-btn" data-question="Какие ГЭС заброшены?">🏚️ Заброшенные</button>
                <button class="quick-btn" data-question="Где находится Вырицкая ГЭС?">📍 Вырицкая</button>
                <button class="quick-btn" data-question="Какая мощность у Чикинской ГЭС?">⚡ Мощность</button>
            </div>
            <div class="chatbot-input">
                <input type="text" id="chatInput" placeholder="Задайте вопрос (например, «На какой реке стоит Сосновская ГЭС?»)">
                <button id="sendChatBtn">→</button>
            </div>
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
            const data = window.mgesData;
            if (!data || !data.length) {
                addMessage('Данные о ГЭС ещё не загружены. Обновите страницу.', 'bot');
                return;
            }
            const answer = processQuery(text, data);
            addMessage(answer, 'bot');
        };
        sendBtn.onclick = send;
        inputField.onkeypress = (e) => { if (e.key === 'Enter') send(); };

        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const question = btn.getAttribute('data-question');
                addMessage(question, 'user');
                const data = window.mgesData;
                if (data && data.length) {
                    addMessage(processQuery(question, data), 'bot');
                } else {
                    addMessage('Данные не загружены', 'bot');
                }
            });
        });

        addMessage('Привет! Я знаю ответы на все вопросы о МГЭС. Спросите: «Где находится Сосновская ГЭС?», «Какая мощность у Вырицкой?», «Почему закрылись ГЭС в 1970-х?» и другие.', 'bot');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();