// логика на этапе 2 — уже здесь

/* ==========================================================
   ALEX FIT — вся логика приложения
   - Калькулятор BMR / TDEE / целевых ккал / БЖУ + круговая диаграмма
   - Тренировки: добавление упражнений и итоговый тоннаж
   - Сон: длительность по времени засыпания и пробуждения
   - Питание: итоги за день — ручной ввод БЖУ, скриншот из FatSecret,
     разбор CSV-выгрузки («съел / цель / разница»), FatSecret API (поиск продуктов)
   - Все данные сохраняются в localStorage
   ========================================================== */

(function () {
  'use strict';

  /* ================= Утилиты ================= */

  const $ = (id) => document.getElementById(id);

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

  // Число: CEления «60» → «60», «1 234,5» → «1234,5»→1234.5
  const num = (v) => {
    const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  let fmt = (n) => {
    n = Math.round(n * 100) / 100;
    return Number.isInteger(n) ? String(n) : String(n);
  };

  const KEYS = { profile: 'fit_profile', workout: 'fit_workout', sleep: 'fit_sleep', nutrition: 'fit_nutrition', history: 'fit_history' };

  const load = (key, dflt) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : dflt;
    } catch { return dflt; }
  };
  const store = (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* приватный режим и т.п. */ }
  };

  /* ================= 1. Калькулятор калорий и БЖУ ================= */

  const profileForm = $('profile-form');
  const resultsCard = $('results-card');
  const carbWarning = $('carb-warning');

  // Цели: множитель калорий и нормы граммов на кг веса
  const GOALS = {
    gain:     { kcalFactor: 1.15, proteinPerKg: 2.0, fatPerKg: 1.0 }, // набор массы
    cut:      { kcalFactor: 0.80, proteinPerKg: 2.4, fatPerKg: 0.9 }, // сушка
    maintain: { kcalFactor: 1.00, proteinPerKg: 1.8, fatPerKg: 1.0 }, // поддержание
  };

  let macroChart = null;
  let lastResult = (load(KEYS.profile, {}) || {}).result || null;

  function readProfile() {
    const age = num($('age').value);
    const weight = num($('weight').value);
    const height = num($('height').value);
    const gender = profileForm.elements.gender.value;
    const activity = parseFloat($('activity').value) || 1.2;
    const goal = $('goal').value;
    if (!(age >= 14 && age <= 90) || !(weight >= 30 && weight <= 300) || !(height >= 120 && height <= 250)) return null;
    return { gender, age, weight, height, activity, goal };
  }

  function calculate(scroll = true) {
    // см. комментарий в add-exercise: readonly-поля не валидируются формой
    const emptyNum = ['age', 'weight', 'height'].map((id) => $(id)).find((el) => !el.value);
    if (emptyNum) { openWheel(emptyNum); return; }
    if (!profileForm.reportValidity()) return;
    const p = readProfile();
    if (!p) return;

    // Формула Миффлина — Сан Жеора
    const genderOffset = p.gender === 'male' ? 5 : -161;
    const bmr = Math.round(10 * p.weight + 6.25 * p.height - 5 * p.age + genderOffset);
    const tdee = Math.round(bmr * p.activity);

    const g = GOALS[p.goal] || GOALS.maintain;
    const target = Math.round(tdee * g.kcalFactor);

    // БЖУ: белки и жиры фиксированы нормой, углеводы — остаток калорий
    const protein = Math.round(g.proteinPerKg * p.weight);
    const fat = Math.round(g.fatPerKg * p.weight);
    let carbs = Math.round((target - protein * 4 - fat * 9) / 4);
    if (carbs < 0) carbs = 0;

    $('bmr').textContent = bmr;
    $('tdee').textContent = tdee;
    $('target-kcal').textContent = target;
    $('protein').textContent = protein;
    $('fat').textContent = fat;
    $('carb').textContent = carbs;

    resultsCard.classList.remove('hidden');
    carbWarning.classList.toggle('hidden', carbs >= 100);

    renderChart(protein, fat, carbs);
    lastResult = { target, protein, fat, carbs };
    store(KEYS.profile, { ...p, result: lastResult });
    renderProfileSaved(p);

    if (scroll) resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Память пользователя: сводка профиля ---------- */

  const profileFormWrap = $('profile-form-wrap');
  const profileSavedPanel = $('profile-saved');
  const profileChips = $('profile-chips');

  const ACTIVITY_LABELS = { 1.2: 'Минимум', 1.375: 'Лёгкая', 1.55: 'Средняя', 1.725: 'Высокая' };
  const GOAL_LABELS = { gain: 'Набор массы', cut: 'Сушка', maintain: 'Поддержание' };

  // Есть сохранённый профиль → показываем сводку, форма скрыта.
  // Нет профиля → показываем обычную форму.
  function renderProfileSaved(p) {
    if (!p) {
      profileSavedPanel.classList.add('hidden');
      profileFormWrap.classList.remove('hidden');
      return;
    }
    const gender = p.gender === 'male' ? '♂ Мужской' : '♀ Женский';
    const act = ACTIVITY_LABELS[p.activity] || ('× ' + p.activity);
    profileChips.innerHTML =
      '<span class="chip">' + gender + '</span>' +
      '<span class="chip">' + p.age + ' ' + plural(p.age, 'год', 'года', 'лет') + '</span>' +
      '<span class="chip">' + fmt(p.height) + ' см</span>' +
      '<span class="chip">' + fmt(p.weight) + ' кг</span>' +
      '<span class="chip">Активность: ' + act + '</span>' +
      '<span class="chip chip-accent">' + (GOAL_LABELS[p.goal] || p.goal) + '</span>';
    profileSavedPanel.classList.remove('hidden');
    profileFormWrap.classList.add('hidden');
  }

  $('edit-profile').addEventListener('click', () => {
    renderProfileSaved(null); // показать поля (они уже заполнены сохранёнными значениями)
    profileFormWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('reset-profile').addEventListener('click', () => {
    if (!confirm('Сбросить сохранённый профиль? Форма очистится до значений по умолчанию.')) return;
    localStorage.removeItem(KEYS.profile);
    lastResult = null;
    resultsCard.classList.add('hidden');
    profileForm.reset();
    renderProfileSaved(null);
  });

  /* ---------- Круговая диаграмма БЖУ ---------- */

  function renderChart(protein, fat, carbs) {
    const labels = ['Белки', 'Углеводы', 'Жиры'];
    const colors = ['#ff6b00', '#a3e635', '#ffd43b'];
    const data = [protein, carbs, fat];

    // Chart.js, если загрузился с CDN
    if (typeof window.Chart === 'function') {
      if (!$('macroChart')) {
        document.querySelector('.chart-box').innerHTML =
          '<div class="chart-stage"><canvas id="macroChart"></canvas></div>';
      }
      if (macroChart) { macroChart.destroy(); macroChart = null; }
      macroChart = new window.Chart($('macroChart'), {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: colors,
            borderColor: '#1e1e1e',
            borderWidth: 3,
            hoverOffset: 4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#d9d9d9', boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 11 } },
            },
          },
        },
      });
      return;
    }

    // Оффлайн-фолибэк: диаграмма на CSS (conic-gradient), без библиотек
    const shares = [protein * 4, carbs * 4, fat * 9]; // доли считаем по калориям
    const total = shares.reduce((s, v) => s + v, 0);
    if (total <= 0) return;

    if (macroChart) { try { macroChart.destroy(); } catch { /* браузер сам убил канвас */ } macroChart = null; }

    let acc = 0;
    const stops = shares.map((v, i) => {
      const from = (acc / total) * 100;
      acc += v;
      const to = (acc / total) * 100;
      return `${colors[i]} ${from}% ${to}%`;
    }).join(', ');

    const legend = labels
      .map((l, i) => `<span class="legend-item"><i class="dot" style="background:${colors[i]}"></i>${l}</span>`)
      .join('');

    const box = document.querySelector('.chart-box');
    box.innerHTML =
      `<div class="donut-stack">
        <div class="donut-css" style="background: conic-gradient(${stops})"><div class="donut-hole"></div></div>
        <div class="legend-row">${legend}</div>
      </div>`;
  }

  /* ================= 2. Тренировка, тоннаж и история ================= */

  const workoutForm = $('workout-form');
  const workoutBody = $('workout-body');
  const totalCell = $('total-tonnage');
  const workoutStatus = $('workout-status');
  const shareBtn = $('share-workout');
  const finishBtn = $('finish-workout');
  const weekStrip = $('week-strip');
  const weekSummary = $('week-summary');
  const weekChips = $('week-chips');
  const historyCard = $('history-card');
  const historyList = $('history-list');
  const historyClearBtn = $('history-clear');

  let workoutRows = load(KEYS.workout, []);
  if (!Array.isArray(workoutRows)) workoutRows = [];

  // История завершённых тренировок (новые сверху)
  let history = load(KEYS.history, []);
  if (!Array.isArray(history)) history = [];

  // Метаданные текущей тренировки (время старта)
  const META_KEY = 'fit_workout_meta';
  let workoutMeta = load(META_KEY, {}) || {};
  if (typeof workoutMeta.startedAt !== 'number') workoutMeta.startedAt = null;

  const tonnageOf = (r) => r.sets * r.reps * r.weight;

  /* ---------- Группы мышц ---------- */

  // Цвета групп (шестизначный hex — для чипов и сводки недели).
  // Ключи должны совпадать с <optgroup label="..."> в index.html
  const GROUP_COLORS = {
    'Грудь': '#ff6b00',
    'Спина': '#4dabf7',
    'Ноги': '#a3e635',
    'Плечи': '#ffd43b',
    'Руки — бицепс': '#e599f7',
    'Руки — трицепс': '#f783ac',
    'Кор (пресс)': '#66d9e8',
  };

  // имя упражнения → группа (строим из optgroup-разделов списка упражнений)
  const EXERCISE_GROUPS = (() => {
    const map = {};
    const sel = $('exercise');
    if (sel) {
      Array.from(sel.options).forEach((o) => {
        const og = o.closest('optgroup');
        map[o.value] = og ? og.label : 'Другое';
      });
    }
    return map;
  })();

  // группа строки: из данных либо из справочника (для старых записей)
  const groupOfRow = (r) => r.group || EXERCISE_GROUPS[r.exercise] || 'Другое';

  // #ff6b00 → rgba(255, 107, 0, a)
  const hexRgba = (hex, a) => {
    const n = hex.replace('#', '');
    return 'rgba(' + parseInt(n.slice(0, 2), 16) + ', ' + parseInt(n.slice(2, 4), 16) + ', ' + parseInt(n.slice(4, 6), 16) + ', ' + a + ')';
  };

  // цветной чип группы мышц
  const mgChip = (group) => {
    const c = GROUP_COLORS[group] || '#9b9b9b';
    return `<span class="mg" style="color:${c};background:${hexRgba(c, .13)};border-color:${hexRgba(c, .38)}">${esc(group)}</span>`;
  };

  // Русские склонения: plural(5, 'упражнение', 'упражнения', 'упражнений')
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };

  const durText = (min) =>
    min < 60 ? min + ' мин' : Math.floor(min / 60) + ' ч ' + (min % 60) + ' мин';

  // Длительность текущей тренировки (мин) или null, если старт не зафиксирован
  function workoutDurationMin() {
    if (!workoutMeta.startedAt) return null;
    // ограничение 12 ч — защита от «забытой» тренировки
    return Math.min(12 * 60, Math.max(0, Math.round((Date.now() - workoutMeta.startedAt) / 60000)));
  }

  function renderWorkout() {
    store(KEYS.workout, workoutRows);

    const active = workoutRows.length > 0;

    // авто-старт: время начала фиксируем при первом упражнении
    if (active && !workoutMeta.startedAt) {
      workoutMeta.startedAt = Date.now();
      store(META_KEY, workoutMeta);
    }
    if (!active && workoutMeta.startedAt) {
      workoutMeta.startedAt = null;
      store(META_KEY, workoutMeta);
    }

    finishBtn.classList.toggle('hidden', !active);
    shareBtn.classList.toggle('hidden', !active);

    // живой статус тренировки
    if (active) {
      const total = workoutRows.reduce((s, r) => s + tonnageOf(r), 0);
      const d = workoutDurationMin();
      workoutStatus.innerHTML =
        '<span class="chip">⏱ ' + (d == null ? '—' : durText(d)) + '</span>' +
        '<span class="chip">' + workoutRows.length + ' ' +
        plural(workoutRows.length, 'упражнение', 'упражнения', 'упражнений') + '</span>' +
        '<span class="chip chip-accent">Тоннаж: ' + fmt(total) + ' кг</span>';
      workoutStatus.classList.remove('hidden');
    } else {
      workoutStatus.classList.add('hidden');
    }

    if (!workoutRows.length) {
      workoutBody.innerHTML = '<tr class="empty"><td colspan="6">Пока пусто — добавьте первое упражнение</td></tr>';
      totalCell.textContent = '0';
      return;
    }

    workoutBody.innerHTML = workoutRows.map((r, i) => `
      <tr>
        <td>${esc(r.exercise)}${mgChip(groupOfRow(r))}</td>
        <td class="num">${r.sets}</td>
        <td class="num">${r.reps}</td>
        <td class="num">${fmt(r.weight)}</td>
        <td class="num">${fmt(tonnageOf(r))}</td>
        <td class="num">
          <button type="button" class="del-btn" data-i="${i}" title="Убрать упражнение" aria-label="Убрать упражнение">×</button>
        </td>
      </tr>
    `).join('');

    const total = workoutRows.reduce((s, r) => s + tonnageOf(r), 0);
    totalCell.textContent = fmt(total);
  }

  // Завершение тренировки: сохранить в историю и начать новую
  finishBtn.addEventListener('click', () => {
    if (!workoutRows.length) return;
    const total = workoutRows.reduce((s, r) => s + tonnageOf(r), 0);
    const now = new Date();
    history.unshift({
      id: Date.now(),
      date: now.toISOString(),
      durationMin: workoutDurationMin(),
      tonnage: total,
      exercises: workoutRows,
    });
    store(KEYS.history, history);

    workoutRows = [];
    workoutMeta.startedAt = null;
    store(META_KEY, workoutMeta);

    renderWorkout();
    renderHistory();

    historyCard.classList.remove('hidden');
    historyCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function renderHistory() {
    historyClearBtn.classList.toggle('hidden', !history.length);
    renderWeekStrip();

    if (!history.length) {
      historyList.innerHTML = '';
      historyCard.classList.add('hidden');
      weekSummary.classList.add('hidden');
      hideProgressChart();
      return;
    }

    historyList.innerHTML = history.map((w) => {
      const d = new Date(w.date);
      const exs = Array.isArray(w.exercises) ? w.exercises : [];
      const year = d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '';
      const day = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + year;
      const wd = d.toLocaleDateString('ru-RU', { weekday: 'long' });
      const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const dur = w.durationMin != null ? ' • ⏱ ' + durText(w.durationMin) : '';
      const rows = exs.map((r) => `
            <tr>
              <td>${esc(r.exercise)}${mgChip(groupOfRow(r))}</td>
              <td class="num">${r.sets}</td>
              <td class="num">${r.reps}</td>
              <td class="num">${fmt(r.weight)}</td>
              <td class="num">${fmt(tonnageOf(r))}</td>
            </tr>`).join('');
      return `
        <div class="hist-item" data-id="${w.id}">
          <button type="button" class="hist-head" aria-expanded="false">
            <span class="hist-date"><b>${day}</b><small>${wd}, ${time}${dur}</small></span>
            <span class="hist-meta">${exs.length} ${plural(exs.length, 'упражнение', 'упражнения', 'упражнений')} • <b>${fmt(w.tonnage)} кг</b></span>
            <span class="hist-chevron" aria-hidden="true">▾</span>
          </button>
          <div class="hist-body hidden">
            <div class="table-wrap hist-table">
              <table>
                <thead><tr><th>Упражнение</th><th class="num">Подходы</th><th class="num">Повторы</th><th class="num">Вес, кг</th><th class="num">Тоннаж</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            <button type="button" class="btn-mini hist-del" data-id="${w.id}">Удалить запись</button>
          </div>
        </div>`;
    }).join('');

    historyCard.classList.remove('hidden');
    renderProgressChart();
    renderWeekSummary();
  }

  // делегирование: раскрытие записи / удаление одной записи
  historyList.addEventListener('click', (e) => {
    const del = e.target.closest('.hist-del');
    if (del) {
      if (!confirm('Удалить эту тренировку из истории?')) return;
      history = history.filter((w) => String(w.id) !== del.dataset.id);
      store(KEYS.history, history);
      renderHistory();
      return;
    }
    const head = e.target.closest('.hist-head');
    if (!head) return;
    const item = head.closest('.hist-item');
    const body = item.querySelector('.hist-body');
    const nowHidden = body.classList.toggle('hidden');
    head.setAttribute('aria-expanded', nowHidden ? 'false' : 'true');
    item.classList.toggle('open', !nowHidden);
  });

  historyClearBtn.addEventListener('click', () => {
    if (!history.length) return;
    if (!confirm('Удалить всю историю тренировок?')) return;
    history = [];
    store(KEYS.history, history);
    renderHistory();
  });

  /* ---------- Календарь недели (пн–вс) ---------- */

  // Проставляем ✅ тем дням текущей недели, когда тренировка была завершена
  function renderWeekStrip() {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (now.getDay() + 6) % 7); // начало недели — понедельник
    monday.setHours(0, 0, 0, 0);

    const doneDays = new Set(history.map((w) => new Date(w.date).toDateString()));
    const today = now.toDateString();

    weekStrip.innerHTML = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const isDone = doneDays.has(day.toDateString());
      const isToday = day.toDateString() === today;
      return '<div class="wd' + (isDone ? ' done' : '') + (isToday ? ' today' : '') + '" title="' +
        day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + '">' +
        '<small>' + day.toLocaleDateString('ru-RU', { weekday: 'short' }) + '</small>' +
        '<b>' + (isDone ? '✅' : '—') + '</b></div>';
    }).join('');
  }

  /* ---------- Итоги недели: что прокачал, а что забросил ---------- */

  function renderWeekSummary() {
    const since = Date.now() - 7 * 86400000;
    const perGroup = {};
    history.forEach((w) => {
      if (new Date(w.date).getTime() < since) return;
      (Array.isArray(w.exercises) ? w.exercises : []).forEach((r) => {
        const g = groupOfRow(r);
        perGroup[g] = (perGroup[g] || 0) + tonnageOf(r);
      });
    });

    // базовые группы всегда видны (чтобы было видно, кого «забросил»), прочие — при наличии
    const groups = ['Грудь', 'Спина', 'Ноги', 'Плечи', 'Руки — бицепс', 'Руки — трицепс', 'Кор (пресс)']
      .concat(Object.keys(perGroup).filter((g) => !(g in GROUP_COLORS)));

    weekChips.innerHTML = groups.map((g) => {
      const c = GROUP_COLORS[g] || '#9b9b9b';
      const t = perGroup[g] || 0;
      return `<span class="week-chip" style="color:${c};background:${hexRgba(c, t ? .13 : .05)};border-color:${hexRgba(c, t ? .38 : .2)}">` +
        esc(g) + ' · ' + (t ? fmt(t) + ' кг' : 'отдых') + '</span>';
    }).join('');

    weekSummary.classList.remove('hidden');
  }

  /* ---------- Кнопка «Поделиться результатом» ---------- */

  function buildShareText() {
    const d = workoutDurationMin();
    const total = workoutRows.reduce((s, r) => s + tonnageOf(r), 0);
    const when = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const lines = [
      '🏋️ ALEX FIT — тренировка ' + when,
      '⏱ ' + (d == null ? '—' : durText(d)) +
      ' • ' + workoutRows.length + ' ' + plural(workoutRows.length, 'упражнение', 'упражнения', 'упражнений') +
      ' • 💪 Тоннаж: ' + fmt(total) + ' кг',
      '',
    ];
    workoutRows.forEach((r) => {
      lines.push('• ' + r.exercise + ' — ' + r.sets + '×' + r.reps + '×' + fmt(r.weight) + ' кг');
    });
    return lines.join('\n');
  }

  shareBtn.addEventListener('click', async () => {
    const text = buildShareText();
    // на телефоне — системное меню («поделиться» в WhatsApp/Telegram/Notes)
    if (navigator.share) {
      try { await navigator.share({ title: 'ALEX FIT', text: text }); } catch (e) { /* отменили шаринг */ }
      return;
    }
    // запасной вариант: в буфер обмена
    try {
      await navigator.clipboard.writeText(text);
      alert('Текст тренировки скопирован в буфер:\n\n' + text);
    } catch (e) {
      prompt('Скопируйте текст тренировки:', text);
    }
  });

  /* ---------- График прогресса (Chart.js, последние 12 тренировок) ---------- */

  let progressChart = null;

  function hideProgressChart() {
    $('chart-wrap').classList.add('hidden');
    if (progressChart) {
      progressChart.destroy();
      progressChart = null;
    }
  }

  function renderProgressChart() {
    const wrap = $('chart-wrap');
    // CDN недоступен (офлайн) — просто прячем график, приложение работает дальше
    if (typeof Chart === 'undefined') {
      wrap.classList.add('hidden');
      return;
    }
    if (history.length < 2) {
      wrap.classList.add('hidden');
      return; // для графика нужно минимум 2 точки
    }

    // последние 12 тренировок в хронологическом порядке (старые слева)
    const items = history.slice(0, 12).reverse();
    const labels = items.map((w) =>
      new Date(w.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
    const values = items.map((w) => w.tonnage);

    if (progressChart) {
      progressChart.destroy();
      progressChart = null;
    }

    progressChart = new Chart($('progress-chart'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Тоннаж, кг',
          data: values,
          borderColor: '#ff6b00',
          backgroundColor: 'rgba(255, 107, 0, .12)',
          fill: true,
          tension: .35,
          borderWidth: 2.5,
          pointRadius: 3.5,
          pointBackgroundColor: '#ff6b00',
          pointBorderColor: '#0d0d0d',
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e1e1e',
            borderColor: '#3d3d3d',
            borderWidth: 1,
            titleColor: '#f2f2f2',
            bodyColor: '#f2f2f2',
            padding: 10,
            callbacks: {
              label: (ctx) => ' ' + fmt(ctx.parsed.y) + ' кг',
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, .05)' },
            ticks: { color: '#9b9b9b', maxRotation: 0, autoSkipPadding: 12 },
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, .05)' },
            ticks: { color: '#9b9b9b', callback: (v) => (v >= 1000 ? (v / 1000) + ' т' : v + ' кг') },
          },
        },
      },
    });

    wrap.classList.remove('hidden');
  }

  // живой таймер: обновляем статус текущей тренировки раз в 30 секунд
  setInterval(() => {
    if (workoutRows.length && workoutMeta.startedAt) renderWorkout();
  }, 30000);

  $('add-exercise').addEventListener('click', () => {
    // readonly-поля не проверяются формой → пустые числа ловим сами и открываем шторку
    const emptyNum = ['sets', 'reps', 'bar-weight'].map((id) => $(id)).find((el) => !el.value);
    if (emptyNum) { openWheel(emptyNum); return; }
    if (!workoutForm.reportValidity()) return;
    const exerciseSelect = $('exercise');
    const sel = exerciseSelect.selectedOptions[0];
    const og = sel ? sel.closest('optgroup') : null;
    const row = {
      exercise: exerciseSelect.value,
      group: og ? og.label : 'Другое',
      sets: parseInt($('sets').value, 10) || 0,
      reps: parseInt($('reps').value, 10) || 0,
      weight: num($('bar-weight').value),
    };
    if (!row.exercise || row.sets < 1 || row.reps < 1 || row.weight < 0) return;

    workoutRows.push(row);
    $('sets').value = '';
    $('reps').value = '';
    $('bar-weight').value = '';
    renderWorkout();
  });

  workoutBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.del-btn');
    if (!btn) return;
    workoutRows.splice(parseInt(btn.dataset.i, 10), 1);
    renderWorkout();
  });

  /* ================= 3. Сон ================= */

  const sleepStart = $('sleep-start');
  const sleepEnd = $('sleep-end');
  const sleepDuration = $('sleep-duration');

  function updateSleep() {
    store(KEYS.sleep, { start: sleepStart.value, end: sleepEnd.value });

    if (!sleepStart.value || !sleepEnd.value) {
      sleepDuration.value = '';
      return;
    }

    const [h1, m1] = sleepStart.value.split(':').map(Number);
    const [h2, m2] = sleepEnd.value.split(':').map(Number);

    // Пробуждение позже полуночи → добавляем сутки
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff <= 0) diff += 24 * 60;

    sleepDuration.value = `${Math.floor(diff / 60)} ч ${diff % 60} мин`;
  }

  sleepStart.addEventListener('change', updateSleep);
  sleepEnd.addEventListener('change', updateSleep);

  /* ================= 4. Питание: CSV из FatSecret ================= */

  const csvInput = $('csv-file');
  const nutritionBox = $('nutrition-table');

  // Разбор одной строки CSV с учётом кавычек
  function splitCsv(line, delim) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function parseFatSecret(text) {
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) return null;

    // Разделитель: обычно «,», русские выгрузки из Excel — «;»
    const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const header = splitCsv(lines[0], delim).map((h) => h.trim().toLowerCase());
    if (!header.length) return null;

    // Поиск нужных колонок по ключевым словам (русская и английская выгрузки)
    const findCol = (preds) => {
      for (const pred of preds) {
        const i = header.findIndex(pred);
        if (i !== -1) return i;
      }
      return -1;
    };

    const kcalI = findCol([h => /калор|ккал|энерг|calor|energy/.test(h)]);
    const proteinI = findCol([h => /белк|protein/.test(h)]);
    const carbsI = findCol([h => /углев|carb/.test(h)]);
    const fatI = findCol([
      h => /жир/.test(h) && !/насыщ|полиненасыщ|моно/.test(h),
      h => /\bfat\b/.test(h) && !/saturat|poly|mono|trans/.test(h),
      h => /жир|fat/.test(h),
    ]);
    const dateI = findCol([h => /^дата|^date/.test(h), h => /start day/.test(h), h => /\bday\b|\bдень\b/.test(h)]);

    if (kcalI === -1 && proteinI === -1 && carbsI === -1 && fatI === -1) return null;

    const sums = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    const days = new Set();
    let records = 0;

    for (let li = 1; li < lines.length; li++) {
      const cells = splitCsv(lines[li], delim);
      if (!cells.length) continue;
      records++;

      if (dateI !== -1 && cells[dateI]) days.add(cells[dateI].trim());

      if (kcalI !== -1) sums.kcal += num(cells[kcalI]);
      if (proteinI !== -1) sums.protein += num(cells[proteinI]);
      if (carbsI !== -1) sums.carbs += num(cells[carbsI]);
      if (fatI !== -1) sums.fat += num(cells[fatI]);
    }

    return {
      kcal: sums.kcal,
      protein: sums.protein,
      carbs: sums.carbs,
      fat: sums.fat,
      records,
      days: days.size,
      hasDate: dateI !== -1 && days.size > 0,
    };
  }

  function renderNutrition(r, filename) {
    // Если в файле есть даты — показываем среднее значение за день
    const divisor = r.hasDate && r.days > 0 ? r.days : 1;

    const rows = [
      { label: 'Калории, ккал', ate: r.kcal / divisor, goal: lastResult ? lastResult.target : null },
      { label: 'Белки, г', ate: r.protein / divisor, goal: lastResult ? lastResult.protein : null },
      { label: 'Жиры, г', ate: r.fat / divisor, goal: lastResult ? lastResult.fat : null },
      { label: 'Углеводы, г', ate: r.carbs / divisor, goal: lastResult ? lastResult.carbs : null },
    ];

    const head = '<tr><th>Показатель</th><th class="num">Съел</th><th class="num">Цель</th><th class="num">Разница</th></tr>';

    const body = rows
      .map((row) => {
        const diff = row.goal == null ? null : row.ate - row.goal;
        const cls = diff == null ? '' : diff > 0.5 ? 'diff-over' : diff < -0.5 ? 'diff-under' : '';
        const diffText = diff == null ? '—' : (diff > 0 ? '+' : diff < 0 ? '−' : '') + fmt(Math.abs(Math.round(diff * 10) / 10));
        return `<tr>
          <td>${row.label}</td>
          <td class="num">${fmt(Math.round(row.ate * 10) / 10)}</td>
          <td class="num">${row.goal == null ? '—' : fmt(row.goal)}</td>
          <td class="num ${cls}">${diffText}</td>
        </tr>`;
      })
      .join('');

    const note = `Файл: ${esc(filename)} • записей: ${r.records}` +
      (r.hasDate && r.days > 0 ? ` • дней: ${r.days} (показано среднее за день)` : '');

    nutritionBox.className = '';
    nutritionBox.innerHTML =
      `<div class="table-wrap nutrition"><table>${head}${body}</table></div><p class="hint">${note}</p>`;
  }

  function renderNutritionError(filename) {
    nutritionBox.className = 'table-placeholder';
    nutritionBox.textContent =
      `Не удалось разобрать «${filename}». Нужны стандартные колонки экспорта FatSecret (калории, белки, жиры, углеводы).`;
  }

  csvInput.addEventListener('change', () => {
    const file = csvInput.files && csvInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseFatSecret(reader.result);
      if (!parsed) renderNutritionError(file.name);
      else renderNutrition(parsed, file.name);
    };
    reader.onerror = () => renderNutritionError(file.name);
    reader.readAsText(file, 'utf-8');
  });

  /* ================= 5. Питание: итоги за день (ввод, скриншот, API) ================= */

  const NUTRI = (() => {
    const s = load(KEYS.nutrition, {}) || {};
    return {
      source: s.source || '',
      manual: s.manual || null,
      shot: s.shot || null,
      api: Object.assign({ clientId: '', clientSecret: '', proxy: '', token: null, log: [] }, s.api || {}),
    };
  })();

  const saveNutrition = () => store(KEYS.nutrition, NUTRI);

  /* ---------- Вкладки внутри карточки «Питание» ---------- */

  const segButtons = document.querySelectorAll('#food-card .seg-btn');

  function showPanel(name) {
    segButtons.forEach((b) => {
      const on = b.dataset.panel === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ['manual', 'shot', 'api', 'csv'].forEach((p) => {
      const el = $('panel-' + p);
      if (el) el.classList.toggle('hidden', p !== name);
    });
  }

  segButtons.forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.panel)));

  /* ---------- Сводная таблица «съел / цель / разница» ---------- */

  function resetSummary() {
    nutritionBox.className = 'table-placeholder';
    nutritionBox.textContent =
      'Сводка «съел / цель / разница» за день появится после ввода итогов, поиска по API или загрузки CSV';
  }

  function renderSummary(t, sourceLabel) {
    const rows = [
      { label: 'Калории, ккал', ate: t.kcal, goal: lastResult ? lastResult.target : null },
      { label: 'Белки, г', ate: t.protein, goal: lastResult ? lastResult.protein : null },
      { label: 'Жиры, г', ate: t.fat, goal: lastResult ? lastResult.fat : null },
      { label: 'Углеводы, г', ate: t.carbs, goal: lastResult ? lastResult.carbs : null },
    ];

    const head = '<tr><th>Показатель</th><th class="num">Съел</th><th class="num">Цель</th><th class="num">Разница</th></tr>';

    const body = rows
      .map((row) => {
        const diff = row.goal == null ? null : row.ate - row.goal;
        const cls = diff == null ? '' : diff > 0.5 ? 'diff-over' : diff < -0.5 ? 'diff-under' : '';
        const diffText = diff == null ? '—' : (diff > 0 ? '+' : diff < 0 ? '−' : '') + fmt(Math.abs(Math.round(diff * 10) / 10));
        return `<tr>
          <td>${row.label}</td>
          <td class="num">${fmt(Math.round(row.ate * 10) / 10)}</td>
          <td class="num">${row.goal == null ? '—' : fmt(row.goal)}</td>
          <td class="num ${cls}">${diffText}</td>
        </tr>`;
      })
      .join('');

    nutritionBox.className = '';
    nutritionBox.innerHTML =
      `<div class="table-wrap nutrition"><table>${head}${body}</table></div>` +
      `<p class="hint">Источник: ${esc(sourceLabel)} • цель — из карточки «Результаты»</p>`;
  }

  /* ---------- A. Ручной ввод итогов за день ---------- */

  const fsManualMsg = $('fs-manual-msg');

  function setManualMsg(text, err) {
    fsManualMsg.textContent = text;
    fsManualMsg.classList.toggle('err', !!err);
    fsManualMsg.classList.toggle('ok', !!text && !err);
  }

  $('fs-manual-show').addEventListener('click', () => {
    const t = {
      kcal: num($('fs-kcal').value),
      protein: num($('fs-protein').value),
      fat: num($('fs-fat').value),
      carbs: num($('fs-carb').value),
    };
    if (!t.kcal && !t.protein && !t.fat && !t.carbs) {
      setManualMsg('Введи хотя бы одну цифру', true);
      return;
    }
    NUTRI.manual = t;
    NUTRI.source = 'manual';
    saveNutrition();
    setManualMsg('Сохранено — сводка обновлена');
    renderSummary(t, 'ручной ввод');
  });

  /* ---------- B. Скриншот из FatSecret ---------- */

  const shotInput = $('fs-shot');
  const shotPreview = $('shot-preview');
  const shotImg = $('shot-img');
  const fsShotMsg = $('fs-shot-msg');

  function setShotMsg(text, err) {
    fsShotMsg.textContent = text;
    fsShotMsg.classList.toggle('err', !!err);
    fsShotMsg.classList.toggle('ok', !!text && !err);
  }

  // Скриншот сжимается: максимум ~1000px по стороне, JPEG 0.72 — так строка
  // занимает 50–150 КБ и спокойно влезает в localStorage (лимит ~5 МБ)
  function shrinkShot(img, maxSide, q) {
    const sc = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * sc));
    c.height = Math.max(1, Math.round(img.naturalHeight * sc));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }

  function showShot() {
    if (NUTRI.shot && NUTRI.shot.data) {
      shotImg.src = NUTRI.shot.data;
      shotPreview.classList.remove('hidden');
    } else {
      shotImg.removeAttribute('src');
      shotPreview.classList.add('hidden');
    }
  }

  shotInput.addEventListener('change', () => {
    const file = shotInput.files && shotInput.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      setShotMsg('Это не фото. Нужен скриншот в PNG или JPG', true);
      return;
    }
    setShotMsg('Обрабатываю фото…');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let max = 1000;
        let data = shrinkShot(img, max, 0.72);
        while (data.length > 1500000 && max > 500) {
          max = Math.round(max * 0.7);
          data = shrinkShot(img, max, 0.6);
        }
        if (data.length > 2500000) throw new Error('фото слишком большое');
        NUTRI.shot = { data, date: new Date().toLocaleDateString('ru-RU') };
        saveNutrition();
        showShot();
        setShotMsg('Сохранено на этом устройстве' + (NUTRI.shot.date ? ' • ' + NUTRI.shot.date : ''));
      } catch {
        setShotMsg('Фото не обработалось — попробуй скриншот меньшего размера', true);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setShotMsg('Не удалось открыть фото', true);
    };
    img.src = url;
  });

  $('shot-del').addEventListener('click', () => {
    NUTRI.shot = null;
    saveNutrition();
    shotInput.value = '';
    showShot();
    setShotMsg('Скриншот удалён');
  });

  /* ---------- C. FatSecret API ---------- */

  const FS_TOKEN = 'https://oauth.fatsecret.com/connect/token';
  const FS_SERVER = 'https://platform.fatsecret.com/rest/server.api';
  const fsStatus = $('fs-status');

  function apiStatus(text, err) {
    fsStatus.textContent = text;
    fsStatus.classList.toggle('err', !!err);
    fsStatus.classList.toggle('ok', !!text && !err);
  }

  // Необязательный CORS-прокси: «https://…/счётчик?url=» (с «=» на конце) — URL кодируем,
  // иначе пристраиваем адрес как есть
  function viaProxy(u) {
    const p = (NUTRI.api.proxy || '').trim();
    if (!p) return u;
    return p.endsWith('=') ? p + encodeURIComponent(u) : p + u;
  }

  function failText(e) {
    const msg = (e && e.message) || String(e);
    let t = 'Не вышло: ' + msg;
    if (/Failed to fetch|NetworkError|Load failed|AbortError/i.test(msg)) {
      t += ' • Скорее всего, браузер заблокировал запрос (CORS) или нет сети: FatSecret официально пускает токены только через сервер/прокси — впиши адрес своего прокси в поле выше.';
    }
    if (/IP|proxy|invalid|credentials/i.test(msg)) {
      t += ' • Проверь ключи и список разрешённых адресов в настройках приложения на platform.fatsecret.com.';
    }
    return t;
  }

  async function getToken() {
    const a = NUTRI.api;
    const id = (a.clientId || '').trim();
    const secret = (a.clientSecret || '').trim();
    if (!id || !secret) throw new Error('Сначала заполни Client ID и Client Secret');

    if (a.token && a.token.exp && Date.now() < a.token.exp) return a.token.accessToken;

    apiStatus('Запрашиваю токен…');
    let res;
    try {
      res = await fetch(viaProxy(FS_TOKEN), {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(id + ':' + secret))),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials&scope=basic',
      });
    } catch {
      throw new Error('Failed to fetch');
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new Error('FatSecret отказал в токене (HTTP ' + res.status + ') — проверь Client ID / Secret и разрешённые IP приложения');
    }
    if (!res.ok) throw new Error('токен, HTTP ' + res.status);
    const t = await res.json();
    if (!t.access_token) throw new Error('токен не получен');
    a.token = { accessToken: t.access_token, exp: Date.now() + Math.max(60, ((t.expires_in || 86400) - 300)) * 1000 };
    saveNutrition();
    return a.token.accessToken;
  }

  async function fsApi(method, params) {
    const token = await getToken();
    const qs = new URLSearchParams(Object.assign({ method, format: 'json' }, params));
    let res;
    try {
      res = await fetch(viaProxy(FS_SERVER + '?' + qs), { headers: { Authorization: 'Bearer ' + token } });
    } catch {
      throw new Error('Failed to fetch');
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error((data.error.message || data.error.code || 'ошибка API'));
    return data;
  }

  let apiResults = [];
  let picked = null;

  $('fs-connect').addEventListener('click', async () => {
    NUTRI.api.clientId = $('fs-client-id').value.trim();
    NUTRI.api.clientSecret = $('fs-secret').value.trim();
    NUTRI.api.proxy = $('fs-proxy').value.trim();
    saveNutrition();
    apiStatus('Подключаюсь…');
    try {
      await getToken();
      $('api-search').classList.remove('hidden');
      $('fs-log-block').classList.toggle('hidden', !(NUTRI.api.log || []).length);
      renderLog();
      apiStatus('Подключено — можно искать продукты');
    } catch (e) {
      apiStatus(failText(e), true);
    }
  });

  async function runSearch() {
    const q = $('fs-query').value.trim();
    if (!q) return;
    apiStatus('Ищу «' + q + '»…');
    try {
      const d = await fsApi('foods.search', { search_expression: q, max_results: '8' });
      const fs = d && d.foods_search;
      let list = fs && fs.results && fs.results.food;
      if (list && !Array.isArray(list)) list = [list];
      apiResults = list || [];
      if (!apiResults.length) {
        $('fs-results').innerHTML = '';
        apiStatus('Ничего не нашлось. База API — США: набирай латиницей, например «chicken breast» или «buckwheat»', true);
        return;
      }
      $('fs-results').innerHTML = apiResults
        .map((f, i) => {
          const brand = f.brand_name ? ' <span class="api-brand">· ' + esc(f.brand_name) + '</span>' : '';
          return `<button type="button" class="api-item" data-i="${i}"><b>${esc(f.food_name)}</b>${brand}</button>`;
        })
        .join('');
      picked = null;
      $('fs-pick').classList.add('hidden');
      apiStatus('Нашлось: ' + (fs.total_results || apiResults.length) + ' — выбери продукт');
    } catch (e) {
      $('fs-results').innerHTML = '';
      apiStatus(failText(e), true);
    }
  }

  $('fs-search-btn').addEventListener('click', runSearch);
  $('fs-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });

  $('fs-results').addEventListener('click', async (e) => {
    const b = e.target.closest('.api-item');
    if (!b) return;
    const f = apiResults[parseInt(b.dataset.i, 10)];
    if (!f) return;
    apiStatus('Загружаю порции «' + f.food_name + '»…');
    try {
      let d;
      try {
        d = await fsApi('food.get.v4', { food_id: f.food_id });
      } catch {
        d = await fsApi('food.get.v3', { food_id: f.food_id });
      }
      const food = (d && d.food) || {};
      let srv = food.servings && food.servings.serving;
      if (!srv) throw new Error('в ответе нет порций');
      if (!Array.isArray(srv)) srv = [srv];
      picked = { name: food.food_name || f.food_name, servings: srv };

      $('fs-serving').innerHTML = srv
        .map((s, i) => {
          const grams = s.metric_serving_amount && s.metric_serving_unit
            ? ' (≈' + fmt(num(s.metric_serving_amount)) + ' ' + s.metric_serving_unit + ')'
            : '';
          return `<option value="${i}">${esc((s.serving_description || 'порция') + grams)} — ${fmt(num(s.calories))} ккал</option>`;
        })
        .join('');
      $('fs-qty').value = '1';
      $('fs-pick').classList.remove('hidden');
      updatePickInfo();
      apiStatus('Выбери порцию и количество → добавь в день');
    } catch (err) {
      apiStatus(failText(err), true);
    }
  });

  function pickedTotals() {
    if (!picked) return null;
    const s = picked.servings[parseInt($('fs-serving').value || '0', 10)] || picked.servings[0];
    const q = Math.max(0.05, num($('fs-qty').value) || 1);
    return {
      s,
      q,
      kcal: num(s.calories) * q,
      protein: num(s.protein) * q,
      fat: num(s.fat) * q,
      carbs: num(s.carbohydrate) * q,
    };
  }

  function updatePickInfo() {
    const t = pickedTotals();
    if (!t) { $('fs-pick-info').textContent = ''; return; }
    const grams = t.s.metric_serving_amount && t.s.metric_serving_unit
      ? fmt(num(t.s.metric_serving_amount) * t.q) + ' ' + t.s.metric_serving_unit + ': '
      : '';
    $('fs-pick-info').textContent = grams + fmt(t.kcal) + ' ккал • Б ' + fmt(t.protein) + ' • Ж ' + fmt(t.fat) + ' • У ' + fmt(t.carbs);
  }

  $('fs-serving').addEventListener('change', updatePickInfo);
  $('fs-qty').addEventListener('input', updatePickInfo);

  $('fs-add').addEventListener('click', () => {
    const t = pickedTotals();
    if (!t) return;
    const opt = $('fs-serving').selectedOptions[0];
    NUTRI.api.log.push({
      name: picked.name,
      serving: opt ? String(opt.textContent).split(' (≈')[0].split(' — ')[0] : '',
      qty: t.q,
      kcal: Math.round(t.kcal * 10) / 10,
      protein: Math.round(t.protein * 10) / 10,
      fat: Math.round(t.fat * 10) / 10,
      carbs: Math.round(t.carbs * 10) / 10,
    });
    saveNutrition();
    renderLog();
    applyApiSummary();
    $('fs-qty').value = '1';
    updatePickInfo();
    apiStatus('Добавлено: ' + picked.name);
  });

  function apiTotals() {
    return (NUTRI.api.log || []).reduce(
      (s, r) => ({ kcal: s.kcal + r.kcal, protein: s.protein + r.protein, fat: s.fat + r.fat, carbs: s.carbs + r.carbs }),
      { kcal: 0, protein: 0, fat: 0, carbs: 0 }
    );
  }

  function renderLog() {
    const log = NUTRI.api.log || [];
    $('fs-log-block').classList.toggle('hidden', !log.length);
    $('fs-log').innerHTML = log.map((r, i) => `
      <li>
        <span class="log-name">${esc(r.name)}${r.qty && r.qty !== 1 ? ' × ' + fmt(r.qty) : ''}<small>${esc(r.serving || '')}</small></span>
        <span class="log-kcal">${fmt(r.kcal)} ккал</span>
        <button type="button" class="del-btn" data-i="${i}" aria-label="Убрать">×</button>
      </li>`).join('');
  }

  function applyApiSummary() {
    const log = NUTRI.api.log || [];
    if (!log.length) return;
    NUTRI.source = 'api';
    saveNutrition();
    renderSummary(apiTotals(), 'FatSecret API • ' + log.length + ' блюд');
  }

  $('fs-log').addEventListener('click', (e) => {
    const b = e.target.closest('.del-btn');
    if (!b) return;
    NUTRI.api.log.splice(parseInt(b.dataset.i, 10), 1);
    saveNutrition();
    renderLog();
    if (NUTRI.api.log.length) applyApiSummary();
    else if (NUTRI.source === 'api') { NUTRI.source = ''; saveNutrition(); resetSummary(); }
  });

  $('fs-clear').addEventListener('click', () => {
    NUTRI.api.log = [];
    saveNutrition();
    renderLog();
    if (NUTRI.source === 'api') { NUTRI.source = ''; saveNutrition(); resetSummary(); }
    apiStatus('День очищен');
  });

  /* ---------- Восстановление питания при загрузке — вызывается из restore() ---------- */

  function initFoodUI() {
    showPanel('manual');
    showShot();
    renderLog();

    const a = NUTRI.api;
    if (a.clientId) $('fs-client-id').value = a.clientId;
    if (a.clientSecret) $('fs-secret').value = a.clientSecret;
    if (a.proxy) $('fs-proxy').value = a.proxy;
    if (a.clientId && a.token && a.token.exp && Date.now() < a.token.exp) {
      $('api-search').classList.remove('hidden');
      apiStatus('Токен из кэша — можно искать продукты');
    }

    const m = NUTRI.manual;
    if (m) {
      $('fs-kcal').value = m.kcal || '';
      $('fs-protein').value = m.protein || '';
      $('fs-fat').value = m.fat || '';
      $('fs-carb').value = m.carbs || '';
    }

    if (NUTRI.source === 'manual' && m) renderSummary(m, 'ручной ввод');
    else if (NUTRI.source === 'api' && (NUTRI.api.log || []).length) {
      renderSummary(apiTotals(), 'FatSecret API • ' + NUTRI.api.log.length + ' блюд');
    }
  }

  /* ================= 6. Восстановление и запуск ================= */

  function restore() {
    // Сон
    const s = load(KEYS.sleep, {}) || {};
    if (s.start) sleepStart.value = s.start;
    if (s.end) sleepEnd.value = s.end;
    updateSleep();

    // Профиль — если считали раньше, восстанавливаем и сразу считаем
    const p = load(KEYS.profile, null);
    if (p && p.age != null) {
      if (p.gender === 'female') {
        const f = profileForm.querySelector('input[name="gender"][value="female"]');
        if (f) f.checked = true;
      }
      $('age').value = p.age;
      $('weight').value = p.weight;
      $('height').value = p.height;
      $('activity').value = p.activity;
      $('goal').value = p.goal;
      calculate(false); // восстановление без прокрутки
    }

    initFoodUI();
    renderWorkout();
    renderHistory();
  }

  $('calc-btn').addEventListener('click', calculate);

  restore();

  /* ================= 7. Шторка-колёсико: выбор чисел прокруткой ================= */

  // Числовые поля и их диапазоны: id → { min, max, step, unit, def }
  const WHEEL_FIELDS = {
    'sets':       { min: 1,   max: 20,   step: 1,   unit: '',     def: 3 },
    'reps':       { min: 1,   max: 50,   step: 1,   unit: '',     def: 8 },
    'bar-weight': { min: 0,   max: 300,  step: 0.5, unit: 'кг',   def: 40 },
    'age':        { min: 14,  max: 90,   step: 1,   unit: 'лет',  def: 25 },
    'weight':     { min: 35,  max: 250,  step: 0.5, unit: 'кг',   def: 70 },
    'height':     { min: 120, max: 250,  step: 1,   unit: 'см',   def: 175 },
    'fs-kcal':    { min: 0,   max: 3000, step: 5,   unit: 'ккал', def: 0 },
    'fs-protein': { min: 0,   max: 300,  step: 1,   unit: 'г',    def: 0 },
    'fs-fat':     { min: 0,   max: 300,  step: 1,   unit: 'г',    def: 0 },
    'fs-carb':    { min: 0,   max: 400,  step: 1,   unit: 'г',    def: 0 },
    'fs-qty':     { min: 0.1, max: 30,   step: 0.1, unit: '',     def: 1 },
  };

  const ITEM_H = 44; // высота одной строки колёсика (синхронизировано с CSS)

  const pickerOverlay = $('picker-overlay');
  const pickerSheet = $('picker-sheet');
  const pickerList = $('picker-list');
  const pickerWheel = $('picker-wheel');
  const pickerTitle = $('picker-title');
  const pickerCurrent = $('picker-current');
  const pickerUnit = $('picker-unit');
  const pickerDone = $('picker-done');

  let pickerInput = null;
  let pickerConfig = null;
  let pickerOpened = false;
  let pickerTick = 0;

  // 72.50000001 → «72.5»
  const wheelFmt = (v) => String(Math.round(v * 100) / 100);

  function openWheel(input) {
    const cfg = WHEEL_FIELDS[input.id];
    if (!cfg || pickerOpened) return;
    pickerInput = input;
    pickerConfig = cfg;

    // список значений от min до max с шагом
    const items = [];
    for (let v = cfg.min; v <= cfg.max + 1e-9; v += cfg.step) items.push(Math.round(v * 100) / 100);

    pickerList.innerHTML = items.map((v) => `<li style="height:${ITEM_H}px">${wheelFmt(v)}</li>`).join('');

    // старт: текущее значение поля, иначе «разумное» по умолчанию
    let start = num(input.value) || (cfg.def != null ? cfg.def : cfg.min);
    start = Math.min(cfg.max, Math.max(cfg.min, start));
    const idx = Math.min(items.length - 1, Math.max(0, Math.round((start - cfg.min) / cfg.step)));

    // заголовок — текст label рядом с полем
    const label = input.closest('.field') ? input.closest('.field').querySelector('label') : null;
    pickerTitle.textContent = label ? label.textContent : 'Выбери число';
    pickerUnit.textContent = cfg.unit;
    pickerCurrent.textContent = wheelFmt(items[idx]);

    pickerOpened = true;
    document.body.style.overflow = 'hidden'; // фон не прокручивается под шторкой
    pickerOverlay.hidden = false;
    pickerSheet.hidden = false;
    pickerOverlay.classList.add('open');
    pickerSheet.classList.add('open');
    highlightWheel();
    // позицию выставляем дважды: сразу и после начала анимации шторки
    // (во время transform-перехода браузер может пересчитать snap)
    pickerWheel.scrollTop = idx * ITEM_H;
    setTimeout(() => {
      pickerWheel.scrollTop = idx * ITEM_H;
      highlightWheel();
    }, 80);
    // страхующий тик: подпись/подсветка всегда согласованы с прокруткой
    // (интервал в видимой табе не нужен почти никогда — но выручает при snap-перескоках)
    clearInterval(pickerTick);
    pickerTick = setInterval(() => { if (pickerOpened) highlightWheel(); }, 200);
  }

  function closeWheel() {
    if (!pickerOpened) return;
    pickerOverlay.classList.remove('open');
    pickerSheet.classList.remove('open');
    pickerOpened = false;
    clearInterval(pickerTick);
    document.body.style.overflow = '';
    setTimeout(() => {
      if (!pickerOpened) { pickerOverlay.hidden = true; pickerSheet.hidden = true; }
    }, 240);
  }

  // индекс значения, которое сейчас в центре колёсика
  function wheelIndex() {
    return Math.min(
      pickerList.children.length - 1,
      Math.max(0, Math.round(pickerWheel.scrollTop / ITEM_H))
    );
  }

  function highlightWheel() {
    const i = wheelIndex();
    Array.from(pickerList.children).forEach((li, k) => li.classList.toggle('cur', k === i));
    if (pickerConfig) pickerCurrent.textContent = wheelFmt(pickerConfig.min + i * pickerConfig.step);
  }

  // мгновенная реакция на прокрутку (intervальчик выше — только страховка)
  pickerWheel.addEventListener('scroll', () => { if (pickerOpened) highlightWheel(); });

  // тап по числу — мгновенно ставим его в центр (гладкая прокрутка конфликтует со scroll-snap)
  pickerList.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const i = Array.from(pickerList.children).indexOf(li);
    pickerWheel.scrollTo({ top: i * ITEM_H, behavior: 'auto' });
  });

  pickerDone.addEventListener('click', () => {
    if (pickerInput && pickerConfig) {
      pickerInput.value = wheelFmt(pickerConfig.min + wheelIndex() * pickerConfig.step);
      pickerInput.dispatchEvent(new Event('input', { bubbles: true }));
      pickerInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closeWheel();
  });

  pickerOverlay.addEventListener('click', closeWheel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWheel(); });

  // вешаем шторку на все числовые поля (readonly — клавиатура не выезжает)
  Object.keys(WHEEL_FIELDS).forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('click', () => openWheel(el));
  });

  /* ================= 8. Service Worker: полный офлайн ================= */

  // после установки кэширует «оболочку» приложения — сайт открывается без
  // интернета и запускается быстрее. Без интернета данные остаются в localStorage.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* приложение работает и без worker */ });
  }
})();

/* ========== Мини-таблица для чисел с дробями ========== */
