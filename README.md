# ZombiSurvive

Браузерная 2D-игра о выживании в мире с зомби. Пока подготовлены требования,
архитектура и инструменты контроля качества; приложения игры ещё не реализованы.

## Основные документы

- [Игровые требования](GAME_DESIGN.md)
- [Техническая архитектура](docs/ARCHITECTURE.md)
- [Единый кодстайл](docs/CODE_STYLE.md)
- [Правила агентов](AGENTS.md)
- [Очередь задач](docs/BACKLOG.md) и [прогресс](docs/PROGRESS.md)
- [Порядок создания PR и проверки CI](docs/PR_PROCESS.md)

## Проверки

Использовать Node.js из .nvmrc и npm. С nvm:

```sh
nvm install
nvm use
npm ci
npm run check
```

Отдельные команды:

```sh
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run architecture:check
npm test
```

Сейчас typecheck проверяет TypeScript-инструменты, тесты — архитектурные ограничения
и правила линтера. Сборку приложений, игровые тесты и команды
запуска добавляет T001. GitHub Actions выполняет npm ci и npm run check для PR.
