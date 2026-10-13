# ZombiSurvive

Браузерная 2D-игра о выживании в мире с зомби. Первый каркас: пустая сцена
Phaser и HTTP-сервер с проверкой доступности. Игровые механики ещё не реализованы.

## Основные документы

- [Игровые требования](GAME_DESIGN.md)
- [Техническая архитектура](docs/ARCHITECTURE.md)
- [Контракты движения](docs/MOVEMENT_PROTOCOL.md)
- [Единый кодстайл](docs/CODE_STYLE.md)
- [Правила агентов](AGENTS.md)
- [Очередь задач](docs/BACKLOG.md) и [прогресс](docs/PROGRESS.md)
- [Порядок создания PR и проверки CI](docs/PR_PROCESS.md)

## Установка и запуск

Использовать Node.js из .nvmrc и npm. С nvm:

```sh
nvm install
nvm use
npm ci
npm run dev
```

Клиент: http://127.0.0.1:5173. Проверка сервера: http://127.0.0.1:3001/health.
Оба процесса запускаются вместе и завершаются по Ctrl+C.
Только локальный доступ на 127.0.0.1; публикация в интернете не настроена.

Отдельный запуск: npm run dev --workspace @zombi-survive/client или
npm run dev --workspace @zombi-survive/server. Порт сервера задаётся через PORT.

## Проверки

Установить Chromium для smoke-тестов один раз, затем выполнить общий набор:

```sh
npx playwright install chromium
npm run check
```

Отдельные команды:

```sh
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run architecture:check
npm run build
npm test
```

Smoke-тесты требуют актуальной сборки: npm run build перед npm run test:smoke.
Общий npm run check делает это автоматически. Тесты используют отдельные порты
4173 и 3101, запускают собственные приложения и не переиспользуют чужие процессы.
Если порты заняты, освободить их или согласованно поменять playwright.config.mjs.

GitHub Actions устанавливает зависимости и Chromium и выполняет npm run check:
форматирование, lint, типы, архитектуру, сборки, тесты ограничений, контракты
движения и smoke-тесты. Отдельный запуск контрактных тестов после сборки:
`npm run test:contracts`. Корневые build/lint/typecheck собирают общие пакеты первыми;
перед отдельным typecheck приложения выполнить `npm run build:contracts`.

## Проверка собранных приложений

```sh
npm run build
npm run start --workspace @zombi-survive/server
```

В другом терминале: npm run preview --workspace @zombi-survive/client,
затем открыть http://127.0.0.1:4173. Vite preview предназначен для локальной
проверки сборки; production-хостинг ещё не настроен.

Phaser включён в локальный bundle, сторонние графические ассеты не используются.
Текущий bundle движка около 358 kB gzip; Vite сообщает о chunk больше 500 kB
без сжатия. Оптимизацию загрузки выполняем отдельно после появления игрового контента.
