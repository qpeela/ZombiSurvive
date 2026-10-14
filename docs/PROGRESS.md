# Текущий прогресс

Обновлено: 14 октября 2026 года.

- Режим: ручной, одна небольшая задача одним агентом по команде пользователя.
- Требования: GAME_DESIGN.md; архитектура: ARCHITECTURE.md;
  кодстайл: CODE_STYLE.md; завершение: PR_PROCESS.md.
- S001: DONE, PR #1 слит (81662c2). T001: DONE, PR #2 слит (1e8fa7f).
- T002: DONE, [PR #3](https://github.com/qpeela/ZombiSurvive/pull/3) слит (a3aa25f).
  Общие domain/protocol и runtime-проверка DTO: MOVEMENT_PROTOCOL.md.
- S002: DONE, [PR #4](https://github.com/qpeela/ZombiSurvive/pull/4) слит (c5ccb47).
  Целевая модель — локальный сервер хоста для solo и друзей по LAN/интернету.
- T003: DONE, [PR #5](https://github.com/qpeela/ZombiSurvive/pull/5) слит
  (25283b7), слияние проверено через GitHub API; origin/main обновлён.
  Colyseus создаёт один мир/solo-персонажа на процесс; браузер получает
  стартовый snapshot, reload/retry сохраняют ID. Endpoint от origin страницы,
  Vite proxy, loopback listener и проверки Host/Origin. После рестарта ID меняются.
- Текущая задача: T004 — правила движения; IN_REVIEW.
- [PR #6](https://github.com/qpeela/ZombiSurvive/pull/6) открыт и прикреплён к чату.
  GitHub Actions Quality реализации (472d1e5) прошёл: [run 38522857224](https://github.com/qpeela/ZombiSurvive/actions/runs/38522857224).
  Workflow проверяет каждый последующий коммит PR; актуальный CI сверить перед следующей задачей.
- Ветка: codex/t004-movement-rules от origin/main (25283b7).
- Созданы content и simulation без внешних runtime-зависимостей, DOM и Node types.
  Публичные API используют те же dev/production exports, что domain/protocol.
- movementSettings в content: 20 Гц и 4 м/с, заморожены; это параметры прототипа.
- stepPlayerMovement принимает доменные значения и явный stepSeconds = 0.05,
  отклоняет другую длительность, нормализует направление, сохраняет playerId
  и возвращает новую позицию без мутации входов. По диагонали и оси — 0.2 м за тик.
- Шаг пока не подключён к Room/сцене. Здесь нет серверного таймера, world tick,
  ack, WASD, персонажа, столкновений, спринта, чанков или сохранений.
- Добавлен Vitest 5.0.4 (MIT), совместимый с Node 24.19.0 и Vite 8.3.4.
  Vite закреплён также в корне как peer. Единый lockfile; установка: 0 уязвимостей.
- Unit-тесты входят в общий lint/typecheck. build:core собирает четыре общих
  пакета перед приложениями; build:contracts остаётся для domain/protocol.
- 21 unit-тест прошёл: девять направлений, остановка, диагональная скорость,
  20 шагов за секунду, отрицательные координаты, immutable-входы,
  воспроизводимость и отклонение неверного шага.
- Полный npm run check прошёл: форматирование, lint, typecheck, граф импортов,
  шесть сборок, 21 unit + 17 tooling + 12 контрактных + 11 smoke-тестов
  без skipped (61 тест). Новые Node dev/production exports работают;
  сценарии подключения T003 сохранились. Markdown-ссылки и git diff --check прошли.
- Runtime: Node.js 24.19.0 (.nvmrc), npm. Клиент/сервер не изменялись;
  Phaser/Colyseus bundle около 410 kB gzip, предупреждение Vite сохранено.
- Следующая задача после слияния T004: T005 — WASD и серверное движение.
  Production-раздача клиента — T005A, LAN/интернет — T005B/T005C, сохранения — T013.

Не сливать PR автоматически и не начинать T005 в этом запуске.
